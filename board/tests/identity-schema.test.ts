import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sql from "mssql";
import { assertTestDatabase, openDatabase, readSqlConfig } from "../src/lib/server/database";
import { migrateDatabase } from "../src/lib/server/migrations";
import { sqlFixture } from "./helpers/sql-fixture";

test("schema4 upgrade preserves posts, uploads, assets, rate state and admin sessions", async () => {
  assertTestDatabase(process.env);
  const config = readSqlConfig(process.env), name = "board_test_" + randomUUID().replaceAll("-", "");
  const master = await openDatabase({ ...config, database: "master" }); let pool: sql.ConnectionPool | undefined, created = false;
  try {
    await master.request().batch(`CREATE DATABASE [${name}]`); created = true;
    pool = await openDatabase({ ...config, database: name });
    await pool.request().batch("CREATE TABLE dbo.schema_migrations(version INT PRIMARY KEY,applied_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME())");
    for (const [index, file] of ["001-posts.sql", "002-rate-buckets.sql", "003-admin-sessions.sql", "004-editor-images.sql"].entries()) {
      await pool.request().batch(await readFile(resolve("sql", file), "utf8"));
      await pool.request().input("v", sql.Int, index + 1).query("INSERT dbo.schema_migrations(version) VALUES(@v)");
    }
    const sid = randomUUID(), sid2 = randomUUID(), attached = randomUUID(), ready = randomUUID();
    const document = { version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "서식 😀" }] }, { type: "image", attrs: { assetId: attached, alt: "원본" } }] };
    await pool.request().input("json", sql.NVarChar(sql.MAX), JSON.stringify(document))
      .input("sid", sql.UniqueIdentifier, sid).input("sid2", sql.UniqueIdentifier, sid2)
      .input("attached", sql.UniqueIdentifier, attached).input("ready", sql.UniqueIdentifier, ready).query(`
        INSERT dbo.posts(title,content,nickname,password_hash,created_at) VALUES(N'원본',N'<script>문자열</script> 한글😀',N'작성자','legacy-hash','2026-11-13T01:02:03.456');
        INSERT dbo.posts(title,content,nickname,password_hash,created_at,content_format,content_json) VALUES(N'서식',N'서식 😀',N'작성자','rich-hash','2026-11-13T02:03:04.567','rich_v1',@json);
        DECLARE @post BIGINT=SCOPE_IDENTITY();
        INSERT dbo.upload_sessions(id,token_hash,client_key,target_post_id,author_hash,state,file_count,input_bytes,expires_at)
          VALUES(@sid,REPLICATE('a',64),REPLICATE('b',64),@post,'rich-hash','consumed',1,100,DATEADD(minute,15,SYSUTCDATETIME())),
                (@sid2,REPLICATE('c',64),REPLICATE('b',64),NULL,NULL,'active',1,100,DATEADD(minute,15,SYSUTCDATETIME()));
        INSERT dbo.image_assets(id,session_id,post_id,idempotency_key,state,blob_name,input_bytes,stored_bytes,charge_bytes,width,height,lease_until)
          VALUES(@attached,@sid,@post,NEWID(),'attached',CONCAT('images/',REPLACE(CONVERT(varchar(36),@attached),'-',''),'.webp'),100,64,64,1,1,SYSUTCDATETIME()),
                (@ready,@sid2,NULL,NEWID(),'ready',CONCAT('images/',REPLACE(CONVERT(varchar(36),@ready),'-',''),'.webp'),100,64,64,1,1,SYSUTCDATETIME());
        UPDATE dbo.media_capacity SET occupied_bytes=128 WHERE id=1;
        INSERT dbo.rate_buckets(action,client_key,generation,used_count,pending_count,window_started_at,expires_at)
          VALUES('post-create',REPLICATE('d',64),NEWID(),2,1,SYSUTCDATETIME(),DATEADD(minute,10,SYSUTCDATETIME()));
        INSERT dbo.admin_sessions(id_hash,expires_at) VALUES(REPLICATE('e',64),DATEADD(hour,1,SYSUTCDATETIME()));
      `);
    const projections = [
      "SELECT id,title,content,nickname,password_hash,created_at,content_format,content_json FROM dbo.posts ORDER BY id",
      "SELECT id,token_hash,client_key,target_post_id,author_hash,state,file_count,input_bytes,created_at,expires_at FROM dbo.upload_sessions ORDER BY id",
      "SELECT * FROM dbo.image_assets ORDER BY id", "SELECT * FROM dbo.media_capacity", "SELECT * FROM dbo.rate_buckets", "SELECT * FROM dbo.admin_sessions",
    ];
    const before = []; for (const query of projections) before.push((await pool.request().query(query)).recordset);
    const other = await openDatabase({ ...config, database: name });
    try { await Promise.all([migrateDatabase(pool), migrateDatabase(other)]); } finally { await other.close(); }
    await migrateDatabase(pool);
    for (const [index, query] of projections.entries()) assert.deepEqual((await pool.request().query(query)).recordset, before[index]);
    const counts = (await pool.request().query(`SELECT (SELECT COUNT(*) FROM dbo.board_users) users,
      (SELECT COUNT(*) FROM dbo.auth_sessions) sessions,(SELECT COUNT(*) FROM dbo.oidc_login_attempts) flows,
      (SELECT COUNT(*) FROM dbo.posts WHERE author_tenant_id IS NOT NULL OR author_object_id IS NOT NULL) owners,
      (SELECT MAX(version) FROM dbo.schema_migrations) version`)).recordset[0];
    assert.deepEqual(counts, { users: 0, sessions: 0, flows: 0, owners: 0, version: 5 });
  } finally {
    await pool?.close();
    try { if (created && /^board_test_[a-f0-9]{32}$/.test(name)) await master.request().batch(`ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]`); }
    finally { await master.close(); }
  }
});

