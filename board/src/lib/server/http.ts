import type { ErrorBody } from "../posts/types";
import { BoardError, RateLimitError } from "./errors";
import { isDatabaseUnavailable } from "./database";
import { readAppOrigin } from "./request-context";

export function ensureSameOrigin(request: Request, options: { requireOrigin?: boolean } = {}): void {
  const expected = readAppOrigin();
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if ((host !== null && host.toLowerCase() !== expected.host) ||
    (origin !== null && origin !== expected.origin) ||
    (origin === null && (options.requireOrigin || request.headers.get("sec-fetch-site") === "cross-site"))) {
    throw new BoardError("FORBIDDEN", 403, "허용되지 않은 요청입니다.");
  }
}

const maximumBodyBytes = 64 * 1024;

function tooLarge(): never {
  throw new BoardError("PAYLOAD_TOO_LARGE", 413, "요청 내용이 너무 큽니다. 64KiB 이하로 보내 주세요.");
}

export async function readJson(request: Request): Promise<unknown> {
  const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new BoardError("UNSUPPORTED_MEDIA_TYPE", 415, "JSON 형식으로 요청해 주세요.");
  }
  const length = request.headers.get("content-length");
  if (length !== null) {
    if (!/^[0-9]+$/.test(length) || length !== length.trim()) {
      throw new BoardError("VALIDATION_ERROR", 400, "올바른 요청 길이가 필요합니다.");
    }
    if (Number(length) > maximumBodyBytes) tooLarge();
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maximumBodyBytes) {
          await reader.cancel().catch(() => undefined);
          tooLarge();
        }
        chunks.push(chunk.value);
      }
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes));
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof BoardError) throw error;
    throw new BoardError("VALIDATION_ERROR", 400, "올바른 JSON을 입력해 주세요.");
  } finally { reader?.releaseLock(); }
}

export function toErrorResponse(error: unknown): Response {
  if (isDatabaseUnavailable(error)) {
    error = new BoardError("SERVICE_UNAVAILABLE", 503, "데이터베이스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  const body: ErrorBody = {
    error: error instanceof BoardError
      ? { code: error.code, message: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) }
      : { code: "INTERNAL_ERROR", message: "처리 중 오류가 발생했습니다." },
  };
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (error instanceof RateLimitError) headers["Retry-After"] = String(error.retryAfterSeconds);
  return Response.json(body, {
    status: error instanceof BoardError ? error.status : 500, headers,
  });
}
