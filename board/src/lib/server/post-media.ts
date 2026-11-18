import sql, { type ConnectionPool } from "mssql";
import { normalizeDocument } from "../posts/document";
import type { Post } from "../posts/types";
import type { NormalizedPostInput } from "./validation";
import { BoardError } from "./errors";
import { conflict, mediaTransaction, queueDeletion, safeBytes } from "./media-transactions";
import { tokenHash } from "./upload-sessions";
import { assertSessionInTransaction } from "./auth-session";
import { getAccountKey, forbidden, type Principal } from "./auth-principal";
import { requirePostOwner } from "./post-authorization";

export type PostMutationContext = { principal: Principal; clientKey: string };
const missing = () => new BoardError("NOT_FOUND", 404, "글을 찾을 수 없습니다.");
export async function persistPostWithMedia(pool: ConnectionPool, id: number | null, input: NormalizedPostInput,
  context: PostMutationContext): Promise<Post> {
  const imageIds = input.document ? normalizeDocument(input.document).imageIds : [];
  const token = input.uploadSessionToken, principal = context.principal;
  if (context.clientKey !== getAccountKey(principal)) throw forbidden();
  return mediaTransaction(pool, async tx => {
    await assertSessionInTransaction(tx, principal);
    let session;
    if (token) {
      session = (await new sql.Request(tx).input("hash", sql.Char(64), tokenHash(token)).input("key", sql.Char(64), context!.clientKey)
        .query("SELECT * FROM dbo.upload_sessions WITH(UPDLOCK,HOLDLOCK) WHERE token_hash=@hash AND client_key=@key AND state='active' AND expires_at>SYSUTCDATETIME()")).recordset[0];
      if (!session || session.auth_session_hash !== principal.sessionHash ||
        session.owner_tenant_id?.toLowerCase() !== principal.tenantId || session.owner_object_id?.toLowerCase() !== principal.objectId ||
        (session.target_post_id === null ? null : Number(session.target_post_id)) !== id) throw conflict();
    }
    let existing;
    if (id !== null) {
      existing = (await new sql.Request(tx).input("id", sql.BigInt, id)
        .query("SELECT author_tenant_id,author_object_id,nickname,content_format FROM dbo.posts WITH(UPDLOCK,HOLDLOCK) WHERE id=@id")).recordset[0];
      if (!existing) throw missing();
      requirePostOwner(existing, principal);
      if (input.contentFormat === "plain" && existing.content_format === "rich_v1") throw conflict();
    }
    let inputBytes = 0;
    // The capacity lock serializes all writers; sorted UUIDs fix the remaining lock order.
    for (const assetId of [...imageIds].sort()) {
      const asset = (await new sql.Request(tx).input("id", sql.UniqueIdentifier, assetId)
        .query("SELECT * FROM dbo.image_assets WITH(UPDLOCK,HOLDLOCK) WHERE id=@id")).recordset[0];
      const retained = asset?.state === "attached" && id !== null && Number(asset.post_id) === id;
      const owned = asset?.state === "ready" && session && asset.session_id.toLowerCase() === session.id.toLowerCase();
      if (!retained && !owned) throw conflict();
      inputBytes += safeBytes(asset.input_bytes);
    }
    if (inputBytes > 20971520) throw conflict("글에 첨부할 이미지 원본 합계는 20MiB 이하로 줄여 주세요.");
    const request = new sql.Request(tx).input("id", sql.BigInt, id)
      .input("tenant", sql.UniqueIdentifier, principal.tenantId).input("owner", sql.UniqueIdentifier, principal.objectId)
      .input("title", sql.NVarChar(100), input.title).input("content", sql.NVarChar(sql.MAX), input.content)
      .input("nickname", sql.NVarChar(256), principal.displayName).input("format", sql.VarChar(8), input.contentFormat)
      .input("json", sql.NVarChar(sql.MAX), input.document ? JSON.stringify(input.document) : null);
    const result = await request.query<{ id: string; created_at: Date; nickname: string }>(id === null ? `
      INSERT dbo.posts(title,content,nickname,password_hash,content_format,content_json,author_tenant_id,author_object_id)
      OUTPUT inserted.id,inserted.created_at,inserted.nickname VALUES(@title,@content,@nickname,NULL,@format,@json,@tenant,@owner);
    ` : `UPDATE dbo.posts SET title=@title,content=@content,content_format=@format,content_json=@json
      OUTPUT inserted.id,inserted.created_at,inserted.nickname WHERE id=@id AND author_tenant_id=@tenant AND author_object_id=@owner;`);
    const row = result.recordset[0]; if (!row) throw missing();
    const postId = Number(row.id);
    const previous = (await new sql.Request(tx).input("post", sql.BigInt, postId)
      .query("SELECT id FROM dbo.image_assets WITH(UPDLOCK,HOLDLOCK) WHERE post_id=@post AND state='attached' ORDER BY id")).recordset;
    for (const asset of previous) if (!imageIds.includes(asset.id.toLowerCase())) await queueDeletion(tx, asset.id);
    for (const assetId of [...imageIds].sort()) await new sql.Request(tx).input("id", sql.UniqueIdentifier, assetId).input("post", sql.BigInt, postId)
      .query("UPDATE dbo.image_assets SET state='attached',post_id=@post,attached_at=COALESCE(attached_at,SYSUTCDATETIME()) WHERE id=@id");
    if (session) {
      await new sql.Request(tx).input("id", sql.UniqueIdentifier, session.id).query("UPDATE dbo.upload_sessions SET state='consumed' WHERE id=@id");
      const unused = (await new sql.Request(tx).input("id", sql.UniqueIdentifier, session.id)
        .query("SELECT id FROM dbo.image_assets WITH(UPDLOCK,HOLDLOCK) WHERE session_id=@id AND state IN('uploading','ready') ORDER BY id")).recordset;
      for (const asset of unused) await queueDeletion(tx, asset.id);
    }
    return { id: postId, title: input.title, nickname: row.nickname, content: input.content, contentFormat: input.contentFormat,
      canEdit: true, canDelete: true,
      document: input.document, createdAt: row.created_at.toISOString() };
  });
}
export async function deletePostAndDetach(pool: ConnectionPool, id: number, principal: Principal, asAdmin = false): Promise<void> {
  await mediaTransaction(pool, async tx => {
    await assertSessionInTransaction(tx, principal, asAdmin);
    // Sessions are locked before the parent post, even for a plain deletion.
    const sessions = (await new sql.Request(tx).input("id", sql.BigInt, id)
      .query("SELECT id FROM dbo.upload_sessions WITH(UPDLOCK,HOLDLOCK) WHERE target_post_id=@id AND state='active' ORDER BY id")).recordset;
    const row = (await new sql.Request(tx).input("id", sql.BigInt, id).query("SELECT author_tenant_id,author_object_id FROM dbo.posts WITH(UPDLOCK,HOLDLOCK) WHERE id=@id")).recordset[0];
    if (!row) throw missing();
    if (!asAdmin) requirePostOwner(row, principal);
    for (const session of sessions) await new sql.Request(tx).input("id", sql.UniqueIdentifier, session.id).query("UPDATE dbo.upload_sessions SET state='cancelled' WHERE id=@id");
    const assets = (await new sql.Request(tx).input("id", sql.BigInt, id).query(`
      SELECT a.id FROM dbo.image_assets a WITH(UPDLOCK,HOLDLOCK) WHERE a.post_id=@id OR
      (a.state IN('uploading','ready') AND a.session_id IN(SELECT id FROM dbo.upload_sessions WHERE target_post_id=@id)) ORDER BY a.id;
    `)).recordset;
    for (const asset of assets) await queueDeletion(tx, asset.id);
    await new sql.Request(tx).input("id", sql.BigInt, id).query("DELETE dbo.posts WHERE id=@id");
  });
}
