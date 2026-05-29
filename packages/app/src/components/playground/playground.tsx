"use client";

import { EditableSelect } from "@/components/v3/editor/editable-fields";
import { I } from "@/components/v3/icons";
import { Btn, Mono, Spinner, ag } from "@/components/v3/primitives";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InputForm } from "./input-form";
import { LiveTrace } from "./live-trace";

interface SessionSummary {
	sessionId: string;
	agentId?: string;
	messageCount: number;
	createdAt: string;
	updatedAt: string;
}

interface ReplyEvent {
	runId: string;
	sessionId: string;
	text: string;
	ts: string;
	seq: number;
}

interface RunResult {
	output: unknown;
	state: Record<string, unknown>;
	sessionId: string;
	replies?: ReplyEvent[];
}

const NEW_SESSION = "__new__";

export function Playground({
	agentId,
	manifest,
	dirty,
	onSaveAndRun,
}: {
	agentId: string;
	manifest: Record<string, unknown>;
	dirty: boolean;
	onSaveAndRun: () => Promise<void> | void;
}) {
	const [input, setInput] = useState<unknown>("");
	const [sessionId, setSessionId] = useState<string>(NEW_SESSION);
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [running, setRunning] = useState(false);
	const [runError, setRunError] = useState<string | null>(null);
	const [runResult, setRunResult] = useState<RunResult | null>(null);
	const [traceId, setTraceId] = useState<string | null>(null);
	const [replyStream, setReplyStream] = useState<ReplyEvent[]>([]);

	// Lazy-load sessions for the dropdown. Refresh after each run so a fresh
	// session created by the run shows up next time the user opens the menu.
	const loadSessions = useCallback(async () => {
		try {
			const res = await fetch(
				`/api/sessions?agentId=${encodeURIComponent(agentId)}`,
			);
			if (!res.ok) return;
			const data = (await res.json()) as SessionSummary[];
			setSessions(data);
		} catch {
			/* non-fatal */
		}
	}, [agentId]);

	useEffect(() => {
		loadSessions();
	}, [loadSessions]);

	const sessionOptions = useMemo(() => {
		const base: ReadonlyArray<readonly [string, string]> = [
			[NEW_SESSION, "New session"],
			...sessions.map(
				(s) =>
					[
						s.sessionId,
						`${s.sessionId.slice(0, 16)}… · ${s.messageCount} msgs`,
					] as const,
			),
		];
		return base;
	}, [sessions]);

	// Set false on (re)mount, true on unmount. Reset on mount matters because
	// React StrictMode in `next dev` does mount → cleanup → mount on initial
	// render — without the reset, cancelledRef would be stuck at true and
	// handleRun would break out of the SSE loop on the first event.
	const cancelledRef = useRef(false);
	useEffect(() => {
		cancelledRef.current = false;
		return () => {
			cancelledRef.current = true;
		};
	}, []);

	const handleRun = useCallback(async () => {
		if (running) return;
		setRunError(null);
		setRunResult(null);
		setTraceId(null);
		setReplyStream([]);
		setRunning(true);

		try {
			if (dirty) {
				await onSaveAndRun();
			}

			const body: Record<string, unknown> = { agentId, input };
			if (sessionId !== NEW_SESSION) body.sessionId = sessionId;

			const res = await fetch("/api/run/stream", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			if (!res.ok || !res.body) {
				const errBody = await res.json().catch(() => ({}));
				throw new Error(
					(errBody as { error?: string }).error ??
						`Run failed: ${res.status} ${res.statusText}`,
				);
			}

			for await (const event of parseSSE(res.body)) {
				if (cancelledRef.current) break;
				if (event.name === "run-start") {
					const data = safeParse<{ traceId?: string }>(event.data);
					if (data?.traceId) setTraceId(data.traceId);
				} else if (event.name === "reply") {
					const data = safeParse<ReplyEvent>(event.data);
					if (data) setReplyStream((prev) => [...prev, data]);
				} else if (event.name === "run-complete") {
					const data = safeParse<RunResult>(event.data);
					if (data) setRunResult(data);
					// Stop iterating once we've seen the terminal event — don't wait
					// for the server to close the stream (Next.js dev can hold it open).
					break;
				} else if (event.name === "run-error") {
					const data = safeParse<{ error?: string }>(event.data);
					setRunError(data?.error ?? "Unknown error");
					break;
				}
			}
			// Best-effort close so the underlying TCP connection is released.
			await res.body.cancel().catch(() => {});
		} catch (err) {
			if (!cancelledRef.current)
				setRunError(err instanceof Error ? err.message : String(err));
		} finally {
			if (!cancelledRef.current) {
				setRunning(false);
				loadSessions();
			}
		}
	}, [running, dirty, onSaveAndRun, agentId, input, sessionId, loadSessions]);

	const runLabel = dirty ? "Save & Run" : "Run";

	return (
		<div
			style={{
				padding: 16,
				background: ag.surface,
				borderLeft: `1px solid ${ag.line2}`,
				minHeight: 0,
				overflow: "auto",
				display: "flex",
				flexDirection: "column",
				gap: 14,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 8,
				}}
			>
				<div
					style={{
						fontSize: 10.5,
						letterSpacing: "0.08em",
						textTransform: "uppercase",
						color: ag.muted,
						fontWeight: 500,
					}}
				>
					Playground
				</div>
				{running && (
					<span
						style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
					>
						<Spinner size={11} />
						<Mono size={10.5} color={ag.muted}>
							running
						</Mono>
					</span>
				)}
			</div>

			<InputForm manifest={manifest} value={input} onChange={setInput} />

			<EditableSelect
				label="Session"
				value={sessionId}
				options={sessionOptions}
				onChange={setSessionId}
			/>

			<div>
				<Btn
					variant="primary"
					icon={<I.Play size={11} style={{ marginRight: 6 }} />}
					onClick={handleRun}
					disabled={running}
				>
					{running ? "Running…" : runLabel}
				</Btn>
				{traceId && (
					<Mono size={10.5} color={ag.muted} style={{ marginLeft: 10 }}>
						trace {traceId}
					</Mono>
				)}
			</div>

			{runError && (
				<div
					style={{
						padding: "8px 10px",
						border: "1px solid #F2DCDE",
						background: "#FBEFEA",
						borderRadius: 4,
						color: ag.danger,
						fontSize: 12,
						display: "flex",
						alignItems: "flex-start",
						gap: 6,
					}}
				>
					<I.X size={11} style={{ marginTop: 2 }} />
					<span style={{ whiteSpace: "pre-wrap" }}>{runError}</span>
				</div>
			)}

			{traceId && (
				<LiveTrace key={traceId} traceId={traceId} agentId={agentId} />
			)}

			{replyStream.length > 0 && (
				<ResultPane label="Replies">
					{replyStream.map((r, i) => (
						<div key={r.seq ?? i} style={{ marginBottom: 6 }}>
							<Mono size={10.5} color={ag.muted}>
								#{r.seq}
							</Mono>{" "}
							<span style={{ whiteSpace: "pre-wrap" }}>{r.text}</span>
						</div>
					))}
				</ResultPane>
			)}

			{runResult && (
				<>
					<ResultPane label="Output">
						<Pre value={runResult.output} />
					</ResultPane>
					<ResultPane label="State">
						<Pre value={runResult.state} />
					</ResultPane>
				</>
			)}
		</div>
	);
}

function ResultPane({
	label,
	children,
}: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<div
				style={{
					fontSize: 10,
					letterSpacing: "0.08em",
					textTransform: "uppercase",
					color: ag.muted,
					fontWeight: 500,
					marginBottom: 5,
					fontFamily: "var(--font-mono)",
				}}
			>
				{label}
			</div>
			<div
				style={{
					border: `1px solid ${ag.line}`,
					borderRadius: 4,
					background: ag.surface2,
					padding: "8px 10px",
					fontSize: 12,
					color: ag.ink,
					maxHeight: 280,
					overflow: "auto",
				}}
			>
				{children}
			</div>
		</div>
	);
}

