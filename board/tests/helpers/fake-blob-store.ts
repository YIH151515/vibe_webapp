import { createHash } from "node:crypto";
import type { BlobStore } from "../../src/lib/server/blob-store";
import { assertBlobName } from "../../src/lib/server/blob-store";
import { BoardError } from "../../src/lib/server/errors";
import { mediaUnavailable } from "../../src/lib/server/media-limits";

type Operation = "put" | "read" | "head" | "remove";
type Entry = { bytes: Buffer; etag: string };
/** Azurite has no soft delete. This clocked model is only for retention/accounting tests. */
export class FakeBlobStore implements BlobStore {
  readonly active = new Map<string, Entry>();
  readonly deleted: { name: string; entry: Entry; expiresAt: number }[] = [];
  readonly calls: { operation: Operation; name: string }[] = [];
  beforeOperation?: (operation: Operation, name: string) => Promise<void>;
  private failures: Operation[] = [];
  constructor(private readonly now: () => Date = () => new Date()) {}
  failOnce(operation: Operation) { this.failures.push(operation); }
  private async begin(operation: Operation, name: string, signal?: AbortSignal) {
    assertBlobName(name); this.calls.push({ operation, name });
    await this.beforeOperation?.(operation, name);
    const index = this.failures.indexOf(operation);
    if (index >= 0) { this.failures.splice(index, 1); throw mediaUnavailable(); }
    if (signal?.aborted) throw mediaUnavailable();
  }
  async put(name: string, bytes: Buffer, signal?: AbortSignal) {
    await this.begin("put", name, signal);
    if (this.active.has(name)) throw new BoardError("MEDIA_CONFLICT", 409, "이미 처리된 이미지입니다.");
    const etag = '"' + createHash("sha256").update(bytes).digest("hex") + '"';
    this.active.set(name, { bytes: Buffer.from(bytes), etag }); return { etag };
  }
  async head(name: string) {
    await this.begin("head", name); const entry = this.active.get(name);
    return entry ? { bytes: entry.bytes.length, etag: entry.etag } : null;
  }
  async read(name: string, signal?: AbortSignal) {
    await this.begin("read", name, signal); const entry = this.active.get(name);
    if (!entry) throw new BoardError("NOT_FOUND", 404, "이미지를 찾을 수 없습니다.");
    return { bytes: entry.bytes.length, etag: entry.etag, stream: new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Uint8Array.from(entry.bytes)); controller.close(); },
    }) };
  }
  async remove(name: string) {
    await this.begin("remove", name); const entry = this.active.get(name);
    if (entry) { this.deleted.push({ name, entry, expiresAt: this.now().getTime() + 7 * 86400000 }); this.active.delete(name); }
  }
  retainedBytes() {
    return [...this.active.values()].reduce((sum, entry) => sum + entry.bytes.length, 0) +
      this.deleted.filter(entry => entry.expiresAt > this.now().getTime()).reduce((sum, entry) => sum + entry.entry.bytes.length, 0);
  }
}
