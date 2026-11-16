import { createHash } from "node:crypto";
import sharp from "sharp";
import { BoardError } from "./errors";
import type { ImageInput } from "./multipart";
import { MAX_IMAGE_BYTES, mediaDeadline, mediaUnavailable } from "./media-limits";

export type NormalizedImage = { bytes: Buffer; inputBytes: number; inputSha256: string; width: number; height: number; mimeType: "image/webp" };
let active = 0;
const invalid = () => new BoardError("VALIDATION_ERROR", 400, "올바른 정지 이미지를 보내 주세요.");
const large = () => new BoardError("PAYLOAD_TOO_LARGE", 413, "이미지 크기 제한을 초과했습니다.");

function format(bytes: Buffer): "jpeg" | "png" | "webp" | undefined {
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
}
// libvips may expose only APNG's first frame: reject animation chunks before decode.
function animated(bytes: Buffer, kind: string): boolean {
  if (kind !== "png" && kind !== "webp") return false;
  let offset = kind === "png" ? 8 : 12;
  while (offset + 8 <= bytes.length) {
    const length = kind === "png" ? bytes.readUInt32BE(offset) : bytes.readUInt32LE(offset + 4);
    const type = bytes.toString("ascii", offset + (kind === "png" ? 4 : 0), offset + (kind === "png" ? 8 : 4));
    if (type === "acTL" || type === "ANIM" || type === "ANMF") return true;
    const next = offset + 8 + length + (kind === "png" ? 4 : length % 2);
    if (next > bytes.length || next <= offset) throw invalid();
    offset = next;
  }
  return false;
}

export async function normalizeImage(input: ImageInput, signal?: AbortSignal): Promise<NormalizedImage> {
  if (signal?.aborted) throw mediaUnavailable();
  if (input.bytes.length > MAX_IMAGE_BYTES) throw large();
  const kind = format(input.bytes);
  if (!kind || input.mimeType !== `image/${kind}`) throw new BoardError("UNSUPPORTED_MEDIA_TYPE", 415, "이미지 형식이 일치하지 않습니다.");
  if (animated(input.bytes, kind)) throw invalid();
  if (active >= 2) throw mediaUnavailable();
  active++;
  const deadline = mediaDeadline(signal);
  const work = (async () => {
    const image = sharp(input.bytes, { limitInputPixels: 24_000_000, failOn: "error" }).timeout({ seconds: 60 });
    const meta = await image.metadata();
    if (meta.format !== kind || !meta.width || !meta.height || (meta.pages ?? 1) !== 1 || meta.loop !== undefined || meta.delay?.length) throw invalid();
    if (meta.width > 10_000 || meta.height > 10_000 || meta.width * meta.height > 24_000_000) throw large();
    const { data, info } = await image.rotate().resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    if (data.length > MAX_IMAGE_BYTES) throw large();
    if (!info.width || !info.height || info.width > 1920 || info.height > 1920) throw invalid();
    return { bytes: data, width: info.width, height: info.height, mimeType: "image/webp" as const,
      inputBytes: input.bytes.length, inputSha256: createHash("sha256").update(input.bytes).digest("hex") };
  })().catch((error: unknown) => {
    if (error instanceof BoardError) throw error;
    // Only classify known local decoder failures; never expose the decoder message.
    if (error instanceof Error && /pixel limit/i.test(error.message)) throw large();
    if (error instanceof Error && /timeout/i.test(error.message)) throw mediaUnavailable();
    throw invalid();
  }).finally(() => { active--; });
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      onAbort = () => reject(mediaUnavailable());
      if (deadline.signal.aborted) onAbort();
      else deadline.signal.addEventListener("abort", onAbort, { once: true });
    })]);
  } finally {
    if (onAbort) deadline.signal.removeEventListener("abort", onAbort);
    deadline.dispose();
    // The native slot is held until work settles, even if the caller aborts early.
  }
}
