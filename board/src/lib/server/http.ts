import type { ErrorBody } from "../posts/types";
import { BoardError } from "./errors";
import { isDatabaseUnavailable } from "./database";

export function ensureSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  // NextRequest normalizes 127.0.0.1 to localhost. Host preserves the
  // browser's actual authority; forwarded headers are deliberately ignored.
  const expectedOrigin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (
    (origin !== null && origin !== expectedOrigin) ||
    (origin === null && request.headers.get("sec-fetch-site") === "cross-site")
  ) {
    throw new BoardError("FORBIDDEN", 403, "허용되지 않은 요청입니다.");
  }
}

export async function readJson(request: Request): Promise<unknown> {
  const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new BoardError("UNSUPPORTED_MEDIA_TYPE", 415, "JSON 형식으로 요청해 주세요.");
  }
  try {
    return await request.json();
  } catch {
    throw new BoardError("VALIDATION_ERROR", 400, "올바른 JSON을 입력해 주세요.");
  }
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
  return Response.json(body, {
    status: error instanceof BoardError ? error.status : 500,
    headers: { "Cache-Control": "no-store" },
  });
}
