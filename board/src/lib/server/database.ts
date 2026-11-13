import sql, { type ConnectionPool, type config as SqlConfig } from "mssql";
import { BoardError } from "./errors";

function configurationError(): never {
  throw new BoardError("SERVICE_UNAVAILABLE", 503, "데이터베이스 설정을 확인해 주세요.");
}

export function assertTestDatabase(env: NodeJS.ProcessEnv): void {
  if (env.APP_TEST_MODE !== "1" ||
    !["127.0.0.1", "localhost", "::1"].includes(env.SQL_SERVER ?? "") ||
    !/^board_test_[a-f0-9]{32}$/.test(env.SQL_DATABASE ?? "")) {
    throw new Error("격리된 로컬 SQL 테스트 환경이 아닙니다.");
  }
}

export function readSqlConfig(
  env: NodeJS.ProcessEnv,
  purpose: "app" | "migration" = "app",
): SqlConfig {
  if (env.APP_TEST_MODE !== undefined && !["0", "1"].includes(env.APP_TEST_MODE)) configurationError();
  const testMode = env.APP_TEST_MODE === "1";
  if (testMode) {
    try { assertTestDatabase(env); } catch { configurationError(); }
  }
  const user = purpose === "migration" ? env.SQL_MIGRATION_USER : env.SQL_USER;
  const password = purpose === "migration" ? env.SQL_MIGRATION_PASSWORD : env.SQL_PASSWORD;
  if (!env.SQL_SERVER?.trim() || !env.SQL_DATABASE?.trim() || !user?.trim() || !password) configurationError();
  const portText = env.SQL_PORT ?? "1433";
  const port = Number(portText);
  if (!/^[1-9][0-9]*$/.test(portText) || portText !== portText.trim() ||
    !Number.isInteger(port) || port > 65535) configurationError();
  return {
    server: env.SQL_SERVER,
    database: env.SQL_DATABASE,
    user, password, port,
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 15000,
    requestTimeout: 15000,
    options: { encrypt: true, trustServerCertificate: testMode, useUTC: true },
  };
}

export function isDatabaseUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code } = error as { code?: unknown };
  return typeof code === "string" &&
    ["ESOCKET", "ETIMEOUT", "ELOGIN", "ENOTOPEN", "ECONNCLOSED", "ECONNRESET", "ENOCONN"].includes(code);
}

export async function openDatabase(config: SqlConfig): Promise<ConnectionPool> {
  const pool = new sql.ConnectionPool(config);
  // Driver errors can contain configuration values. Never log the raw error.
  pool.on("error", () => console.error("데이터베이스 연결 오류가 발생했습니다."));
  try {
    return await pool.connect();
  } catch {
    await pool.close().catch(() => undefined);
    throw new BoardError("SERVICE_UNAVAILABLE", 503, "데이터베이스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

const shared = globalThis as typeof globalThis & { boardSqlPool?: Promise<ConnectionPool> };

export function getDatabase(): Promise<ConnectionPool> {
  if (!shared.boardSqlPool) {
    const pending = Promise.resolve().then(() => openDatabase(readSqlConfig(process.env)));
    shared.boardSqlPool = pending;
    void pending.catch(() => {
      if (shared.boardSqlPool === pending) shared.boardSqlPool = undefined;
    });
  }
  return shared.boardSqlPool;
}

export async function closeDatabase(): Promise<void> {
  const pending = shared.boardSqlPool;
  shared.boardSqlPool = undefined;
  if (pending) {
    const pool = await pending.catch(() => undefined);
    await pool?.close();
  }
}
