import { Readable } from "node:stream";
import { AzureCliCredential, ManagedIdentityCredential } from "@azure/identity";
import { BlobServiceClient, StorageSharedKeyCredential, newPipeline } from "@azure/storage-blob";
import { assertTestDatabase } from "./database";
import { BoardError } from "./errors";
import { mediaDeadline, mediaUnavailable } from "./media-limits";

export interface BlobStore {
  put(name: string, bytes: Buffer, signal?: AbortSignal): Promise<{ etag: string }>;
  read(name: string, signal?: AbortSignal): Promise<{ stream: ReadableStream<Uint8Array>; bytes: number; etag: string }>;
  head(name: string): Promise<{ bytes: number; etag: string } | null>;
  remove(name: string): Promise<void>;
}
function configError(): never { throw new BoardError("SERVICE_UNAVAILABLE", 503, "이미지 저장소 설정을 확인해 주세요."); }
export function assertBlobName(name: string): void {
  if (!/^images\/[a-f0-9]{32}\.webp$/.test(name)) throw new BoardError("VALIDATION_ERROR", 400, "올바른 이미지 경로가 필요합니다.");
}
export function assertMediaTestStorage(env: NodeJS.ProcessEnv): void {
  assertTestDatabase(env);
  if (env.NODE_ENV !== "test" || env.STORAGE_AUTH_MODE !== "azurite" || env.WEBSITE_INSTANCE_ID ||
    !/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/boardtest$/.test(env.STORAGE_BLOB_SERVICE_URL ?? "") ||
    Number(new URL(env.STORAGE_BLOB_SERVICE_URL!).port) > 65535 ||
    env.AZURITE_ACCOUNT !== "boardtest" || !/^[A-Za-z0-9+/]{43}=$/.test(env.AZURITE_KEY ?? "") ||
    !/^board-test-[a-f0-9]{32}$/.test(env.STORAGE_CONTAINER ?? "")) configError();
}
const status = (error: unknown) => (error as { statusCode?: number } | null)?.statusCode;
const missing = () => new BoardError("NOT_FOUND", 404, "이미지를 찾을 수 없습니다.");

export function mediaStoragePipeline(credential: Parameters<typeof newPipeline>[0]) {
  const pipeline = newPipeline(credential, {
    retryOptions: { maxTries: 2, tryTimeoutInMs: 25_000, retryDelayInMs: 200, maxRetryDelayInMs: 1000 },
  });
  // The pinned SDK has no serviceVersion constructor option. This public policy
  // sets the wire header before the authentication/signing phase, including retries.
  pipeline.factories.push({ create(next) { return { async sendRequest(request) {
    request.headers.set("x-ms-version", "2023-11-03");
    return next.sendRequest(request);
  } }; } });
  return pipeline;
}

export function createBlobStore(env: NodeJS.ProcessEnv): BlobStore {
  const mode = env.STORAGE_AUTH_MODE;
  let credential;
  if (mode === "azurite") {
    assertMediaTestStorage(env);
    credential = new StorageSharedKeyCredential(env.AZURITE_ACCOUNT!, env.AZURITE_KEY!);
  } else {
    if (env.APP_TEST_MODE === "1" || env.NODE_ENV === "test" || env.AZURITE_ACCOUNT || env.AZURITE_KEY ||
      !/^https:\/\/[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(env.STORAGE_BLOB_SERVICE_URL ?? "") || env.STORAGE_CONTAINER !== "board-images") configError();
    if (env.WEBSITE_INSTANCE_ID) {
      if (mode !== "managed-identity") configError();
      credential = new ManagedIdentityCredential();
    } else {
      if (mode !== "azure-cli") configError();
      credential = new AzureCliCredential();
    }
  }
  const service = new BlobServiceClient(env.STORAGE_BLOB_SERVICE_URL!, mediaStoragePipeline(credential));
  const container = service.getContainerClient(env.STORAGE_CONTAINER!);
  const client = (name: string) => { assertBlobName(name); return container.getBlockBlobClient(name); };
  return {
    async put(name, bytes, signal) {
      const blob = client(name);
      const deadline = mediaDeadline(signal);
      try {
        const response = await blob.uploadData(bytes, { abortSignal: deadline.signal, concurrency: 1,
          conditions: { ifNoneMatch: "*" }, blobHTTPHeaders: { blobContentType: "image/webp" } });
        if (!response.etag) throw mediaUnavailable();
        return { etag: response.etag };
      } catch (error) {
        if (status(error) === 409 || status(error) === 412) throw new BoardError("MEDIA_CONFLICT", 409, "이미 처리된 이미지입니다.");
        throw mediaUnavailable();
      } finally { deadline.dispose(); }
    },
    async head(name) {
      const blob = client(name);
      const deadline = mediaDeadline();
      try {
        const result = await blob.getProperties({ abortSignal: deadline.signal });
        if (!result.etag || !Number.isSafeInteger(result.contentLength)) throw mediaUnavailable();
        return { etag: result.etag, bytes: result.contentLength! };
      } catch (error) { if (status(error) === 404) return null; throw mediaUnavailable(); }
      finally { deadline.dispose(); }
    },
    async remove(name) {
      const blob = client(name);
      const deadline = mediaDeadline();
      try { await blob.delete({ abortSignal: deadline.signal }); }
      catch (error) { if (status(error) !== 404) throw mediaUnavailable(); }
      finally { deadline.dispose(); }
    },
    async read(name, signal) {
      const blob = client(name);
      const deadline = mediaDeadline(signal);
      try {
        const result = await blob.download(0, undefined, { abortSignal: deadline.signal, maxRetryRequests: 0 });
        const body = result.readableStreamBody as Readable | undefined;
        if (!body || !result.etag || !Number.isSafeInteger(result.contentLength)) { body?.destroy(); throw mediaUnavailable(); }
        // Node's adapter preserves backpressure; our wrapper sanitizes late stream errors.
        const source = Readable.toWeb(body, { strategy: { highWaterMark: 65536, size: chunk => chunk.byteLength } }) as ReadableStream<Uint8Array>;
        const reader = source.getReader();
        const finish = () => { deadline.signal.removeEventListener("abort", abort); deadline.dispose(); };
        const abort = () => { body.destroy(mediaUnavailable()); };
        deadline.signal.addEventListener("abort", abort, { once: true });
        if (deadline.signal.aborted) abort();
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const chunk = await reader.read();
              if (chunk.done) { finish(); controller.close(); }
              else controller.enqueue(chunk.value);
            } catch { finish(); controller.error(mediaUnavailable()); }
          },
          async cancel() { deadline.abort(); try { await reader.cancel(); } finally { finish(); } },
        }, { highWaterMark: 65536, size: chunk => chunk.byteLength });
        return { stream, etag: result.etag, bytes: result.contentLength! };
      } catch (error) {
        deadline.dispose();
        if (status(error) === 404) throw missing();
        throw mediaUnavailable();
      }
    },
  };
}

let singleton: BlobStore | undefined;
export function getBlobStore(): BlobStore { return singleton ??= createBlobStore(process.env); }
