import { createHash, randomBytes } from "node:crypto";
import sql, { type ConnectionPool } from "mssql";
import { authUnavailable, canonicalGuid, readAuthConfig, type EntraConfig } from "./auth-config";
import { forbidden, unauthorized, validDisplayName, type Principal, type VerifiedIdentity } from "./auth-principal";
import { BoardError } from "./errors";
import { mediaTransaction, queueDeletion } from "./media-transactions";

type SessionRow = { id_hash: string; tenant_id: string; object_id: string; display_name: string; is_admin: boolean; expires_at: Date };
const hashPattern = /^[a-f0-9]{64}$/;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) { if (error instanceof BoardError) throw error; throw authUnavailable(); }
}
function clockInput(request: sql.Request, now?: Date): sql.Request {
  if (now && !Number.isFinite(now.getTime())) throw authUnavailable();
  return request.input("now", sql.DateTime2(3), now ?? null);
}
function scope(request: sql.Request, config: EntraConfig): sql.Request {
  return request.input("origin", sql.NVarChar(256), config.origin).input("client", sql.UniqueIdentifier, config.clientId)
    .input("tenant", sql.UniqueIdentifier, config.tenantId);
}
function identityScope(request: sql.Request, principal: Principal, config: EntraConfig): sql.Request {
  if (principal.sessionHash.length !== 64 || !hashPattern.test(principal.sessionHash) || canonicalGuid(principal.tenantId) !== config.tenantId) throw unauthorized();
  return scope(request, config).input("hash", sql.Char(64), principal.sessionHash)
    .input("object", sql.UniqueIdentifier, canonicalGuid(principal.objectId));
}
function currentConfig(): EntraConfig {
  const config = readAuthConfig();
  if (config.mode !== "entra") throw authUnavailable();
  return config;
}
function principal(row: SessionRow): Principal {
  return { tenantId: canonicalGuid(row.tenant_id), objectId: canonicalGuid(row.object_id), displayName: row.display_name,
    isAdmin: row.is_admin, sessionHash: row.id_hash, expiresAt: row.expires_at };
}

/** Accept only the server's verified OIDC identity, never an HTTP request body. */
export async function createAppSession(pool: ConnectionPool, identity: VerifiedIdentity, config: EntraConfig, now?: Date): Promise<{ cookieValue: string; principal: Principal }> {
  return guarded(async () => {
    const tenant = canonicalGuid(identity.tenantId), object = canonicalGuid(identity.objectId), name = validDisplayName(identity.displayName);
    if (tenant !== config.tenantId || typeof identity.isAdmin !== "boolean") throw forbidden();
    if (!(identity.tokenExpiresAt instanceof Date) || !Number.isFinite(identity.tokenExpiresAt.getTime())) throw unauthorized();
    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const clock = (await clockInput(new sql.Request(tx), now).query<{ clock: Date }>("SELECT COALESCE(@now,SYSUTCDATETIME()) clock")).recordset[0].clock;
      const expires = new Date(Math.min(clock.getTime() + 3600000, identity.tokenExpiresAt.getTime()));
      if (expires <= clock) throw unauthorized();
      const cookieValue = randomBytes(32).toString("hex");
      const row = (await scope(new sql.Request(tx), config).input("object", sql.UniqueIdentifier, object)
        .input("name", sql.NVarChar(256), name).input("admin", sql.Bit, identity.isAdmin)
        .input("hash", sql.Char(64), digest(cookieValue)).input("created", sql.DateTime2(3), clock).input("expires", sql.DateTime2(3), expires)
        .query<SessionRow>(`
          IF EXISTS(SELECT 1 FROM dbo.board_users WITH(UPDLOCK,HOLDLOCK) WHERE tenant_id=@tenant AND object_id=@object)
            UPDATE dbo.board_users SET display_name=@name,updated_at=@created WHERE tenant_id=@tenant AND object_id=@object;
          ELSE INSERT dbo.board_users(tenant_id,object_id,display_name,created_at,updated_at) VALUES(@tenant,@object,@name,@created,@created);
          INSERT dbo.auth_sessions(id_hash,tenant_id,object_id,display_name,is_admin,app_origin,client_id,created_at,expires_at)
            OUTPUT inserted.id_hash,inserted.tenant_id,inserted.object_id,inserted.display_name,inserted.is_admin,inserted.expires_at
            VALUES(@hash,@tenant,@object,@name,@admin,@origin,@client,@created,@expires);
        `)).recordset[0];
      await tx.commit(); return { cookieValue, principal: principal(row) };
    } catch (error) { await tx.rollback().catch(() => undefined); throw error; }
  });
}