test("identity schema enforces owner pairs, session ownership, hash and expiry constraints", async () => {
  const f = await sqlFixture(); const tenant = randomUUID(), object = randomUUID(), hash = "a".repeat(64);
  const req = () => f.pool.request().input("tid", sql.UniqueIdentifier, tenant).input("oid", sql.UniqueIdentifier, object).input("hash", sql.Char(64), hash);
  try {
    await req().query("INSERT dbo.board_users(tenant_id,object_id,display_name) VALUES(@tid,@oid,N'가')");
    await assert.rejects(req().query("UPDATE dbo.board_users SET display_name=N'' WHERE tenant_id=@tid"));
    await req().query("UPDATE dbo.board_users SET display_name=REPLICATE(N'가',256) WHERE tenant_id=@tid");
    await assert.rejects(req().query("UPDATE dbo.board_users SET display_name=REPLICATE(N'가',257) WHERE tenant_id=@tid"));
    await req().query(`INSERT dbo.auth_sessions(id_hash,tenant_id,object_id,display_name,is_admin,app_origin,client_id,created_at,expires_at)
      VALUES(@hash,@tid,@oid,N'가',0,N'http://127.0.0.1:3100',NEWID(),SYSUTCDATETIME(),DATEADD(minute,30,SYSUTCDATETIME()))`);
    for (const update of ["id_hash=REPLICATE('A',64)", "id_hash='short'", "display_name=N''", "expires_at=created_at", "expires_at=DATEADD(second,3601,created_at)"])
      await assert.rejects(req().query(`UPDATE dbo.auth_sessions SET ${update} WHERE id_hash=@hash`));
    for (const [cols, vals] of [
      ["author_tenant_id", "@tid"], ["author_tenant_id,author_object_id", "@tid,@oid"],
    ]) await assert.rejects(req().query(`INSERT dbo.posts(title,content,nickname,password_hash,${cols}) VALUES(N't',N'c',N'n','old',${vals})`));
    await assert.rejects(req().query("INSERT dbo.posts(title,content,nickname,password_hash) VALUES(N't',N'c',N'n',NULL)"));
    await req().query("INSERT dbo.posts(title,content,nickname,password_hash,author_tenant_id,author_object_id) VALUES(N't',N'c',REPLICATE(N'가',256),NULL,@tid,@oid)");
    const upload = `INSERT dbo.upload_sessions(id,token_hash,client_key,expires_at,owner_tenant_id,owner_object_id,auth_session_hash)
      VALUES(NEWID(),REPLICATE('f',64),REPLICATE('e',64),DATEADD(minute,10,SYSUTCDATETIME()),@tid,@oid,@hash)`;
    await req().query(upload);
    await assert.rejects(req().query("DELETE dbo.auth_sessions WHERE id_hash=@hash"));
    await req().query("INSERT dbo.board_users(tenant_id,object_id,display_name) VALUES(@tid,NEWID(),N'다른 사람')");
    const mismatch = req().input("other", sql.UniqueIdentifier, randomUUID());
    await mismatch.query("INSERT dbo.board_users(tenant_id,object_id,display_name) VALUES(@tid,@other,N'다른 사용자')");
    await assert.rejects(req().query("UPDATE dbo.upload_sessions SET owner_object_id=(SELECT TOP(1) object_id FROM dbo.board_users WHERE tenant_id=@tid AND object_id<>@oid)"));
    await assert.rejects(req().query("UPDATE dbo.upload_sessions SET owner_object_id=NULL"));
    await assert.rejects(req().query("UPDATE dbo.upload_sessions SET auth_session_hash=REPLICATE('A',64)"));
    for (const value of ["REPLICATE('A',64)", "'short'"]) await assert.rejects(req().query(`INSERT dbo.oidc_login_attempts(state_hash,browser_hash,client_id,app_origin,return_to,secret_cipher,crypto_key_id,expires_at)
      VALUES(${value},REPLICATE('b',64),NEWID(),N'http://127.0.0.1:3100',N'/',CONVERT(varbinary(32),REPLICATE('x',32)),'0123456789abcdef',DATEADD(minute,5,SYSUTCDATETIME()))`));
    await assert.rejects(req().query(`INSERT dbo.oidc_login_attempts(state_hash,browser_hash,client_id,app_origin,return_to,secret_cipher,crypto_key_id,expires_at)
      VALUES(@hash,REPLICATE('b',64),NEWID(),N'http://127.0.0.1:3100',N'/',CONVERT(varbinary(32),REPLICATE('x',32)),'0123456789abcdef',DATEADD(minute,11,SYSUTCDATETIME()))`));
  } finally { await f.close(); }
});

