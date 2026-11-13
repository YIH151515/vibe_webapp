import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(path: string): DatabaseSync {
  const resolvedPath = path === ":memory:" ? path : resolve(path);
  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    const version = db.prepare("PRAGMA user_version").get()!.user_version;
    if (version !== 0 && version !== 1) {
      throw new Error("지원하지 않는 데이터베이스 스키마 버전입니다.");
    }
    if (version === 0) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(`
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            nickname TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE INDEX posts_created_at_id ON posts(created_at DESC, id DESC);
          PRAGMA user_version = 1;
        `);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

const databaseGlobal = globalThis as typeof globalThis & {
  boardDatabase?: DatabaseSync;
};

export function getDatabase(): DatabaseSync {
  databaseGlobal.boardDatabase ??= openDatabase(
    process.env.DATABASE_PATH ?? "./data/board.sqlite",
  );
  return databaseGlobal.boardDatabase;
}
