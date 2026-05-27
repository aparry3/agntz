"""Agent manifest parsing and execution package."""

from .conditions import evaluate_condition
from .executor import execute, execute_with_state
from .parser import (
    ManifestParseError,
    load_manifest_file,
    load_manifests_from_dir,
    normalize_manifest,
    parse_manifest,
)
from .state import (
    apply_input_transform,
    apply_output_mapping,
    create_initial_state,
    get_manifest_state_key,
    get_state_key,
    normalize_id,
)
from .template import interpolate, render_template, resolve_path
from .types import (
    AgentManifest,
    ExecutionContext,
    ExecutionResult,
    LLMAgentManifest,
    ParallelAgentManifest,
    ResourceManifestEntry,
    SequentialAgentManifest,
    StepRef,
    ToolAgentManifest,
    ToolCallConfig,
)
from .validate import assert_valid_manifest, validate_manifest

__all__ = [
    "AgentManifest",
    "ExecutionContext",
    "ExecutionResult",
    "LLMAgentManifest",
    "ManifestParseError",
    "ParallelAgentManifest",
    "ResourceManifestEntry",
    "SequentialAgentManifest",
    "StepRef",
    "ToolAgentManifest",
    "ToolCallConfig",
    "apply_input_transform",
    "apply_output_mapping",
    "assert_valid_manifest",
    "create_initial_state",
    "evaluate_condition",
    "execute",
    "execute_with_state",
    "get_manifest_state_key",
    "get_state_key",
    "interpolate",
    "load_manifest_file",
    "load_manifests_from_dir",
    "normalize_id",
    "normalize_manifest",
    "parse_manifest",
    "render_template",
    "resolve_path",
    "validate_manifest",
]
