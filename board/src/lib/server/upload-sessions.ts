import { createHash, randomBytes, randomUUID } from "node:crypto";
import sql, { type ConnectionPool } from "mssql";
import { BoardError } from "./errors";
import { editorEnabled } from "./editor-config";
import { authorizePostPassword } from "./post-authorization";
import { parsePasswordInput, parsePostId } from "./validation";
import { withRateLimit } from "./rate-limit";
import { reserveMediaRequest, finishMediaRequest } from "./media-rate-limit";
import { conflict, mediaTransaction, queueDeletion } from "./media-transactions";

export type UploadSession = { id: string; expiresAt: Date; targetPostId: number | null; authorHash: string | null };
export function requireEditor(): void {
  if (!editorEnabled()) throw new BoardError("SERVICE_UNAVAILABLE", 503, "이미지 에디터를 준비 중입니다.");
}
export function tokenHash(token: string): string {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token) || token.length !== 64) throw new BoardError("UNAUTHENTICATED", 401, "업로드 세션을 확인해 주세요.");
  return createHash("sha256").update(token).digest("hex");
}
export function bearer(request: Request): string {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new BoardError("UNAUTHENTICATED", 401, "업로드 세션을 확인해 주세요.");
  return match[1];
}
export function parseSessionInput(value: unknown): { postId?: number; password?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["postId", "password"].includes(key)))
    throw new BoardError("VALIDATION_ERROR", 400, "올바른 편집 요청이 필요합니다.");
  const input = value as Record<string, unknown>;
  if (input.postId === undefined && input.password === undefined) return {};
  if (typeof input.postId !== "number") throw new BoardError("VALIDATION_ERROR", 400, "글 번호와 비밀번호를 함께 입력해 주세요.");
  return { postId: parsePostId(String(input.postId)), ...parsePasswordInput(input) };
}
export async function issueUploadSession(pool: ConnectionPool, clientKey: string, input: { postId?: number; password?: string }): Promise<{ token: string; expiresAt: string }> {
  requireEditor(); const parsed = parseSessionInput(input);
  const reservation = await reserveMediaRequest(pool, "session", clientKey);
  try {
    const hash = parsed.postId === undefined ? null : await withRateLimit(pool, "post-password", clientKey,
      () => authorizePostPassword(pool, parsed.postId!, parsed.password!));
    const token = randomBytes(32).toString("hex");
    const expiresAt = await mediaTransaction(pool, async tx => {
      if (parsed.postId !== undefined) {
        const post = await new sql.Request(tx).input("id", sql.BigInt, parsed.postId).input("hash", sql.VarChar(256), hash)
          .query("SELECT id FROM dbo.posts WITH(UPDLOCK,HOLDLOCK) WHERE id=@id AND password_hash=@hash");
        if (!post.recordset[0]) throw new BoardError("NOT_FOUND", 404, "글을 찾을 수 없습니다.");
      }
      const result = await new sql.Request(tx).input("id", sql.UniqueIdentifier, randomUUID())
        .input("token", sql.Char(64), tokenHash(token)).input("key", sql.Char(64), clientKey)
        .input("post", sql.BigInt, parsed.postId ?? null).input("hash", sql.VarChar(256), hash).query<{ expires_at: Date }>(`
          INSERT dbo.upload_sessions(id,token_hash,client_key,target_post_id,author_hash,expires_at)
          OUTPUT inserted.expires_at VALUES(@id,@token,@key,@post,@hash,DATEADD(second,900,SYSUTCDATETIME()));
        `);
      return result.recordset[0].expires_at.toISOString();
    });
    return { token, expiresAt };
  } finally { await finishMediaRequest(pool, reservation, 0); }
}
export async function readUploadSession(pool: ConnectionPool, token: string, clientKey: string, now?: Date): Promise<UploadSession> {
  const result = await pool.request().input("hash", sql.Char(64), tokenHash(token)).input("key", sql.Char(64), clientKey)
    .input("now", sql.DateTime2(3), now ?? null).query(`
      SELECT id,expires_at,target_post_id,author_hash,state FROM dbo.upload_sessions
      WHERE token_hash=@hash AND client_key=@key AND expires_at>COALESCE(@now,SYSUTCDATETIME());
    `);
  const row = result.recordset[0];
  if (!row || !["active", "consumed"].includes(row.state)) throw new BoardError("UNAUTHENTICATED", 401, "업로드 세션이 만료되었거나 유효하지 않습니다.");
  if (row.state === "consumed") throw conflict();
  if (row.target_post_id !== null) {
    const post = await pool.request().input("id", sql.BigInt, row.target_post_id).query("SELECT id FROM dbo.posts WHERE id=@id");
    if (!post.recordset[0]) throw new BoardError("NOT_FOUND", 404, "글을 찾을 수 없습니다.");
  }
  return { id: row.id.toLowerCase(), expiresAt: row.expires_at, targetPostId: row.target_post_id === null ? null : Number(row.target_post_id), authorHash: row.author_hash };
}
export async function cancelUploadSession(pool: ConnectionPool, token: string, clientKey: string): Promise<void> {
  const hash = tokenHash(token);
  await mediaTransaction(pool, async tx => {
    const result = await new sql.Request(tx).input("hash", sql.Char(64), hash).input("key", sql.Char(64), clientKey)
      .query("SELECT id,state FROM dbo.upload_sessions WITH(UPDLOCK,HOLDLOCK) WHERE token_hash=@hash AND client_key=@key AND expires_at>SYSUTCDATETIME()");
    const row = result.recordset[0];
    if (!row || !["active", "cancelled"].includes(row.state)) throw new BoardError("UNAUTHENTICATED", 401, "업로드 세션을 확인해 주세요.");
    if (row.state === "cancelled") return;
    await new sql.Request(tx).input("id", sql.UniqueIdentifier, row.id).query("UPDATE dbo.upload_sessions SET state='cancelled' WHERE id=@id");
    const assets = await new sql.Request(tx).input("id", sql.UniqueIdentifier, row.id).query("SELECT id FROM dbo.image_assets WITH(UPDLOCK,HOLDLOCK) WHERE session_id=@id AND state IN('uploading','ready') ORDER BY id");
    for (const asset of assets.recordset) await queueDeletion(tx, asset.id);
  });
}
