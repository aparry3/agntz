import { describe, expect, it } from "vitest";
import {
  AgntzError,
  AuthenticationError,
  NotFoundError,
  StreamError,
} from "../src/errors.js";

describe("error classes", () => {
  it("AuthenticationError is an AgntzError is an Error", () => {
    const e = new AuthenticationError("nope", { status: 401 });
    expect(e).toBeInstanceOf(AuthenticationError);
    expect(e).toBeInstanceOf(AgntzError);
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(401);
    expect(e.name).toBe("AuthenticationError");
  });

  it("NotFoundError carries status", () => {
    const e = new NotFoundError("missing", { status: 404 });
    expect(e.status).toBe(404);
    expect(e).toBeInstanceOf(AgntzError);
  });

  it("StreamError supports code and cause", () => {
    const cause = new Error("underlying");
    const e = new StreamError("parse fail", { code: "INVALID_SSE_PAYLOAD", cause });
    expect(e.code).toBe("INVALID_SSE_PAYLOAD");
    expect(e.cause).toBe(cause);
  });

  it("AgntzError message is preserved", () => {
    const e = new AgntzError("boom");
    expect(e.message).toBe("boom");
  });
});
