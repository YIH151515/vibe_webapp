import type { ErrorCode } from "../posts/types";

export class BoardError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "BoardError";
  }
}

export class RateLimitError extends BoardError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    const seconds = Math.max(1, Math.ceil(Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 1));
    super("RATE_LIMITED", 429, `요청이 많습니다. ${seconds}초 후 다시 시도해 주세요.`);
    this.name = "RateLimitError";
    this.retryAfterSeconds = seconds;
  }
}
