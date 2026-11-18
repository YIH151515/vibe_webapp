import { randomUUID } from "node:crypto";
import sql, { type ConnectionPool } from "mssql";
import { BoardError, RateLimitError } from "./errors";

export type RateAction = "post-create" | "post-password" | "admin-login" | "oidc-login";
export type RateReservation = {
  action: RateAction; clientKey: string; generation: string; finished: boolean;
};

const policies = {
  "post-create": { limit: 5, seconds: 600 },
  "post-password": { limit: 10, seconds: 600 },
  "admin-login": { limit: 5, seconds: 900 },
  "oidc-login": { limit: 10, seconds: 600 },
} as const;
type Bucket = { generation: string; used_count: number; pending_count: number; expires_at: Date };

function unavailable(): BoardError {
  return new BoardError("SERVICE_UNAVAILABLE", 503, "요청 횟수를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

export async function reserve(
  pool: ConnectionPool, action: RateAction, clientKey: string, now?: Date,
): Promise<RateReservation> {
  if (!Object.hasOwn(policies, action) || !/^[a-f0-9]{64}$/.test(clientKey) || clientKey.length !== 64 ||
    (now !== undefined && !Number.isFinite(now.getTime()))) throw unavailable();
  const policy = policies[action];
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const selected = await new sql.Request(transaction)
      .input("action", sql.VarChar(20), action).input("key", sql.Char(64), clientKey)
      .input("now", sql.DateTime2(3), now ?? null).output("clock", sql.DateTime2(3))
      .query<Bucket>(`
        SET @clock = COALESCE(@now, SYSUTCDATETIME());
        SELECT generation, used_count, pending_count, expires_at
        FROM dbo.rate_buckets WITH (UPDLOCK, HOLDLOCK)
        WHERE action = @action AND client_key = @key;
      `);
    const clock = selected.output.clock as Date;
    const bucket = selected.recordset[0];
    const reset = !bucket || bucket.expires_at.getTime() <= clock.getTime();
    let generation: string;
    if (reset) {
      generation = randomUUID();
      const request = new sql.Request(transaction)
        .input("action", sql.VarChar(20), action).input("key", sql.Char(64), clientKey)
        .input("generation", sql.UniqueIdentifier, generation)
        .input("clock", sql.DateTime2(3), clock)
        .input("seconds", sql.Int, policy.seconds);
      await request.query(bucket ? `
        UPDATE dbo.rate_buckets SET generation = @generation, used_count = 0, pending_count = 1,
          window_started_at = @clock, expires_at = DATEADD(second, @seconds, @clock)
        WHERE action = @action AND client_key = @key
      ` : `
        INSERT dbo.rate_buckets(action, client_key, generation, used_count, pending_count, window_started_at, expires_at)
        VALUES (@action, @key, @generation, 0, 1, @clock, DATEADD(second, @seconds, @clock))
      `);
    } else {
      if (bucket.used_count + bucket.pending_count >= policy.limit) {
        throw new RateLimitError((bucket.expires_at.getTime() - clock.getTime()) / 1000);
      }
      generation = bucket.generation;
      await new sql.Request(transaction)
        .input("action", sql.VarChar(20), action).input("key", sql.Char(64), clientKey)
        .query("UPDATE dbo.rate_buckets SET pending_count = pending_count + 1 WHERE action = @action AND client_key = @key");
    }
    await transaction.commit();
    return { action, clientKey, generation, finished: false };
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    if (error instanceof RateLimitError) throw error;
    throw unavailable();
  }
}

const cleanupAfter = new WeakMap<ConnectionPool, number>();

async function cleanupExpired(pool: ConnectionPool): Promise<void> {
  const now = Date.now();
  if (now < (cleanupAfter.get(pool) ?? 0)) return;
  cleanupAfter.set(pool, now + 3600000);
  try {
    await pool.request().query(`
      DELETE TOP (1000) FROM dbo.rate_buckets
      WHERE expires_at < DATEADD(day, -1, SYSUTCDATETIME())
    `);
  } catch { console.error("RATE_CLEANUP_FAILED"); }
}

export async function finish(
  pool: ConnectionPool, reservation: RateReservation, count: boolean,
): Promise<void> {
  if (reservation.finished) return;
  reservation.finished = true;
  try {
    await pool.request().input("action", sql.VarChar(20), reservation.action)
      .input("key", sql.Char(64), reservation.clientKey)
      .input("generation", sql.UniqueIdentifier, reservation.generation)
      .input("count", sql.Int, count ? 1 : 0)
      .query(`
        UPDATE dbo.rate_buckets SET pending_count = pending_count - 1, used_count = used_count + @count
        WHERE action = @action AND client_key = @key AND generation = @generation AND pending_count > 0
      `);
  } catch { throw unavailable(); }
  await cleanupExpired(pool);
}

export async function withRateLimit<T>(
  pool: ConnectionPool, action: RateAction, key: string, work: () => Promise<T>,
): Promise<T> {
  const reservation = await reserve(pool, action, key);
  let value: T;
  try { value = await work(); }
  catch (error) {
    const count = error instanceof BoardError &&
      ((action === "post-password" && error.code === "INVALID_PASSWORD") ||
        (action === "admin-login" && error.code === "UNAUTHENTICATED"));
    await finish(pool, reservation, count);
    throw error;
  }
  await finish(pool, reservation, action === "post-create" || action === "oidc-login");
  return value;
}
