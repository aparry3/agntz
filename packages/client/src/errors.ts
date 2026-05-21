export interface AgntzErrorInit {
  status?: number;
  code?: string;
  cause?: unknown;
}

export class AgntzError extends Error {
  readonly status?: number;
  readonly code?: string;
  override readonly cause?: unknown;

  constructor(message: string, init: AgntzErrorInit = {}) {
    super(message);
    this.name = "AgntzError";
    this.status = init.status;
    this.code = init.code;
    this.cause = init.cause;
  }
}

export class AuthenticationError extends AgntzError {
  constructor(message: string, init: AgntzErrorInit = {}) {
    super(message, init);
    this.name = "AuthenticationError";
  }
}

export class NotFoundError extends AgntzError {
  constructor(message: string, init: AgntzErrorInit = {}) {
    super(message, init);
    this.name = "NotFoundError";
  }
}

export class StreamError extends AgntzError {
  constructor(message: string, init: AgntzErrorInit = {}) {
    super(message, init);
    this.name = "StreamError";
  }
}
