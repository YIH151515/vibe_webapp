import { randomUUID } from "node:crypto";
import sql, { type ConnectionPool } from "mssql";
import { RateLimitError } from "./errors";
import { MAX_MULTIPART_BYTES, mediaUnavailable } from "./media-limits";
import { safeBytes } from "./media-transactions";

export type MediaReservation = { id: string; kind: "session" | "file"; clientKey: string; generation: string; bytesReserved: number };
export async function reserveMediaRequest(pool: ConnectionPool, kind: "session" | "file", clientKey: string, now?: Date): Promise<MediaReservation> {
  if (!/^[a-f0-9]{64}$/.test(clientKey) || !["session", "file"].includes(kind) || (now && !Number.isFinite(now.getTime()))) throw mediaUnavailable();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const req = () => new sql.Request(tx).input("kind", sql.VarChar(8), kind).input("key", sql.Char(64), clientKey);
    const selected = await req().input("now", sql.DateTime2(3), now ?? null).output("clock", sql.DateTime2(3)).query(`
      SET @clock=COALESCE(@now,SYSUTCDATETIME());
      SELECT * FROM dbo.media_buckets WITH(UPDLOCK,HOLDLOCK) WHERE kind=@kind AND client_key=@key;
    `);
    const clock = selected.output.clock as Date;
    let row = selected.recordset[0];
    if (!row || row.expires_at <= clock) {
      const generation = randomUUID();
      await req().input("gen", sql.UniqueIdentifier, generation).input("clock", sql.DateTime2(3), clock).query(row ? `
        UPDATE dbo.media_buckets SET generation=@gen,attempts_used=0,attempts_pending=0,bytes_used=0,bytes_pending=0,started_at=@clock,expires_at=DATEADD(second,600,@clock) WHERE kind=@kind AND client_key=@key;
      ` : `INSERT dbo.media_buckets(kind,client_key,generation,started_at,expires_at) VALUES(@kind,@key,@gen,@clock,DATEADD(second,600,@clock));`);
      row = { generation, attempts_used: 0, attempts_pending: 0, bytes_used: 0, bytes_pending: 0, expires_at: new Date(clock.getTime() + 600000) };
    }
    // A dead request spends its full reserved byte budget, once, in its own generation.
    const stale = await req().input("gen", sql.UniqueIdentifier, row.generation).input("clock", sql.DateTime2(3), clock).query(`
      UPDATE dbo.media_reservations WITH(UPDLOCK,HOLDLOCK) SET state='finished',received_bytes=bytes_reserved
      OUTPUT inserted.bytes_reserved WHERE kind=@kind AND client_key=@key AND generation=@gen AND state='pending' AND expires_at<=@clock;
    `);
    const count = stale.recordset.length, bytes = stale.recordset.reduce((sum, entry) => sum + safeBytes(entry.bytes_reserved), 0);
    if (count) {
      await req().input("count", sql.Int, count).input("bytes", sql.BigInt, bytes).query("UPDATE dbo.media_buckets SET attempts_pending=attempts_pending-@count,attempts_used=attempts_used+@count,bytes_pending=bytes_pending-@bytes,bytes_used=bytes_used+@bytes WHERE kind=@kind AND client_key=@key");
      row.attempts_used += count; row.attempts_pending -= count; row.bytes_used = safeBytes(row.bytes_used) + bytes; row.bytes_pending = safeBytes(row.bytes_pending) - bytes;
    }
    const bytesReserved = kind === "file" ? MAX_MULTIPART_BYTES : 0;
    if (row.attempts_used + row.attempts_pending >= (kind === "file" ? 20 : 5) ||
      (kind === "file" && safeBytes(row.bytes_used) + safeBytes(row.bytes_pending) + bytesReserved > 50 * 1024 * 1024)) {
      // Commit stale recovery even when this new attempt is denied.
      await tx.commit(); throw new RateLimitError((row.expires_at.getTime() - clock.getTime()) / 1000);
    }
    const id = randomUUID();
    await req().input("id", sql.UniqueIdentifier, id).input("gen", sql.UniqueIdentifier, row.generation)
      .input("bytes", sql.BigInt, bytesReserved).input("clock", sql.DateTime2(3), clock).query(`
        UPDATE dbo.media_buckets SET attempts_pending=attempts_pending+1,bytes_pending=bytes_pending+@bytes WHERE kind=@kind AND client_key=@key;
        INSERT dbo.media_reservations(id,kind,client_key,generation,bytes_reserved,expires_at,state)
        VALUES(@id,@kind,@key,@gen,@bytes,DATEADD(second,120,@clock),'pending');
      `);
    await tx.commit(); return { id, kind, clientKey, generation: row.generation, bytesReserved };
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    if (error instanceof RateLimitError) throw error;
    throw mediaUnavailable();
  }
}
export async function finishMediaRequest(pool: ConnectionPool, reservation: MediaReservation, receivedBytes: number): Promise<void> {
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const req = () => new sql.Request(tx).input("kind", sql.VarChar(8), reservation.kind).input("key", sql.Char(64), reservation.clientKey)
      .input("gen", sql.UniqueIdentifier, reservation.generation);
    await req().query("SELECT generation FROM dbo.media_buckets WITH(UPDLOCK,HOLDLOCK) WHERE kind=@kind AND client_key=@key");
    const result = await req().input("id", sql.UniqueIdentifier, reservation.id).input("received", sql.BigInt, Math.min(reservation.bytesReserved, Math.max(0, Math.ceil(receivedBytes)))).query(`
      UPDATE dbo.media_reservations WITH(UPDLOCK,HOLDLOCK) SET state='finished',received_bytes=@received
      OUTPUT inserted.bytes_reserved,inserted.received_bytes WHERE id=@id AND kind=@kind AND client_key=@key AND generation=@gen AND state='pending';
    `);
    if (result.recordset[0]) await req().input("reserved", sql.BigInt, safeBytes(result.recordset[0].bytes_reserved))
      .input("received", sql.BigInt, safeBytes(result.recordset[0].received_bytes)).query(`
        UPDATE dbo.media_buckets SET attempts_pending=attempts_pending-1,attempts_used=attempts_used+1,
        bytes_pending=bytes_pending-@reserved,bytes_used=bytes_used+@received WHERE kind=@kind AND client_key=@key AND generation=@gen;
      `);
    await tx.commit();
  } catch { await tx.rollback().catch(() => undefined); throw mediaUnavailable(); }
}
