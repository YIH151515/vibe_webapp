import { BoardError } from "./errors";
import { MAX_IMAGE_BYTES, MAX_MULTIPART_BYTES, mediaDeadline, mediaUnavailable } from "./media-limits";

export type ImageInput = { bytes: Buffer; mimeType: "image/jpeg" | "image/png" | "image/webp"; receivedBytes: number };
const invalid = () => new BoardError("VALIDATION_ERROR", 400, "이미지 파일 한 개만 보내 주세요.");
const large = () => new BoardError("PAYLOAD_TOO_LARGE", 413, "이미지는 5MiB 이하로 보내 주세요.");

export async function readImageFile(request: Request, observeReceived: (bytes: number) => void, signal?: AbortSignal): Promise<ImageInput> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";")[0].trim().toLowerCase() !== "multipart/form-data")
    throw new BoardError("UNSUPPORTED_MEDIA_TYPE", 415, "multipart 형식으로 이미지를 보내 주세요.");
  // Accept one browser-generated boundary, with no ambiguous extra parameters.
  const boundary = /^multipart\/form-data\s*;\s*boundary=(?:"([ -~]+)"|([^\s;]+))\s*$/i.exec(contentType);
  const value = boundary?.[1] ?? boundary?.[2];
  if (!value || value.length > 70 || !/^[0-9A-Za-z'()+_,./:=? -]+$/.test(value) || value.endsWith(" ")) throw invalid();
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared))) throw invalid();
    if (Number(declared) > MAX_MULTIPART_BYTES) { void request.body?.cancel().catch(() => undefined); throw large(); }
  }
  const deadline = mediaDeadline(request.signal, signal);
  const reader = request.body?.getReader();
  const cancel = () => { void reader?.cancel().catch(() => undefined); };
  deadline.signal.addEventListener("abort", cancel, { once: true });
  if (deadline.signal.aborted) cancel();
  let receivedBytes = 0;
  try {
    if (!reader) throw invalid();
    const chunks: Uint8Array[] = [];
    while (true) {
      if (deadline.signal.aborted) throw mediaUnavailable();
      const chunk = await reader.read();
      if (deadline.signal.aborted) throw mediaUnavailable();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      observeReceived(Math.min(receivedBytes, MAX_MULTIPART_BYTES));
      if (receivedBytes > MAX_MULTIPART_BYTES) { void reader.cancel().catch(() => undefined); throw large(); }
      chunks.push(chunk.value);
    }
    if (declared !== null && Number(declared) !== receivedBytes) throw invalid();
    const bounded = new Request("http://multipart.invalid", {
      method: "POST", headers: { "content-type": contentType }, body: Uint8Array.from(Buffer.concat(chunks, receivedBytes)),
    });
    const entries = [...(await bounded.formData()).entries()];
    if (deadline.signal.aborted) throw mediaUnavailable();
    if (entries.length !== 1 || entries[0][0] !== "file" || !(entries[0][1] instanceof File)) throw invalid();
    const file = entries[0][1];
    if (file.size > MAX_IMAGE_BYTES) throw large();
    if (file.size === 0) throw invalid();
    const mimeType = file.type;
    if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp")
      throw new BoardError("UNSUPPORTED_MEDIA_TYPE", 415, "JPEG, PNG, WebP만 사용할 수 있습니다.");
    return { bytes: Buffer.from(await file.arrayBuffer()), mimeType, receivedBytes };
  } catch (error) {
    if (error instanceof BoardError) throw error;
    if (deadline.signal.aborted) throw mediaUnavailable();
    throw invalid();
  } finally {
    deadline.signal.removeEventListener("abort", cancel);
    reader?.releaseLock();
    deadline.dispose();
  }
}