test("limited application user has identity DML but no schema or owner privileges", async () => {
  const f = await sqlFixture();
  try {
    await f.pool.request().batch("CREATE USER board_app WITHOUT LOGIN");
    await f.pool.request().batch(await readFile(resolve("sql/grant-app-user.sql"), "utf8"));
    const result = await f.pool.request().query(`EXECUTE AS USER='board_app';
      BEGIN TRY
        DECLARE @tid uniqueidentifier=NEWID(),@oid uniqueidentifier=NEWID(),@now datetime2(3)=SYSUTCDATETIME();
        INSERT dbo.board_users(tenant_id,object_id,display_name) VALUES(@tid,@oid,N'검증');
        INSERT dbo.auth_sessions(id_hash,tenant_id,object_id,display_name,is_admin,app_origin,client_id,created_at,expires_at)
          VALUES(REPLICATE('a',64),@tid,@oid,N'검증',0,N'http://127.0.0.1:3100',NEWID(),@now,DATEADD(minute,30,@now));
        UPDATE dbo.auth_sessions SET display_name=N'갱신' WHERE tenant_id=@tid;
        INSERT dbo.oidc_login_attempts(state_hash,browser_hash,client_id,app_origin,return_to,secret_cipher,crypto_key_id,created_at,expires_at)
          VALUES(REPLICATE('a',64),REPLICATE('b',64),NEWID(),N'http://127.0.0.1:3100',N'/',CONVERT(varbinary(32),REPLICATE('x',32)),'0123456789abcdef',@now,DATEADD(minute,5,@now));
        UPDATE dbo.oidc_login_attempts SET return_to=N'/posts/new' WHERE state_hash=REPLICATE('a',64);
        SELECT (SELECT display_name FROM dbo.auth_sessions WHERE tenant_id=@tid) name,
          (SELECT return_to FROM dbo.oidc_login_attempts WHERE state_hash=REPLICATE('a',64)) path,
          IS_ROLEMEMBER('db_owner') AS [owner],HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','CREATE TABLE') ddl;
        DELETE dbo.oidc_login_attempts WHERE state_hash=REPLICATE('a',64);
        DELETE dbo.auth_sessions WHERE tenant_id=@tid;
        UPDATE dbo.board_users SET display_name=N'갱신' WHERE tenant_id=@tid;
        DELETE dbo.board_users WHERE tenant_id=@tid;
        REVERT;
      END TRY BEGIN CATCH REVERT; THROW; END CATCH;`);
    assert.deepEqual(result.recordset[0], { name: "갱신", path: "/posts/new", owner: 0, ddl: 0 });
    await assert.rejects(f.pool.request().batch(`EXECUTE AS USER='board_app'; BEGIN TRY
      CREATE TABLE dbo.identity_forbidden_ddl(id int); REVERT;
      END TRY BEGIN CATCH REVERT; THROW; END CATCH;`), (error: unknown) => error instanceof sql.RequestError && error.number === 262);
  } finally { await f.close(); }
});
