import { existsSync } from "node:fs";
import { openDatabase, readSqlConfig } from "../src/lib/server/database";
import { migrateDatabase } from "../src/lib/server/migrations";

async function main(): Promise<void> {
  if (process.env.APP_TEST_MODE !== "1" && existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }
  const pool = await openDatabase(readSqlConfig(process.env, "migration"));
  try {
    await migrateDatabase(pool);
    console.log("데이터베이스 migration을 완료했습니다.");
  } finally {
    await pool.close();
  }
}

void main().catch(() => {
  console.error("Migration에 실패했습니다. 설정과 데이터베이스 상태를 확인해 주세요.");
  process.exitCode = 1;
});