function Pre({ value }: { value: unknown }) {
	const text =
		typeof value === "string" ? value : JSON.stringify(value, null, 2);
	return (
		<pre
			style={{
				margin: 0,
				whiteSpace: "pre-wrap",
				fontFamily: "var(--font-mono)",
				fontSize: 11.5,
			}}
		>
			{text}
		</pre>
	);
}

function safeParse<T>(raw: string): T | null {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

interface SSEEvent {
	name: string;
	data: string;
	id?: string;
}

/**
 * Parses an SSE byte stream into discrete events. Frames are separated by
 * blank lines; each frame may contain `event:`, `data:`, `id:` fields. Lines
 * are joined with `\n` per the SSE spec (`data:` lines are concatenated).
 */
async function* parseSSE(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEEvent> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			while (true) {
				const idx = buffer.indexOf("\n\n");
				if (idx < 0) break;
				const raw = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 2);
				const parsed = parseFrame(raw);
				if (parsed) yield parsed;
			}
		}
		if (buffer.trim()) {
			const parsed = parseFrame(buffer);
			if (parsed) yield parsed;
		}
	} finally {
		reader.releaseLock();
	}
}

function parseFrame(raw: string): SSEEvent | null {
	const lines = raw.split(/\r?\n/);
	let name = "message";
	let id: string | undefined;
	const dataLines: string[] = [];

	for (const line of lines) {
		if (!line || line.startsWith(":")) continue;
		const colon = line.indexOf(":");
		const field = colon < 0 ? line : line.slice(0, colon);
		const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
		if (field === "event") name = value;
		else if (field === "data") dataLines.push(value);
		else if (field === "id") id = value;
	}

	if (dataLines.length === 0) return null;
	return { name, data: dataLines.join("\n"), id };
}
