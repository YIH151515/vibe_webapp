import { createHash, randomUUID } from "node:crypto";
import sql, { type ConnectionPool } from "mssql";
import type { BlobStore } from "./blob-store";
import { BoardError } from "./errors";
import { MAX_IMAGE_BYTES, mediaDeadline, mediaUnavailable } from "./media-limits";
import { UUID, conflict, mediaTransaction, queueDeletion, safeBytes } from "./media-transactions";
import { finishMediaRequest, reserveMediaRequest } from "./media-rate-limit";
import { bearer, readUploadSession, requireEditor } from "./upload-sessions";
import { readImageFile } from "./multipart";
import { normalizeImage } from "./image-processing";

export type ImageAssetDto = { id: string; url: string; width: number; height: number; bytes: number; inputBytes: number; mimeType: "image/webp" };
function dto(row: { id: string; width: number; height: number; stored_bytes: number; input_bytes: number }): ImageAssetDto {
  const id = row.id.toLowerCase();
  return { id, url: `/api/images/${id}`, width: row.width, height: row.height, bytes: row.stored_bytes, inputBytes: row.input_bytes, mimeType: "image/webp" };
}
export function createMediaService(pool: ConnectionPool, store: BlobStore) {
  async function performUpload(request: Request, clientKey: string, deadline: ReturnType<typeof mediaDeadline>): Promise<{ status: 200 | 201; asset: ImageAssetDto }> {
    requireEditor();
    const key = request.headers.get("idempotency-key") ?? "";
    if (!UUID.test(key)) throw new BoardError("VALIDATION_ERROR", 400, "올바른 업로드 요청 번호가 필요합니다.");
    const reservation = await reserveMediaRequest(pool, "file", clientKey);
    let received = 0, ownId: string | undefined;
    try {
      const session = await readUploadSession(pool, bearer(request), clientKey);
      const pending = await mediaTransaction(pool, async tx => {
        const current = (await new sql.Request(tx).input("id", sql.UniqueIdentifier, session.id)
          .query("SELECT * FROM dbo.upload_sessions WITH(UPDLOCK,HOLDLOCK) WHERE id=@id AND state='active' AND expires_at>SYSUTCDATETIME()")).recordset[0];
        if (!current) throw conflict();
        const existing = (await new sql.Request(tx).input("sid", sql.UniqueIdentifier, session.id).input("key", sql.UniqueIdentifier, key)
          .query("SELECT * FROM dbo.image_assets WITH(UPDLOCK,HOLDLOCK) WHERE session_id=@sid AND idempotency_key=@key")).recordset[0];
        if (existing) { if (existing.state !== "ready") throw conflict(); return existing; }
        if (current.file_count >= 5) throw conflict("이미지는 편집 세션당 최대 5장입니다. 이미지를 줄이거나 다시 편집해 주세요.");
        const capacity = (await new sql.Request(tx).query("SELECT occupied_bytes FROM dbo.media_capacity WHERE id=1")).recordset[0];
        if (safeBytes(capacity.occupied_bytes) + MAX_IMAGE_BYTES > 1073741824) throw new BoardError("STORAGE_FULL", 409, "이미지 저장 공간이 가득 찼습니다.");
        const id = randomUUID();
        await new sql.Request(tx).input("id", sql.UniqueIdentifier, id).input("sid", sql.UniqueIdentifier, session.id)
          .input("key", sql.UniqueIdentifier, key).input("name", sql.NVarChar(120), "images/" + id.replaceAll("-", "") + ".webp").query(`
            UPDATE dbo.media_capacity SET occupied_bytes=occupied_bytes+5242880 WHERE id=1;
            UPDATE dbo.upload_sessions SET file_count=file_count+1 WHERE id=@sid;
            INSERT dbo.image_assets(id,session_id,idempotency_key,state,blob_name,lease_until)
            VALUES(@id,@sid,@key,'uploading',@name,DATEADD(second,120,SYSUTCDATETIME()));
          `);
        return { id, state: "uploading" };
      }, deadline.signal);
      if (pending.state === "uploading") ownId = pending.id;
      const input = await readImageFile(request, count => { received = count; }, deadline.signal);
      const sha = createHash("sha256").update(input.bytes).digest("hex");
      if (!ownId) {
        if (pending.input_sha256 !== sha) throw conflict();
        // A cancellation/detach racing the body read must not resurrect a ready DTO.
        const current = await readUploadSession(pool, bearer(request), clientKey);
        const ready = (await pool.request().input("id", sql.UniqueIdentifier, pending.id).input("sid", sql.UniqueIdentifier, current.id)
          .query("SELECT * FROM dbo.image_assets WHERE id=@id AND session_id=@sid AND state='ready'")).recordset[0];
        if (!ready) throw conflict();
        return { status: 200, asset: dto(ready) };
      }
      const image = await normalizeImage(input, deadline.signal);
      const blobName = "images/" + ownId.replaceAll("-", "") + ".webp";
      await mediaTransaction(pool, async tx => {
        if (deadline.signal.aborted) throw mediaUnavailable();
        const current = (await new sql.Request(tx).input("sid", sql.UniqueIdentifier, session.id)
          .query("SELECT * FROM dbo.upload_sessions WITH(UPDLOCK,HOLDLOCK) WHERE id=@sid AND state='active' AND expires_at>SYSUTCDATETIME()")).recordset[0];
        if (!current) throw conflict();
        if (safeBytes(current.input_bytes) + input.bytes.length > 20971520) throw conflict("이미지 원본 합계는 20MiB 이하로 줄여 주세요.");
        const updated = await new sql.Request(tx).input("id", sql.UniqueIdentifier, ownId).input("sid", sql.UniqueIdentifier, session.id)
          .input("bytes", sql.Int, input.bytes.length).input("sha", sql.Char(64), sha).query(`
            UPDATE dbo.image_assets SET input_bytes=@bytes,input_sha256=@sha,blob_write_started=1
            WHERE id=@id AND state='uploading' AND lease_until>SYSUTCDATETIME();
            IF @@ROWCOUNT=1 BEGIN UPDATE dbo.upload_sessions SET input_bytes=input_bytes+@bytes WHERE id=@sid; SELECT 1 AS ok; END;
          `);
        if (!updated.recordset?.[0]) throw conflict();
      }, deadline.signal);
      await store.put(blobName, image.bytes, deadline.signal);
      const asset = await mediaTransaction(pool, async tx => {
        if (deadline.signal.aborted) throw mediaUnavailable();
        const current = (await new sql.Request(tx).input("sid", sql.UniqueIdentifier, session.id)
          .query("SELECT id FROM dbo.upload_sessions WITH(UPDLOCK,HOLDLOCK) WHERE id=@sid AND state='active' AND expires_at>SYSUTCDATETIME()")).recordset[0];
        if (!current) throw conflict();
        const result = await new sql.Request(tx).input("id", sql.UniqueIdentifier, ownId).input("bytes", sql.Int, image.bytes.length)
          .input("width", sql.Int, image.width).input("height", sql.Int, image.height).query(`
            UPDATE dbo.image_assets SET state='ready',stored_bytes=@bytes,width=@width,height=@height,charge_bytes=@bytes
            OUTPUT inserted.* WHERE id=@id AND state='uploading' AND lease_until>SYSUTCDATETIME();
            IF @@ROWCOUNT=1 UPDATE dbo.media_capacity SET occupied_bytes=occupied_bytes-5242880+@bytes WHERE id=1;
          `);
        if (!result.recordset[0]) throw conflict();
        return dto(result.recordset[0]);
      }, deadline.signal);
      ownId = undefined;
      return { status: 201, asset };
    } catch (error) {
      if (ownId) await mediaTransaction(pool, async tx => {
        const asset = (await new sql.Request(tx).input("id", sql.UniqueIdentifier, ownId)
          .query("SELECT * FROM dbo.image_assets WITH(UPDLOCK,HOLDLOCK) WHERE id=@id")).recordset[0];
        if (!asset || !["uploading", "deleting"].includes(asset.state)) return;
        if (asset.blob_write_started) { await queueDeletion(tx, asset.id); return; }
        // No Blob write could have started: this reservation can be released now.
        await new sql.Request(tx).input("id", sql.UniqueIdentifier, asset.id).input("sid", sql.UniqueIdentifier, asset.session_id)
          .input("charge", sql.BigInt, safeBytes(asset.charge_bytes)).input("input", sql.BigInt, asset.input_bytes).query(`
            DELETE dbo.image_delete_jobs WHERE asset_id=@id;
            UPDATE dbo.media_capacity SET occupied_bytes=occupied_bytes-@charge WHERE id=1;
            UPDATE dbo.upload_sessions SET file_count=file_count-1,input_bytes=input_bytes-@input WHERE id=@sid;
            UPDATE dbo.image_assets SET state='purged',post_id=NULL,charge_bytes=0,deleted_at=SYSUTCDATETIME(),purge_after=SYSUTCDATETIME() WHERE id=@id;
          `);
      });
      if (error instanceof BoardError) throw error;
      throw mediaUnavailable();
    } finally {
      await finishMediaRequest(pool, reservation, received);
    }
  }
  return { async uploadImage(request: Request, clientKey: string): Promise<{ status: 200 | 201; asset: ImageAssetDto }> {
    const deadline = mediaDeadline(request.signal);
    let abort: (() => void) | undefined;
    // SQL/remote I/O can complete after an HTTP disconnect. The caller still gets
    // a bounded response, while the observed work retains its durable reservation
    // and compensates safely; it cannot finalize a ready asset after this signal.
    const work = performUpload(request, clientKey, deadline).finally(() => deadline.dispose());
    try {
      return await Promise.race([work, new Promise<never>((_, reject) => {
        abort = () => reject(mediaUnavailable());
        if (deadline.signal.aborted) abort(); else deadline.signal.addEventListener("abort", abort, { once: true });
      })]);
    } finally { if (abort) deadline.signal.removeEventListener("abort", abort); }
  } };
}