export async function readAppSession(pool: ConnectionPool, cookieValue: string | undefined, config: EntraConfig, now?: Date): Promise<Principal | null> {
  if (!cookieValue || cookieValue.length !== 64 || !hashPattern.test(cookieValue)) return null;
  return guarded(async () => {
    const row = (await clockInput(scope(pool.request(), config), now).input("hash", sql.Char(64), digest(cookieValue)).query<SessionRow>(`
      SELECT id_hash,tenant_id,object_id,display_name,is_admin,expires_at FROM dbo.auth_sessions
      WHERE id_hash=@hash AND tenant_id=@tenant AND app_origin COLLATE Latin1_General_100_BIN2=@origin
        AND client_id=@client AND revoked_at IS NULL AND expires_at>COALESCE(@now,SYSUTCDATETIME())
    `)).recordset[0];
    return row ? principal(row) : null;
  });
}

/** Caller must already hold the capacity lock (mediaTransaction), before upload/post/asset locks. */
export async function assertSessionInTransaction(tx: sql.Transaction, value: Principal, requireAdmin = false): Promise<void> {
  await guarded(async () => {
    const row = (await identityScope(new sql.Request(tx), value, currentConfig()).query<{ is_admin: boolean }>(`
      SELECT is_admin FROM dbo.auth_sessions WITH(UPDLOCK,HOLDLOCK)
      WHERE id_hash=@hash AND tenant_id=@tenant AND object_id=@object
        AND app_origin COLLATE Latin1_General_100_BIN2=@origin AND client_id=@client
        AND revoked_at IS NULL AND expires_at>SYSUTCDATETIME()
    `)).recordset[0];
    if (!row) throw unauthorized();
    if (requireAdmin && !row.is_admin) throw forbidden();
  });
}

export async function revokeAppSession(pool: ConnectionPool, value: Principal): Promise<void> {
  await guarded(async () => {
    const config = currentConfig();
    await mediaTransaction(pool, async tx => {
      const row = (await identityScope(new sql.Request(tx), value, config).query(`
        SELECT id_hash FROM dbo.auth_sessions WITH(UPDLOCK,HOLDLOCK)
        WHERE id_hash=@hash AND tenant_id=@tenant AND object_id=@object
          AND app_origin COLLATE Latin1_General_100_BIN2=@origin AND client_id=@client
      `)).recordset[0];
      if (!row) return;
      await new sql.Request(tx).input("hash", sql.Char(64), value.sessionHash)
        .query("UPDATE dbo.auth_sessions SET revoked_at=COALESCE(revoked_at,SYSUTCDATETIME()) WHERE id_hash=@hash");
      const sessions = (await new sql.Request(tx).input("hash", sql.Char(64), value.sessionHash)
        .query<{ id: string }>("SELECT id FROM dbo.upload_sessions WITH(UPDLOCK,HOLDLOCK) WHERE auth_session_hash=@hash AND state='active' ORDER BY id")).recordset;
      for (const session of sessions) {
        await new sql.Request(tx).input("id", sql.UniqueIdentifier, session.id).query("UPDATE dbo.upload_sessions SET state='cancelled' WHERE id=@id");
        const assets = (await new sql.Request(tx).input("sid", sql.UniqueIdentifier, session.id)
          .query<{ id: string }>("SELECT id FROM dbo.image_assets WITH(UPDLOCK,HOLDLOCK) WHERE session_id=@sid AND state IN('uploading','ready') ORDER BY id")).recordset;
        for (const asset of assets) await queueDeletion(tx, asset.id);
      }
    });
  });
}

/** Bounded best-effort maintenance; FK-referenced sessions and accounts are retained. */
export async function cleanupAuthState(pool: ConnectionPool, now?: Date): Promise<{ flows: number; sessions: number }> {
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
    const result = (await clockInput(new sql.Request(tx), now).query<{ flows: number; sessions: number }>(`
      DECLARE @clock DATETIME2(3)=COALESCE(@now,SYSUTCDATETIME()),@flows INT;
      DELETE TOP(100) FROM dbo.oidc_login_attempts WHERE expires_at<=@clock;
      SET @flows=@@ROWCOUNT;
      DELETE TOP(100) FROM dbo.auth_sessions WHERE expires_at<=DATEADD(day,-30,@clock)
        AND NOT EXISTS(SELECT 1 FROM dbo.upload_sessions u WHERE u.auth_session_hash=dbo.auth_sessions.id_hash);
      SELECT @flows flows,@@ROWCOUNT sessions;
    `)).recordset[0];
    await tx.commit(); return result;
  } catch {
    await tx.rollback().catch(() => undefined);
    console.error("AUTH_STATE_CLEANUP_FAILED"); return { flows: 0, sessions: 0 };
  }
}
