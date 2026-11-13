import { randomUUID } from "node:crypto";
import type { ConnectionPool } from "mssql";
import type { Post, PostInput } from "../../src/lib/posts/types";
import { assertTestDatabase, getDatabase, openDatabase, readSqlConfig } from "../../src/lib/server/database";
import { migrateDatabase } from "../../src/lib/server/migrations";
import { createPostService } from "../../src/lib/server/posts";

export { assertTestDatabase };

export async function sqlFixture(): Promise<{
  pool: ConnectionPool; service: ReturnType<typeof createPostService>;
  reopen: () => Promise<ConnectionPool>; close: () => Promise<void>;
}> {
  assertTestDatabase(process.env);
  const config = readSqlConfig(process.env);
  const name = "board_test_" + randomUUID().replaceAll("-", "");
  const admin = await openDatabase({ ...config, database: "master" });
  let pool: ConnectionPool | undefined;
  try {
    await admin.request().batch(`CREATE DATABASE [${name}]`);
    pool = await openDatabase({ ...config, database: name });
    await migrateDatabase(pool);
  } catch (error) {
    await pool?.close();
    await admin.close();
    throw error;
  }
  const active = pool;
  return {
    pool: active, service: createPostService(active),
    reopen: () => openDatabase({ ...config, database: name }),
    async close() {
      try {
        await active.close();
        if (!/^board_test_[a-f0-9]{32}$/.test(name)) throw new Error("Invalid test database");
        await admin.request().batch(`ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]`);
      } finally { await admin.close(); }
    },
  };
}

export async function seedPosts(inputs: PostInput[]): Promise<Post[]> {
  assertTestDatabase(process.env);
  const service = createPostService(await getDatabase());
  const posts: Post[] = [];
  for (const input of inputs) posts.push(await service.create(input));
  return posts;
}
