import { describe, expect, it } from "vitest";
import { StreamError } from "../src/errors.js";
import { normalizeEvent } from "../src/events.js";

describe("normalizeEvent", () => {
  it("maps run-start", () => {
    expect(
      normalizeEvent({
        event: "run-start",
        data: JSON.stringify({ agentId: "a1", kind: "llm", sessionId: "sess_1" }),
      }),
    ).toEqual({ type: "start", agentId: "a1", kind: "llm", sessionId: "sess_1" });
  });

  it("maps run-complete", () => {
    expect(
      normalizeEvent({
        event: "run-complete",
        data: JSON.stringify({ output: "ok", state: { n: 1 }, sessionId: "sess_1" }),
      }),
    ).toEqual({ type: "complete", output: "ok", state: { n: 1 }, sessionId: "sess_1" });
  });

  it("maps run-error", () => {
    expect(
      normalizeEvent({
        event: "run-error",
        data: JSON.stringify({ error: "nope" }),
      }),
    ).toEqual({ type: "error", error: "nope" });
  });

  it("returns null for unknown events", () => {
    expect(normalizeEvent({ event: "heartbeat", data: "{}" })).toBeNull();
  });

  it("returns null when event field is missing", () => {
    expect(normalizeEvent({ data: "{}" })).toBeNull();
  });

  it("throws StreamError on invalid JSON payload", () => {
    expect(() =>
      normalizeEvent({ event: "run-complete", data: "not json" }),
    ).toThrow(StreamError);
  });

  it("throws StreamError on unknown agent kind", () => {
    expect(() =>
      normalizeEvent({
        event: "run-start",
        data: JSON.stringify({ agentId: "a1", kind: "wizardry", sessionId: "sess_1" }),
      }),
    ).toThrow(StreamError);
  });

  it("defaults state to {} when missing on run-complete", () => {
    expect(
      normalizeEvent({
        event: "run-complete",
        data: JSON.stringify({ output: 1, sessionId: "sess_1" }),
      }),
    ).toEqual({ type: "complete", output: 1, state: {}, sessionId: "sess_1" });
  });

  it("maps reply with seq", () => {
    expect(
      normalizeEvent({
        event: "reply",
        data: JSON.stringify({
          type: "reply",
          text: "still thinking...",
          ts: "2026-05-16T12:00:00.000Z",
          sessionId: "sess_1",
          runId: "run_1",
          seq: 3,
        }),
      }),
    ).toEqual({
      type: "reply",
      text: "still thinking...",
      ts: "2026-05-16T12:00:00.000Z",
      sessionId: "sess_1",
      runId: "run_1",
      seq: 3,
    });
  });

  it("maps reply without seq", () => {
    expect(
      normalizeEvent({
        event: "reply",
        data: JSON.stringify({
          type: "reply",
          text: "hi",
          ts: "2026-05-16T12:00:00.000Z",
          sessionId: "sess_1",
          runId: "run_1",
        }),
      }),
    ).toEqual({
      type: "reply",
      text: "hi",
      ts: "2026-05-16T12:00:00.000Z",
      sessionId: "sess_1",
      runId: "run_1",
    });
  });
});
