"""Python memrez primitives matching the TypeScript package surface."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any, Literal, Protocol, TypedDict, cast
from uuid import uuid4

from .context import (
    NamespaceGrant,
    NamespaceGrantPolicyLike,
    is_same_or_descendant_namespace,
    namespace_ancestors,
    normalize_namespace_grants,
)

EntryType = Literal["fact", "preference", "event", "summary"]
DEFAULT_CORE_TOPIC = "core"


class Source(TypedDict, total=False):
    agentId: str
    sessionId: str
    runId: str


@dataclass(frozen=True)
class MemoryEntry:
    id: str
    scope: str
    content: str
    topics: list[str]
    type: EntryType
    status: Literal["active", "superseded"]
    created_at: str
    updated_at: str
    source: Source | None = None
    superseded_by: str | None = None


@dataclass(frozen=True)
class TopicSummary:
    topic: str
    count: int
    last_updated_at: str
    has_uncurated_writes: bool
    blurb: str | None = None


@dataclass(frozen=True)
class TopicMeta:
    scope: str
    topic: str
    last_updated_at: str
    blurb: str | None = None


@dataclass(frozen=True)
class DirtyTopic:
    scope: str
    topic: str


@dataclass(frozen=True)
class WritePolicy:
    descendants: bool = True
    ancestor_promotion: Literal["none", "parent", "ancestors"] = "none"


@dataclass(frozen=True)
class MemoryTopicConfig:
    """Reasoner topic vocabulary and preload defaults."""

    core: str = DEFAULT_CORE_TOPIC
    preferred: tuple[str, ...] = ()


@dataclass(frozen=True)
class TaggerInput:
    grants: list[NamespaceGrant]
    content: str
    existing_topics: list[str]
    write_policy: WritePolicy
    topics_hint: list[str] | None = None
    topic_config: MemoryTopicConfig | None = None
    source: Source | None = None


@dataclass(frozen=True)
class TaggerResult:
    namespace: str
    topics: list[str]
    type: EntryType
    normalized_content: str
    duplicate_of: str | None = None


class MemrezScopeError(ValueError):
    pass


class MemrezEntryNotFoundError(KeyError):
    def __init__(self, entry_id: str) -> None:
        super().__init__(f"memory entry '{entry_id}' not found")
        self.entry_id = entry_id


class MemrezCorrectionError(ValueError):
    pass


class MemrezReasoner(Protocol):
    def tag(self, input_value: TaggerInput) -> TaggerResult: ...


class MemoryStore(Protocol):
    def put_entry(self, entry: MemoryEntry) -> None: ...

    def get_entry(self, entry_id: str) -> MemoryEntry | None: ...

    def supersede(self, ids: Sequence[str], by_id: str) -> None: ...

    def list_topics(self, scope_paths: Sequence[str]) -> list[TopicSummary]: ...

    def get_by_topic(
        self,
        scope_paths: Sequence[str],
        topic: str,
        limit: int | None = None,
    ) -> list[MemoryEntry]: ...

    def get_topic_meta(self, scope: str, topic: str) -> TopicMeta | None: ...

    def set_topic_meta(
        self,
        scope: str,
        topic: str,
        *,
        blurb: str | None = None,
        last_updated_at: str | None = None,
    ) -> None: ...

    def list_scope_slice(
        self,
        scope_paths: Sequence[str],
        *,
        topics: Sequence[str] | None = None,
        include_superseded: bool = False,
    ) -> list[MemoryEntry]: ...

    def list_dirty_topics(self) -> list[DirtyTopic]: ...


DEFAULT_WRITE_POLICY = WritePolicy()
DEFAULT_TOPIC_CONFIG = MemoryTopicConfig()


class InMemoryMemoryStore:
    def __init__(self) -> None:
        self._entries: dict[str, MemoryEntry] = {}
        self._topic_meta: dict[tuple[str, str], TopicMeta] = {}

    def put_entry(self, entry: MemoryEntry) -> None:
        self._entries[entry.id] = replace(entry, topics=list(entry.topics))

    def get_entry(self, entry_id: str) -> MemoryEntry | None:
        entry = self._entries.get(entry_id)
        return _clone_entry(entry) if entry is not None else None

    def supersede(self, ids: Sequence[str], by_id: str) -> None:
        now = _now_iso()
        for entry_id in ids:
            entry = self._entries.get(entry_id)
            if entry is None:
                continue
            self._entries[entry_id] = replace(
                entry,
                status="superseded",
                superseded_by=by_id,
                updated_at=now,
            )

    def list_topics(self, scope_paths: Sequence[str]) -> list[TopicSummary]:
        scopes = set(scope_paths)
        counts: dict[str, dict[str, Any]] = {}
        newest_by_pair = self._newest_active_by_pair(lambda entry: entry.scope in scopes)
        for entry in self._entries.values():
            if entry.status != "active" or entry.scope not in scopes:
                continue
            for topic in entry.topics:
                current = counts.setdefault(
                    topic,
                    {"count": 0, "last_updated_at": entry.updated_at},
                )
                current["count"] += 1
                if entry.updated_at > current["last_updated_at"]:
                    current["last_updated_at"] = entry.updated_at

        summaries: list[TopicSummary] = []
        for topic, values in sorted(counts.items()):
            meta = self._find_topic_meta(scope_paths, topic)
            has_uncurated_writes = any(
                (newest := newest_by_pair.get((scope, topic))) is not None
                and self._is_pair_dirty(scope, topic, newest)
                for scope in scope_paths
            )
            summaries.append(
                TopicSummary(
                    topic=topic,
                    count=int(values["count"]),
                    blurb=meta.blurb if meta else None,
                    last_updated_at=(
                        meta.last_updated_at if meta else str(values["last_updated_at"])
                    ),
                    has_uncurated_writes=has_uncurated_writes,
                )
            )
        return summaries

    def get_by_topic(
        self,
        scope_paths: Sequence[str],
        topic: str,
        limit: int | None = None,
    ) -> list[MemoryEntry]:
        scopes = set(scope_paths)
        rows = [
            entry
            for entry in self._entries.values()
            if entry.status == "active" and entry.scope in scopes and topic in entry.topics
        ]
        rows.sort(key=lambda entry: entry.updated_at, reverse=True)
        if limit is not None:
            rows = rows[:limit]
        return [_clone_entry(entry) for entry in rows]

    def get_topic_meta(self, scope: str, topic: str) -> TopicMeta | None:
        meta = self._topic_meta.get((scope, topic))
        return meta if meta is None else replace(meta)

    def set_topic_meta(
        self,
        scope: str,
        topic: str,
        *,
        blurb: str | None = None,
        last_updated_at: str | None = None,
    ) -> None:
        self._topic_meta[(scope, topic)] = TopicMeta(
            scope=scope,
            topic=topic,
            blurb=blurb,
            last_updated_at=last_updated_at or _now_iso(),
        )

    def list_scope_slice(
        self,
        scope_paths: Sequence[str],
        *,
        topics: Sequence[str] | None = None,
        include_superseded: bool = False,
    ) -> list[MemoryEntry]:
        scopes = set(scope_paths)
        topic_set = set(topics) if topics is not None else None
        rows: list[MemoryEntry] = []
        for entry in self._entries.values():
            if entry.scope not in scopes:
                continue
            if not include_superseded and entry.status != "active":
                continue
            if topic_set is not None and not any(topic in topic_set for topic in entry.topics):
                continue
            rows.append(entry)
        rows.sort(key=lambda entry: entry.updated_at, reverse=True)
        return [_clone_entry(entry) for entry in rows]

    def list_dirty_topics(self) -> list[DirtyTopic]:
        newest_by_pair = self._newest_active_by_pair(lambda _entry: True)
        rows = [
            DirtyTopic(scope=scope, topic=topic)
            for (scope, topic), newest in newest_by_pair.items()
            if self._is_pair_dirty(scope, topic, newest)
        ]
        rows.sort(key=lambda row: (row.scope, row.topic))
        return rows

    def _find_topic_meta(
        self,
        scope_paths: Sequence[str],
        topic: str,
    ) -> TopicMeta | None:
        for scope in reversed(scope_paths):
            meta = self._topic_meta.get((scope, topic))
            if meta is not None:
                return meta
        return None

    def _newest_active_by_pair(
        self,
        include: Any,
    ) -> dict[tuple[str, str], str]:
        newest: dict[tuple[str, str], str] = {}
        for entry in self._entries.values():
            if entry.status != "active" or not include(entry):
                continue
            for topic in entry.topics:
                key = (entry.scope, topic)
                current = newest.get(key)
                if current is None or entry.updated_at > current:
                    newest[key] = entry.updated_at
        return newest

    def _is_pair_dirty(self, scope: str, topic: str, newest: str) -> bool:
        meta = self._topic_meta.get((scope, topic))
        return meta is None or newest > meta.last_updated_at


class Memrez:
    def __init__(
        self,
        *,
        store: MemoryStore | None = None,
        reasoner: MemrezReasoner | None = None,
        namespace_policy: NamespaceGrantPolicyLike = None,
    ) -> None:
        self.store = store or InMemoryMemoryStore()
        if reasoner is None:
            from .memrez_llm_reasoner import llm_reasoner

            reasoner = llm_reasoner()
        self.reasoner = reasoner
        self.namespace_policy = namespace_policy

    def provider(self):
        from .memrez_provider import create_memory_resource_provider

        return create_memory_resource_provider(self)

    def scan(
        self,
        grants: Sequence[NamespaceGrant],
        *,
        include_ancestors: bool = True,
        topic_limit: int | None = None,
    ) -> dict[str, Any]:
        normalized = _normalize_grants(grants, self.namespace_policy)
        scopes = visible_scopes(normalized, include_ancestors=include_ancestors)
        topics = self.store.list_topics(scopes)
        return {
            "grants": normalized,
            "topics": topics[:topic_limit] if topic_limit is not None else topics,
        }

    def read(
        self,
        grants: Sequence[NamespaceGrant],
        topic: str | Sequence[str],
        *,
        include_ancestors: bool = True,
        limit: int | None = None,
    ) -> list[MemoryEntry]:
        normalized = _normalize_grants(grants, self.namespace_policy)
        scopes = visible_scopes(normalized, include_ancestors=include_ancestors)
        topics = [topic] if isinstance(topic, str) else list(topic)
        seen: set[str] = set()
        output: list[MemoryEntry] = []
        for current_topic in topics:
            for entry in self.store.get_by_topic(scopes, str(current_topic), limit):
                if entry.id in seen:
                    continue
                seen.add(entry.id)
                output.append(entry)
        return output

    def list(
        self,
        grants: Sequence[NamespaceGrant],
        *,
        topics: Sequence[str] | None = None,
        include_superseded: bool = False,
        include_ancestors: bool = True,
    ) -> list[MemoryEntry]:
        normalized = _normalize_grants(grants, self.namespace_policy)
        scopes = visible_scopes(normalized, include_ancestors=include_ancestors)
        return self.store.list_scope_slice(
            scopes,
            topics=topics,
            include_superseded=include_superseded,
        )

    def write(
        self,
        grants: Sequence[NamespaceGrant],
        content: str,
        *,
        type: EntryType | None = None,
        topics_hint: Sequence[str] | None = None,
        topic_config: MemoryTopicConfig | Mapping[str, Any] | None = None,
        source: Source | None = None,
        write_policy: WritePolicy | Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        normalized = _normalize_grants(grants, self.namespace_policy)
        policy = normalize_write_policy(write_policy)
        normalized_topic_config = normalize_topic_config(topic_config)
        existing_topics = [topic.topic for topic in self.scan(normalized)["topics"]]
        tag = self.reasoner.tag(
            TaggerInput(
                grants=normalized,
                content=content,
                existing_topics=existing_topics,
                topics_hint=list(topics_hint) if topics_hint is not None else None,
                topic_config=normalized_topic_config,
                write_policy=policy,
                source=source,
            )
        )
        scope = assert_writable_scope(normalized, tag.namespace, policy)

        if tag.duplicate_of:
            duplicate = self.store.get_entry(tag.duplicate_of)
            if duplicate is not None:
                return {"entry": duplicate, "action": "deduped"}

        exact_duplicate = self._find_exact_duplicate(scope, tag.normalized_content)
        if exact_duplicate is not None:
            return {"entry": exact_duplicate, "action": "deduped"}

        now = _now_iso()
        entry = MemoryEntry(
            id=f"mem_{uuid4()}",
            scope=scope,
            content=tag.normalized_content,
            topics=_normalize_topics(tag.topics),
            type=type or tag.type,
            source=source,
            status="active",
            created_at=now,
            updated_at=now,
        )
        self.store.put_entry(entry)
        return {"entry": entry, "action": "appended"}

    def curate(
        self,
        grants: Sequence[NamespaceGrant],
        *,
        topics: Sequence[str] | None = None,
        topic_config: MemoryTopicConfig | Mapping[str, Any] | None = None,
        include_descendants: bool = False,
    ) -> dict[str, int]:
        normalized = _normalize_grants(grants, self.namespace_policy)
        normalized_topic_config = normalize_topic_config(topic_config)
        scope_paths = list(normalized) if include_descendants else visible_scopes(normalized, True)
        entries = self.store.list_scope_slice(scope_paths, topics=topics)
        curate = getattr(self.reasoner, "curate", None)
        raw_ops = (
            curate(
                {
                    "grants": normalized,
                    "scopePaths": scope_paths,
                    "entries": entries,
                    "topics": list(topics) if topics is not None else None,
                    "topicConfig": _topic_config_to_dict(normalized_topic_config),
                }
            )
            if callable(curate)
            else []
        )
        ops = cast(Sequence[Mapping[str, Any]], raw_ops)

        report = {"scanned": len(entries), "superseded": 0, "created": 0, "blurbsUpdated": 0}
        curated_pairs: dict[tuple[str, str], tuple[str, str]] = {}
        topic_filter = set(topics) if topics is not None else None
        for entry in entries:
            for topic in entry.topics:
                if topic_filter is not None and topic not in topic_filter:
                    continue
                curated_pairs[(entry.scope, topic)] = (entry.scope, topic)

        for op in ops:
            op_type = op.get("type") if isinstance(op, Mapping) else None
            if op_type == "setBlurb":
                scope = str(op["scope"])
                topic = str(op["topic"])
                self.store.set_topic_meta(
                    scope,
                    topic,
                    blurb=str(op["blurb"]),
                    last_updated_at=_now_iso(),
                )
                curated_pairs[(scope, topic)] = (scope, topic)
                report["blurbsUpdated"] += 1
            elif op_type == "supersede":
                replacement = op["replacement"]
                if not isinstance(replacement, Mapping):
                    continue
                scope = assert_writable_scope(
                    normalized,
                    str(replacement["namespace"]),
                    normalize_write_policy(None),
                )
                now = _now_iso()
                entry_type_raw = replacement.get("entryType", "fact")
                entry_type: EntryType = (
                    cast(EntryType, entry_type_raw)
                    if entry_type_raw in {"fact", "preference", "event", "summary"}
                    else "fact"
                )
                entry = MemoryEntry(
                    id=f"mem_{uuid4()}",
                    scope=scope,
                    content=str(replacement["content"]),
                    topics=_normalize_topics(list(replacement["topics"])),
                    type=entry_type,
                    status="active",
                    created_at=now,
                    updated_at=now,
                )
                raw_ids = op.get("ids", [])
                ids = (
                    [str(entry_id) for entry_id in raw_ids]
                    if isinstance(raw_ids, Sequence) and not isinstance(raw_ids, str)
                    else []
                )
                self.store.put_entry(entry)
                self.store.supersede(ids, entry.id)
                for topic in entry.topics:
                    curated_pairs[(scope, topic)] = (scope, topic)
                report["created"] += 1
                report["superseded"] += len(ids)

        if callable(curate):
            stamp = _now_iso()
            for scope, topic in curated_pairs.values():
                existing = self.store.get_topic_meta(scope, topic)
                self.store.set_topic_meta(
                    scope,
                    topic,
                    blurb=existing.blurb if existing else None,
                    last_updated_at=stamp,
                )
        return report

    def correct(
        self,
        grants: Sequence[NamespaceGrant],
        entry_id: str,
        new_content: str,
    ) -> dict[str, MemoryEntry]:
        normalized = _normalize_grants(grants, self.namespace_policy)
        original = self.store.get_entry(entry_id)
        if original is None:
            raise MemrezEntryNotFoundError(entry_id)
        if original.status != "active":
            raise MemrezCorrectionError(
                f"entry '{entry_id}' is already superseded by "
                f"'{original.superseded_by}'; correct the active entry instead"
            )
        assert_writable_scope(normalized, original.scope, normalize_write_policy(None))

        content = new_content.strip()
        if not content:
            raise MemrezCorrectionError("corrected content must not be empty")

        now = _now_iso()
        entry = MemoryEntry(
            id=f"mem_{uuid4()}",
            scope=original.scope,
            content=content,
            topics=list(original.topics),
            type=original.type,
            status="active",
            created_at=now,
            updated_at=now,
        )
        self.store.put_entry(entry)
        self.store.supersede([entry_id], entry.id)
        return {"entry": entry}

    def _find_exact_duplicate(self, scope: str, content: str) -> MemoryEntry | None:
        entries = self.store.list_scope_slice([scope])
        return next(
            (entry for entry in entries if entry.content == content and entry.status == "active"),
            None,
        )


class DeterministicReasoner:
    def tag(self, input_value: TaggerInput) -> TaggerResult:
        return deterministic_tag(input_value)


def deterministic_tag(input_value: TaggerInput) -> TaggerResult:
    return TaggerResult(
        namespace=input_value.grants[0],
        topics=_normalize_topics(input_value.topics_hint or ["general"]),
        type="fact",
        normalized_content=input_value.content.strip(),
    )


def create_memrez(
    *,
    store: MemoryStore | None = None,
    reasoner: MemrezReasoner | None = None,
    namespace_policy: NamespaceGrantPolicyLike = None,
) -> Memrez:
    return Memrez(store=store, reasoner=reasoner, namespace_policy=namespace_policy)


def normalize_write_policy(policy: WritePolicy | Mapping[str, Any] | None) -> WritePolicy:
    if policy is None:
        return DEFAULT_WRITE_POLICY
    if isinstance(policy, WritePolicy):
        return policy
    return WritePolicy(
        descendants=bool(policy.get("descendants", DEFAULT_WRITE_POLICY.descendants)),
        ancestor_promotion=policy.get(
            "ancestorPromotion",
            policy.get("ancestor_promotion", DEFAULT_WRITE_POLICY.ancestor_promotion),
        ),
    )


def normalize_topic_config(
    config: MemoryTopicConfig | Mapping[str, Any] | None,
) -> MemoryTopicConfig:
    if config is None:
        return DEFAULT_TOPIC_CONFIG
    if isinstance(config, MemoryTopicConfig):
        core = _normalize_topic_name(config.core) or DEFAULT_CORE_TOPIC
        return MemoryTopicConfig(core=core, preferred=tuple(_normalize_topics(config.preferred)))

    raw_core = config.get("core", DEFAULT_CORE_TOPIC)
    core = _normalize_topic_name(str(raw_core)) or DEFAULT_CORE_TOPIC
    raw_preferred = config.get("preferred", [])
    preferred = (
        _normalize_topics(raw_preferred)
        if isinstance(raw_preferred, Sequence) and not isinstance(raw_preferred, str)
        else []
    )
    return MemoryTopicConfig(core=core, preferred=tuple(preferred))


def visible_scopes(
    grants: Sequence[NamespaceGrant],
    include_ancestors: bool = True,
) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for grant in grants:
        scopes = namespace_ancestors(grant) if include_ancestors else [grant]
        for scope in scopes:
            if scope not in seen:
                seen.add(scope)
                output.append(scope)
    return output


def assert_writable_scope(
    grants: Sequence[NamespaceGrant],
    target: str,
    policy: WritePolicy,
) -> str:
    normalized_target = normalize_namespace_grants([target])[0]
    for grant in grants:
        if normalized_target == grant:
            return normalized_target
        if policy.descendants and is_same_or_descendant_namespace(normalized_target, grant):
            return normalized_target
        if _is_allowed_ancestor_promotion(grant, normalized_target, policy.ancestor_promotion):
            return normalized_target
    raise MemrezScopeError(
        f"scope '{target}' is not writable from grants [{', '.join(grants)}] "
        f"with ancestorPromotion={policy.ancestor_promotion}"
    )


def _is_allowed_ancestor_promotion(
    grant: NamespaceGrant,
    target: str,
    promotion: Literal["none", "parent", "ancestors"],
) -> bool:
    if promotion == "none":
        return False
    ancestors = namespace_ancestors(grant)
    if target not in ancestors or target == grant:
        return False
    if promotion == "ancestors":
        return True
    return promotion == "parent" and ancestors.index(target) == len(ancestors) - 2


def _normalize_grants(
    grants: Sequence[NamespaceGrant],
    namespace_policy: NamespaceGrantPolicyLike = None,
) -> list[NamespaceGrant]:
    normalized = normalize_namespace_grants(grants, namespace_policy)
    if not normalized:
        raise MemrezScopeError("memrez operations require at least one namespace grant")
    return normalized


def _normalize_topics(topics: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for topic in topics:
        normalized = _normalize_topic_name(topic)
        if normalized and normalized not in seen:
            seen.add(normalized)
            output.append(normalized)
    return output or ["general"]


def _normalize_topic_name(topic: str) -> str:
    return str(topic).strip().lower()


def _topic_config_to_dict(config: MemoryTopicConfig) -> dict[str, Any]:
    return {"core": config.core, "preferred": list(config.preferred)}


def _clone_entry(entry: MemoryEntry) -> MemoryEntry:
    return replace(
        entry,
        topics=list(entry.topics),
        source=dict(entry.source) if entry.source else None,
    )


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
