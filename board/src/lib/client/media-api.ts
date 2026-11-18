import { ApiError, request } from "./api";
import type { ImageAssetDto } from "../server/media-service";

const invalidResponse = () => new ApiError(503, "INTERNAL_ERROR", "응답을 확인하지 못했습니다. 다시 시도해 주세요.");
export async function issueUploadSession(input: { postId?: number }, signal?: AbortSignal): Promise<{ token: string; expiresAt: string }> {
  const value = await request<{ token: string; expiresAt: string }>("/api/upload-sessions", { method: "POST", credentials: "same-origin", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!value || typeof value.token !== "string" || value.token.length !== 64 || !/^[a-f0-9]{64}$/.test(value.token) || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))) throw invalidResponse();
  return value;
}
export async function uploadImage(file: File, token: string, idempotencyKey: string, signal?: AbortSignal): Promise<ImageAssetDto> {
  const body = new FormData(); body.set("file", file);
  const value = await request<ImageAssetDto>("/api/images/uploads", { method: "POST", credentials: "same-origin", signal, body,
    headers: { Authorization: "Bearer " + token, "Idempotency-Key": idempotencyKey } });
  if (!value || typeof value.id !== "string" || value.id.length !== 36 || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.id) ||
    value.url !== `/api/images/${value.id}` || value.mimeType !== "image/webp" ||
    ![value.width, value.height].every(number => Number.isInteger(number) && number > 0 && number <= 1920) ||
    ![value.bytes, value.inputBytes].every(number => Number.isInteger(number) && number > 0 && number <= 5242880)) throw invalidResponse();
  return value;
}
export function cancelUploadSession(token: string, signal?: AbortSignal): Promise<void> {
  return request("/api/upload-sessions/current", { method: "DELETE", credentials: "same-origin", signal,
    headers: { Authorization: "Bearer " + token }, keepalive: true });
}
