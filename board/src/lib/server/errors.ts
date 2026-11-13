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
