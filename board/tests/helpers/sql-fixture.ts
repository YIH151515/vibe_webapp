import { randomUUID } from "node:crypto";
import sql, { type ConnectionPool } from "mssql";
import { createTestActor, createTestSession } from "./auth-fixture";
import { getAccountKey, type Principal } from "../../src/lib/server/auth-principal";
import type { Post, PostInput } from "../../src/lib/posts/types";
import { assertTestDatabase, getDatabase, openDatabase, readSqlConfig } from "../../src/lib/server/database";
import { migrateDatabase } from "../../src/lib/server/migrations";
import { createPostService } from "../../src/lib/server/posts";
import { hashPassword } from "../../src/lib/server/password";

export { assertTestDatabase };

export async function emptySqlFixture() {
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

export async function seedPosts(inputs: PostInput[], principal: Principal): Promise<Post[]> {
  assertTestDatabase(process.env);
  const service = createPostService(await getDatabase());
  const posts: Post[] = [];
  for (const input of inputs) posts.push(await service.create(input, { principal, clientKey: getAccountKey(principal) }));
  return posts;
}

export async function seedLegacyPosts(pool: ConnectionPool, inputs: { title: string; content: string; nickname: string }[]): Promise<number[]> {
  assertTestDatabase(process.env);
  const ids: number[] = [], hash = await hashPassword("isolated-legacy-password");
  for (const input of inputs) {
    const row = (await pool.request().input("title", sql.NVarChar(100), input.title)
      .input("content", sql.NVarChar(sql.MAX), input.content).input("nickname", sql.NVarChar(20), input.nickname)
      .input("hash", sql.VarChar(256), hash).query<{ id: string }>(
        "INSERT dbo.posts(title,content,nickname,password_hash) OUTPUT inserted.id VALUES(@title,@content,@nickname,@hash)"
      )).recordset[0];
    ids.push(Number(row.id));
  }
  return ids;
}

export async function sqlFixture() {
  const fixture = await emptySqlFixture();
  try { const { principal } = await createTestSession(fixture.pool, createTestActor()); return { ...fixture, principal, context: { principal, clientKey: getAccountKey(principal) } }; }
  catch (error) { await fixture.close(); throw error; }
}
