import sql, { type ConnectionPool } from "mssql";
import type { BlobStore } from "./blob-store";
import { BoardError } from "./errors";
import { UUID } from "./media-transactions";
import { mediaUnavailable } from "./media-limits";

import { requireActivePrincipal } from "./auth-session";
import type { Principal } from "./auth-principal";

export async function getPublishedImage(pool: ConnectionPool, store: BlobStore, id: string, request: Request, principal: Principal, headOnly = false): Promise<Response> {
  await requireActivePrincipal(pool, principal);
  if (!UUID.test(id)) throw new BoardError("NOT_FOUND", 404, "이미지를 찾을 수 없습니다.");
  const asset = (await pool.request().input("id", sql.UniqueIdentifier, id).query(`
    SELECT a.blob_name,a.stored_bytes FROM dbo.image_assets a JOIN dbo.posts p ON p.id=a.post_id WHERE a.id=@id AND a.state='attached';
  `)).recordset[0];
  if (!asset) throw new BoardError("NOT_FOUND", 404, "이미지를 찾을 수 없습니다.");
  const metadata = await store.head(asset.blob_name);
  if (!metadata) throw new BoardError("NOT_FOUND", 404, "이미지를 찾을 수 없습니다.");
  if (metadata.bytes !== asset.stored_bytes) throw mediaUnavailable();
  const headers = { "Content-Type": "image/webp", "Content-Length": String(metadata.bytes), "ETag": metadata.etag,
    "X-Content-Type-Options": "nosniff", "Cache-Control": "private,no-store" };
  const tags = request.headers.get("if-none-match")?.split(",").map(value => value.trim().replace(/^W\//, ""));
  if (tags?.includes(metadata.etag) || tags?.includes("*")) return new Response(null, { status: 304, headers });
  if (headOnly) return new Response(null, { headers });
  const result = await store.read(asset.blob_name, request.signal);
  if (result.bytes !== metadata.bytes || result.etag !== metadata.etag) { await result.stream.cancel(); throw mediaUnavailable(); }
  return new Response(result.stream, { headers });
}
