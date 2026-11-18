import { createHash, randomBytes, randomUUID } from "node:crypto";
import sql, { type ConnectionPool } from "mssql";
import { BoardError } from "./errors";
import { editorEnabled } from "./editor-config";
import { parsePostId } from "./validation";
import { reserveMediaRequest, finishMediaRequest } from "./media-rate-limit";
import { conflict, mediaTransaction, queueDeletion } from "./media-transactions";
import { assertSessionInTransaction, requireActivePrincipal } from "./auth-session";
import { unauthorized, getAccountKey, type Principal } from "./auth-principal";
import { requirePostOwner } from "./post-authorization";

export type UploadSession = { id: string; expiresAt: Date; targetPostId: number | null; ownerTenantId: string; ownerObjectId: string; authSessionHash: string };
export function requireEditor(): void {
  if (!editorEnabled()) throw new BoardError("SERVICE_UNAVAILABLE", 503, "이미지 에디터를 준비 중입니다.");
}
export function tokenHash(token: string): string {
  if (typeof token !== "string" || token.length !== 64 || !/^[a-f0-9]{64}$/.test(token)) throw unauthorized();
  return createHash("sha256").update(token).digest("hex");
}
export function bearer(request: Request): string {
  const value = request.headers.get("authorization") ?? "", match = /^Bearer ([a-f0-9]{64})$/.exec(value);
  if (!match || value.length !== 71) throw unauthorized();
  return match[1];
}
export function parseSessionInput(value: unknown): { postId?: number } {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => key !== "postId"))
    throw new BoardError("VALIDATION_ERROR", 400, "올바른 편집 요청이 필요합니다.");
  const input = value as Record<string, unknown>;
  if (input.postId === undefined) return {};
  if (typeof input.postId !== "number") throw new BoardError("VALIDATION_ERROR", 400, "글 번호를 확인해 주세요.");
  return { postId: parsePostId(String(input.postId)) };
}
export async function issueUploadSession(pool: ConnectionPool, principal: Principal, input: { postId?: number }): Promise<{ token: string; expiresAt: string }> {
  await requireActivePrincipal(pool, principal); requireEditor(); const parsed = parseSessionInput(input), clientKey = getAccountKey(principal);
  const reservation = await reserveMediaRequest(pool, "session", clientKey);
  try {
    const token = randomBytes(32).toString("hex");
    const expiresAt = await mediaTransaction(pool, async tx => {
      await assertSessionInTransaction(tx, principal);
      if (parsed.postId !== undefined) {
        const post = (await new sql.Request(tx).input("id", sql.BigInt, parsed.postId)
          .query("SELECT author_tenant_id,author_object_id FROM dbo.posts WITH(UPDLOCK,HOLDLOCK) WHERE id=@id")).recordset[0];
        if (!post) throw new BoardError("NOT_FOUND", 404, "글을 찾을 수 없습니다.");
        requirePostOwner(post, principal);
      }
      const row = (await new sql.Request(tx).input("id", sql.UniqueIdentifier, randomUUID())
        .input("token", sql.Char(64), tokenHash(token)).input("key", sql.Char(64), clientKey)
        .input("post", sql.BigInt, parsed.postId ?? null).input("tenant", sql.UniqueIdentifier, principal.tenantId)
        .input("owner", sql.UniqueIdentifier, principal.objectId).input("sid", sql.Char(64), principal.sessionHash).query<{ expires_at: Date }>(
          "INSERT dbo.upload_sessions(id,token_hash,client_key,target_post_id,author_hash,expires_at,owner_tenant_id,owner_object_id,auth_session_hash) OUTPUT inserted.expires_at VALUES(@id,@token,@key,@post,NULL,DATEADD(second,900,SYSUTCDATETIME()),@tenant,@owner,@sid)"
        )).recordset[0];
      return row.expires_at.toISOString();
    });
    return { token, expiresAt };
  } finally { await finishMediaRequest(pool, reservation, 0); }
}
export function requireSessionOwner(row: { owner_tenant_id: string | null; owner_object_id: string | null; auth_session_hash: string | null }, principal: Principal): void {
  if (row.auth_session_hash !== principal.sessionHash || row.owner_tenant_id?.toLowerCase() !== principal.tenantId || row.owner_object_id?.toLowerCase() !== principal.objectId) throw unauthorized();
}
export async function readUploadSession(pool: ConnectionPool, token: string, principal: Principal, now?: Date): Promise<UploadSession> {
  await requireActivePrincipal(pool, principal);
  const row = (await pool.request().input("hash", sql.Char(64), tokenHash(token)).input("key", sql.Char(64), getAccountKey(principal))
    .input("now", sql.DateTime2(3), now ?? null).query("SELECT * FROM dbo.upload_sessions WHERE token_hash=@hash AND client_key=@key AND expires_at>COALESCE(@now,SYSUTCDATETIME())")).recordset[0];
  if (!row) throw unauthorized(); requireSessionOwner(row, principal);
  if (row.state === "consumed") throw conflict();
  if (row.state !== "active") throw unauthorized();
  if (row.target_post_id !== null) {
    const post = (await pool.request().input("id", sql.BigInt, row.target_post_id).query("SELECT author_tenant_id,author_object_id FROM dbo.posts WHERE id=@id")).recordset[0];
    if (!post) throw new BoardError("NOT_FOUND", 404, "글을 찾을 수 없습니다."); requirePostOwner(post, principal);
  }
  return { id: row.id.toLowerCase(), expiresAt: row.expires_at, targetPostId: row.target_post_id === null ? null : Number(row.target_post_id), ownerTenantId: principal.tenantId, ownerObjectId: principal.objectId, authSessionHash: principal.sessionHash };
}
export async function cancelUploadSession(pool: ConnectionPool, token: string, principal: Principal): Promise<void> {
  const hash = tokenHash(token);
  await mediaTransaction(pool, async tx => {
    await assertSessionInTransaction(tx, principal);
    const row = (await new sql.Request(tx).input("hash", sql.Char(64), hash).input("key", sql.Char(64), getAccountKey(principal))
      .query("SELECT * FROM dbo.upload_sessions WITH(UPDLOCK,HOLDLOCK) WHERE token_hash=@hash AND client_key=@key AND expires_at>SYSUTCDATETIME()")).recordset[0];
    if (!row) throw unauthorized(); requireSessionOwner(row, principal);
    if (!["active", "cancelled"].includes(row.state)) throw unauthorized();
    if (row.state === "cancelled") return;
    await new sql.Request(tx).input("id", sql.UniqueIdentifier, row.id).query("UPDATE dbo.upload_sessions SET state='cancelled' WHERE id=@id");
    const assets = await new sql.Request(tx).input("id", sql.UniqueIdentifier, row.id).query("SELECT id FROM dbo.image_assets WITH(UPDLOCK,HOLDLOCK) WHERE session_id=@id AND state IN('uploading','ready') ORDER BY id");
    for (const asset of assets.recordset) await queueDeletion(tx, asset.id);
  });
}
