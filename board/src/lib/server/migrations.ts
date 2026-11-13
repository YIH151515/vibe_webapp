import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import sql, { type ConnectionPool } from "mssql";

export async function migrateDatabase(pool: ConnectionPool): Promise<void> {
  const directory = join(process.cwd(), "sql");
  const migrations = (await readdir(directory))
    .filter(name => /^\d{3}-[a-z0-9-]+\.sql$/.test(name)).sort();
  if (!migrations.length ||
    migrations.some((name, index) => Number(name.slice(0, 3)) !== index + 1)) {
    throw new Error("데이터베이스 migration 파일을 확인해 주세요.");
  }
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    await new sql.Request(transaction).batch(`
      SET XACT_ABORT ON;
      DECLARE @lockResult INT;
      EXEC @lockResult = sys.sp_getapplock
        @Resource = N'free-board-schema',
        @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 5000;
      IF @lockResult < 0 THROW 51000, 'Schema migration lock unavailable', 1;
      IF OBJECT_ID(N'dbo.schema_migrations', N'U') IS NULL
        CREATE TABLE dbo.schema_migrations (
          version INT NOT NULL CONSTRAINT PK_schema_migrations PRIMARY KEY,
          applied_at DATETIME2(3) NOT NULL
            CONSTRAINT DF_schema_migrations_applied_at DEFAULT SYSUTCDATETIME()
        );
    `);
    const applied = (await new sql.Request(transaction)
      .query<{ version: number }>("SELECT version FROM dbo.schema_migrations ORDER BY version")).recordset;
    if (applied.length > migrations.length ||
      applied.some((row, index) => row.version !== index + 1)) {
      throw new Error("지원하지 않는 데이터베이스 스키마 버전입니다.");
    }
    for (let index = applied.length; index < migrations.length; index++) {
      await new sql.Request(transaction).batch(await readFile(join(directory, migrations[index]), "utf8"));
      await new sql.Request(transaction).input("version", sql.Int, index + 1)
        .query("INSERT INTO dbo.schema_migrations (version) VALUES (@version)");
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}
