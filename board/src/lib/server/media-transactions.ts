import sql, { type ConnectionPool } from "mssql";
import { BoardError } from "./errors";
import { mediaUnavailable } from "./media-limits";

export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function safeBytes(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw mediaUnavailable();
  return result;
}
export function conflict(): BoardError { return new BoardError("MEDIA_CONFLICT", 409, "이미지 또는 편집 세션이 변경되었습니다. 다시 확인해 주세요.", undefined, 1); }
export async function mediaTransaction<T>(pool: ConnectionPool, work: (tx: sql.Transaction) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    // A single capacity lock serializes media mutations across every process.
    // All callers acquire it before sessions, posts, assets and outbox rows.
    await new sql.Request(tx).query("SELECT id FROM dbo.media_capacity WITH(UPDLOCK,HOLDLOCK) WHERE id=1");
    if (signal?.aborted) throw mediaUnavailable();
    const result = await work(tx);
    if (signal?.aborted) throw mediaUnavailable();
    await tx.commit(); return result;
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    if (error instanceof BoardError) throw error;
    throw mediaUnavailable();
  }
}
export async function queueDeletion(tx: sql.Transaction, id: string): Promise<void> {
  await new sql.Request(tx).input("id", sql.UniqueIdentifier, id).query(`
    UPDATE dbo.image_assets SET state='deleting',post_id=NULL WHERE id=@id AND state IN('uploading','ready','attached');
    IF EXISTS(SELECT 1 FROM dbo.image_assets WHERE id=@id AND state='deleting')
      AND NOT EXISTS(SELECT 1 FROM dbo.image_delete_jobs WHERE asset_id=@id)
      INSERT dbo.image_delete_jobs(asset_id) VALUES(@id);
  `);
}
