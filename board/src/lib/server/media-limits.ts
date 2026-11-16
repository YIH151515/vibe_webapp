import { BoardError } from "./errors";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_MULTIPART_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
export const MEDIA_TIMEOUT_MS = 60_000;
export function mediaUnavailable(): BoardError {
  return new BoardError("SERVICE_UNAVAILABLE", 503, "이미지를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", undefined, 1);
}

/** One deadline covers the entire operation, including a streamed response. */
export function mediaDeadline(...signals: (AbortSignal | undefined)[]) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, MEDIA_TIMEOUT_MS);
  timer.unref();
  for (const signal of signals) {
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    abort,
    dispose() {
      clearTimeout(timer);
      for (const signal of signals) signal?.removeEventListener("abort", abort);
    },
  };
}
