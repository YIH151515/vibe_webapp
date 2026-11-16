import { randomUUID } from "node:crypto";
import sql, { type ConnectionPool } from "mssql";
import type { BlobStore } from "./blob-store";
import { mediaTransaction, queueDeletion, safeBytes, UUID } from "./media-transactions";
import { mediaUnavailable } from "./media-limits";
import { finishMediaRequest, type MediaReservation } from "./media-rate-limit";

export type CleanupResult = { claimed: number; deleted: number; retained: number; releasedBytes: number; failed: number };
type Options = { now?: Date; limit?: number; owner?: string; signal?: AbortSignal; assetIds?: string[] };
type Asset = { id: string; blob_name: string; charge_bytes: string | number; state: string; blob_write_started: boolean; purge_after: Date | null; session_id: string; input_bytes: number };

export async function runMediaCleanup(pool: ConnectionPool, store: BlobStore, options: Options = {}): Promise<CleanupResult> {
  const result: CleanupResult = { claimed: 0, deleted: 0, retained: 0, releasedBytes: 0, failed: 0 };
  const limit = options.limit ?? 100, owner = options.owner ?? randomUUID(), started = Date.now();
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !UUID.test(owner) ||
    (options.now && !Number.isFinite(options.now.getTime())) || options.assetIds?.some(id => !UUID.test(id))) throw mediaUnavailable();
  const serverNow = options.now ?? (await pool.request().query<{ clock: Date }>("SELECT SYSUTCDATETIME() clock")).recordset[0].clock;
  const clock = () => options.now ?? new Date(serverNow.getTime() + Date.now() - started);
  const req = (tx: sql.Transaction) => new sql.Request(tx).input("owner", sql.UniqueIdentifier, owner).input("now", sql.DateTime2(3), clock())
    .input("filter", sql.NVarChar(sql.MAX), options.assetIds ? JSON.stringify(options.assetIds) : null);
  const acquired = await mediaTransaction(pool, async tx => {
    const lease = await req(tx).query(`UPDATE dbo.media_maintenance WITH(UPDLOCK,HOLDLOCK)
      SET owner=@owner,lease_until=DATEADD(minute,5,@now) OUTPUT inserted.name
      WHERE name='image-cleanup' AND (owner IS NULL OR lease_until<=@now);`);
    return !!lease.recordset[0];
  });
  if (!acquired) return result;
  const stillOwned = async (tx: sql.Transaction) => !!(await req(tx).query(`SELECT name FROM dbo.media_maintenance WITH(UPDLOCK,HOLDLOCK)
    WHERE name='image-cleanup' AND owner=@owner AND lease_until>@now`)).recordset[0];
  const filter = options.assetIds ? new Set(options.assetIds) : undefined;
  const eligible = (id: string) => !filter || filter.has(id.toLowerCase());
  const exhausted = () => Date.now() - started >= 240000 || options.signal?.aborted;
  async function io<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([work, new Promise<never>((_, reject) => {
        abort = () => reject(mediaUnavailable());
        timer = setTimeout(abort, Math.max(1, 240000 - (Date.now() - started))); timer.unref();
        if (options.signal?.aborted) abort(); else options.signal?.addEventListener("abort", abort, { once: true });
      })]);
    } finally { if (timer) clearTimeout(timer); if (abort) options.signal?.removeEventListener("abort", abort); }
  }
  async function releaseAsset(tx: sql.Transaction, asset: Asset): Promise<number> {
    const bytes = safeBytes(asset.charge_bytes);
    await new sql.Request(tx).input("id", sql.UniqueIdentifier, asset.id).input("bytes", sql.BigInt, bytes).input("now", sql.DateTime2(3), clock()).query(`
      UPDATE dbo.image_assets SET state='purged',post_id=NULL,charge_bytes=0,deleted_at=COALESCE(deleted_at,@now),purge_after=@now WHERE id=@id;
      UPDATE dbo.media_capacity SET occupied_bytes=occupied_bytes-@bytes WHERE id=1;
      DELETE dbo.image_delete_jobs WHERE asset_id=@id;
    `);
    return bytes;
  }
  try {
    await mediaTransaction(pool, async tx => {
      if (!await stillOwned(tx) || exhausted()) return;
      // Trusted own-QA filters never expire or sweep unrelated sessions/assets.
      if (!filter) await req(tx).query(`UPDATE TOP(100) dbo.upload_sessions SET state='expired' WHERE state='active' AND expires_at<=@now;`);
      const stale = (await req(tx).query<Asset>(`SELECT TOP(100) * FROM dbo.image_assets WITH(UPDLOCK,HOLDLOCK)
        WHERE state IN('uploading','ready') AND created_at<=DATEADD(hour,-24,@now) AND lease_until<=@now
        AND (@filter IS NULL OR CONVERT(VARCHAR(36),id) IN(SELECT value FROM OPENJSON(@filter))) ORDER BY session_id,id`)).recordset;
      for (const asset of stale) if (eligible(asset.id)) await queueDeletion(tx, asset.id);
    });
    while (result.claimed < limit && !exhausted()) {
      const claimed = await mediaTransaction(pool, async tx => {
        if (!await stillOwned(tx)) return null;
        const candidates = (await req(tx).query<Asset>(`SELECT TOP(100) a.* FROM dbo.image_delete_jobs j WITH(UPDLOCK,HOLDLOCK)
          JOIN dbo.image_assets a WITH(UPDLOCK,HOLDLOCK) ON a.id=j.asset_id
          WHERE a.state='deleting' AND j.available_at<=@now AND (j.lease_until IS NULL OR j.lease_until<=@now)
          AND (@filter IS NULL OR CONVERT(VARCHAR(36),a.id) IN(SELECT value FROM OPENJSON(@filter)))
          ORDER BY j.available_at,a.id;`)).recordset;
        const asset = candidates.find(entry => eligible(entry.id));
        if (!asset) return null;
        await req(tx).input("id", sql.UniqueIdentifier, asset.id).query(`UPDATE dbo.image_delete_jobs SET lease_owner=@owner,lease_until=DATEADD(minute,2,@now) WHERE asset_id=@id;`);
        return asset;
      });
      if (!claimed) break;
      result.claimed++;
      let blobDone = false;
      try {
        if (claimed.blob_write_started) await io(store.remove(claimed.blob_name));
        blobDone = true;
        const finalized = await mediaTransaction(pool, async tx => {
          if (!await stillOwned(tx)) return null;
          const job = (await req(tx).input("id", sql.UniqueIdentifier, claimed.id).query(`SELECT asset_id FROM dbo.image_delete_jobs WITH(UPDLOCK,HOLDLOCK)
            WHERE asset_id=@id AND lease_owner=@owner AND lease_until>@now`)).recordset[0];
          if (!job) return null;
          const asset = (await req(tx).input("id", sql.UniqueIdentifier, claimed.id).query<Asset>("SELECT * FROM dbo.image_assets WITH(UPDLOCK,HOLDLOCK) WHERE id=@id AND state='deleting' AND post_id IS NULL")).recordset[0];
          if (!asset) return null;
          let released = 0;
          if (!asset.blob_write_started) released = await releaseAsset(tx, asset);
          else {
            await req(tx).input("id", sql.UniqueIdentifier, asset.id).query(`
              UPDATE dbo.image_assets SET state='soft_deleted',deleted_at=@now,purge_after=DATEADD(day,7,@now),lease_until=DATEADD(day,1,@now) WHERE id=@id;
              DELETE dbo.image_delete_jobs WHERE asset_id=@id AND lease_owner=@owner;
            `);
          }
          return { released, retained: !!asset.blob_write_started };
        });
        if (finalized) { result.deleted++; result.releasedBytes += finalized.released; if (finalized.retained) result.retained++; }
        else result.failed++;
      } catch {
        result.failed++;
        await mediaTransaction(pool, async tx => {
          await req(tx).input("id", sql.UniqueIdentifier, claimed.id).input("code", sql.VarChar(40), blobDone ? "DB_UNAVAILABLE" : "BLOB_UNAVAILABLE").query(`
            UPDATE dbo.image_delete_jobs SET attempts=attempts+1,available_at=DATEADD(second,
              CASE WHEN attempts>=5 THEN 3600 ELSE 60*POWER(2,attempts+1) END,@now),
              lease_owner=NULL,lease_until=NULL,last_error_code=@code
            WHERE asset_id=@id AND lease_owner=@owner;
          `);
        }).catch(() => { /* A persisted leased job is retried after expiry. */ });
      }
    }
    const remaining = limit - result.claimed;
    if (remaining > 0 && !exhausted()) {
      const retained = await mediaTransaction(pool, async tx => {
        if (!await stillOwned(tx)) return [];
        const candidates = (await req(tx).query<Asset>(`SELECT TOP(100) * FROM dbo.image_assets WITH(UPDLOCK,HOLDLOCK)
          WHERE state='soft_deleted' AND lease_until<=@now
          AND (@filter IS NULL OR CONVERT(VARCHAR(36),id) IN(SELECT value FROM OPENJSON(@filter))) ORDER BY lease_until,id`)).recordset;
        const selected = candidates.filter(asset => eligible(asset.id)).slice(0, remaining);
        for (const asset of selected) await req(tx).input("id", sql.UniqueIdentifier, asset.id)
          .query(`UPDATE dbo.image_assets SET lease_until=CASE WHEN purge_after>@now AND purge_after<DATEADD(day,1,@now)
            THEN purge_after ELSE DATEADD(day,1,@now) END WHERE id=@id AND state='soft_deleted'`);
        return selected;
      });
      for (const asset of retained) {
        if (exhausted()) break;
        result.claimed++;
        try {
          const present = await io(store.head(asset.blob_name));
          const released = await mediaTransaction(pool, async tx => {
            if (!await stillOwned(tx)) return null;
            const current = (await req(tx).input("id", sql.UniqueIdentifier, asset.id)
              .query<Asset>("SELECT * FROM dbo.image_assets WITH(UPDLOCK,HOLDLOCK) WHERE id=@id AND state='soft_deleted' AND post_id IS NULL")).recordset[0];
            if (!current) return null;
            if (present) {
              // Persist a deletion job BEFORE another remove. If its SQL finalize
              // fails after Blob deletion, capacity stays held until that job can
              // confirm a fresh seven-day retention window. Never release early.
              await req(tx).input("id", sql.UniqueIdentifier, asset.id).query(`
                UPDATE dbo.image_assets SET state='deleting' WHERE id=@id;
                IF NOT EXISTS(SELECT 1 FROM dbo.image_delete_jobs WHERE asset_id=@id) INSERT dbo.image_delete_jobs(asset_id,available_at) VALUES(@id,@now);
              `);
              return 0;
            } else if (current.purge_after && current.purge_after <= clock()) return releaseAsset(tx, current);
            return 0;
          });
          if (released !== null) { result.releasedBytes += released; if (released === 0) result.retained++; }
        } catch { result.failed++; }
      }
    }
    if (!filter && !exhausted()) {
      const expired = (await pool.request().input("now", sql.DateTime2(3), clock()).query(`SELECT TOP(100) * FROM dbo.media_reservations
        WHERE state='pending' AND expires_at<=@now ORDER BY expires_at,id`)).recordset;
      for (const row of expired) {
        if (exhausted()) break;
        const reservation: MediaReservation = { id: row.id, kind: row.kind, clientKey: row.client_key, generation: row.generation, bytesReserved: safeBytes(row.bytes_reserved) };
        await finishMediaRequest(pool, reservation, reservation.bytesReserved);
      }
      await mediaTransaction(pool, async tx => {
      if (!await stillOwned(tx)) return;
      await req(tx).query(`
        DELETE TOP(100) dbo.media_reservations WHERE expires_at<DATEADD(day,-1,@now) AND state='finished';
        DELETE TOP(100) dbo.image_assets WHERE state='purged' AND purge_after<DATEADD(day,-30,@now)
          AND NOT EXISTS(SELECT 1 FROM dbo.image_delete_jobs j WHERE j.asset_id=image_assets.id);
        DELETE TOP(100) dbo.upload_sessions WHERE state<>'active' AND expires_at<DATEADD(day,-30,@now)
          AND NOT EXISTS(SELECT 1 FROM dbo.image_assets a WHERE a.session_id=upload_sessions.id);
        DELETE TOP(100) dbo.media_buckets WHERE expires_at<DATEADD(day,-1,@now)
          AND NOT EXISTS(SELECT 1 FROM dbo.media_reservations r WHERE r.kind=media_buckets.kind AND r.client_key=media_buckets.client_key);
      `);
      });
    }
    return result;
  } finally {
    await pool.request().input("owner", sql.UniqueIdentifier, owner)
      .query("UPDATE dbo.media_maintenance SET owner=NULL,lease_until=NULL WHERE name='image-cleanup' AND owner=@owner").catch(() => undefined);
  }
}

const globalState = globalThis as typeof globalThis & { boardMediaCleanupStop?: () => void };
export function startMediaCleanup(dependencies: { getPool: () => Promise<ConnectionPool>; getStore: () => BlobStore }): () => void {
  if (globalState.boardMediaCleanupStop) return globalState.boardMediaCleanupStop;
  let running = false, stopped = false;
  const controller = new AbortController();
  async function tick() {
    if (running || stopped) return; running = true;
    try { await runMediaCleanup(await dependencies.getPool(), dependencies.getStore(), { signal: controller.signal }); }
    catch { console.error("MEDIA_CLEANUP_FAILED"); }
    finally { running = false; }
  }
  const timer = setInterval(() => { void tick(); }, 600000); timer.unref();
  const first = setTimeout(() => { void tick(); }, 0); first.unref();
  const stop = () => {
    stopped = true; clearTimeout(first); clearInterval(timer); controller.abort();
    delete globalState.boardMediaCleanupStop;
    process.off("SIGTERM", stop); process.off("SIGINT", stop);
  };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  globalState.boardMediaCleanupStop = stop;
  return stop;
}
