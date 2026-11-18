import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MSSQLServerContainer, type StartedMSSQLServerContainer } from "@testcontainers/mssqlserver";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";
import { assertMediaTestStorage, mediaStoragePipeline } from "../src/lib/server/blob-store";
import { assertTestDatabase, openDatabase, readSqlConfig } from "../src/lib/server/database";
import { migrateDatabase } from "../src/lib/server/migrations";
import { hashPassword } from "../src/lib/server/password";
import { startFakeOidcIssuer } from "../tests/helpers/fake-oidc-issuer";
import { assertTestOidc, ENTRA_TENANT_ID } from "../src/lib/server/auth-config";

type Mode = "service" | "api" | "e2e" | "all";

function testEnvironment(container: StartedMSSQLServerContainer, storage: StartedTestContainer, key: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(SQL_|ADMIN_|RATE_LIMIT_|EDITOR_|MEDIA_|STORAGE_|AZURITE_|AZURE_|AUTH_|ENTRA_|TEST_OIDC_)/.test(key) ||
      ["DATABASE_PATH", "APP_TEST_MODE", "APP_ORIGIN", "REQUEST_IP_MODE", "LOCAL_CLIENT_IP", "WEBSITE_INSTANCE_ID"].includes(key)) delete env[key];
  }
  return {
    ...env, NODE_ENV: "test", APP_TEST_MODE: "1", APP_ORIGIN: "http://127.0.0.1:3100",
    EDITOR_FEATURE_ENABLED: "1", MEDIA_CLEANUP_ENABLED: "0",
    STORAGE_AUTH_MODE: "azurite", AZURITE_ACCOUNT: "boardtest", AZURITE_KEY: key,
    STORAGE_BLOB_SERVICE_URL: `http://127.0.0.1:${storage.getMappedPort(10000)}/boardtest`,
    STORAGE_CONTAINER: "board-test-" + randomBytes(16).toString("hex"),
    REQUEST_IP_MODE: "test", RATE_LIMIT_KEY_SECRET: randomBytes(32).toString("hex"),
    SQL_SERVER: container.getHost(), SQL_PORT: String(container.getPort()),
    SQL_DATABASE: "board_test_" + randomUUID().replaceAll("-", ""),
    SQL_USER: container.getUsername(), SQL_PASSWORD: container.getPassword(),
    SQL_MIGRATION_USER: container.getUsername(), SQL_MIGRATION_PASSWORD: container.getPassword(),
  };
}

function stopChild(child: ChildProcess | undefined): void {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true }, () => undefined);
  } else child.kill("SIGTERM");
}

export async function runSqlTests(mode: Mode): Promise<number> {
  let container: StartedMSSQLServerContainer | undefined;
  let storage: StartedTestContainer | undefined;
  let issuer: Awaited<ReturnType<typeof startFakeOidcIssuer>> | undefined;
  const storageKey = randomBytes(32).toString("base64");
  let child: ChildProcess | undefined;
  let interrupted = false;
  const declarationsBefore = await readFile("next-env.d.ts", "utf8");
  const stop = () => { interrupted = true; stopChild(child); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    console.log("격리된 SQL Server와 Azurite 테스트 환경을 준비합니다.");
    const started = await Promise.allSettled([
      new MSSQLServerContainer("mcr.microsoft.com/mssql/server:2022-latest")
      .acceptLicense().withEnvironment({ MSSQL_PID: "Developer" })
      .withPassword(randomBytes(24).toString("hex") + "aA1!")
      .withStartupTimeout(180000).start().then(value => { container = value; }),
      new GenericContainer("mcr.microsoft.com/azure-storage/azurite:3.37.0")
        .withExposedPorts(10000).withEnvironment({ AZURITE_ACCOUNTS: "boardtest:" + storageKey })
        .withCommand(["azurite-blob", "--blobHost", "0.0.0.0", "--silent", "--disableTelemetry"])
        .withWaitStrategy(Wait.forLogMessage(/Azurite Blob service successfully listens/))
        .withStartupTimeout(120000).start().then(value => { storage = value; }),
    ]);
    if (started.some(result => result.status === "rejected") || !container || !storage) throw new Error("Test container startup failed");
    if (interrupted) return 130;
    const suites = mode === "all" ? ["service", "api", "e2e"] as const : [mode];
    const available = await readdir(resolve("tests"));
    for (const suite of suites) {
      const env = testEnvironment(container, storage, storageKey);
      issuer = await startFakeOidcIssuer(env);
      Object.assign(env, { AUTH_MODE: "entra", ENTRA_TENANT_ID, AUTH_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
        TEST_OIDC_ISSUER: issuer.issuer, TEST_OIDC_CLIENT_ID: issuer.clientId, TEST_OIDC_CLIENT_SECRET: issuer.clientSecret });
      assertTestOidc(env);
      env.ADMIN_PASSWORD_HASH = await hashPassword("admin-test-password");
      env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
      assertTestDatabase(env);
      assertMediaTestStorage(env);
      const blobContainer = new BlobServiceClient(env.STORAGE_BLOB_SERVICE_URL!,
        mediaStoragePipeline(new StorageSharedKeyCredential(env.AZURITE_ACCOUNT!, env.AZURITE_KEY!))).getContainerClient(env.STORAGE_CONTAINER!);
      await blobContainer.create();
      const config = readSqlConfig(env);
      const master = await openDatabase({ ...config, database: "master" });
      try {
        await master.request().batch(`CREATE DATABASE [${env.SQL_DATABASE}]`);
      } finally { await master.close(); }
      const pool = await openDatabase(config);
      try { await migrateDatabase(pool); } finally { await pool.close(); }
      if (interrupted) return 130;
      let args: string[];
      if (suite === "service") {
        const names = available.filter(name => name.endsWith(".test.ts")).sort();
        args = [resolve("node_modules/tsx/dist/cli.mjs"), "--test", ...names.map(name => "tests/" + name)];
      } else {
        const names = available.filter(name => name.endsWith(".spec.ts") &&
          (suite === "api" ? name.endsWith("api.spec.ts") : !name.endsWith("api.spec.ts"))).sort();
        args = [resolve("node_modules/@playwright/test/cli.js"), "test", ...names.map(name => "tests/" + name)];
      }
      let exitCode: number;
      try { exitCode = await new Promise<number>((done, reject) => {
        child = spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: "inherit", windowsHide: true });
        child.once("error", reject);
        child.once("exit", code => done(code ?? 1));
      }); } finally { await blobContainer.delete(); await issuer.close(); issuer = undefined; }
      child = undefined;
      if (exitCode !== 0 || interrupted) return interrupted ? 130 : exitCode;
    }
    return 0;
  } finally {
    stopChild(child);
    const stopped = await Promise.allSettled([container?.stop(), storage?.stop(), issuer?.close()]);
    if (stopped.some(result => result.status === "rejected")) console.error("소유 테스트 컨테이너 정리를 확인해 주세요.");
    const declarationsAfter = await readFile("next-env.d.ts", "utf8");
    // Restore only the declaration generated by this isolated test server.
    if (declarationsAfter.includes('"./.next-test/')) {
      await writeFile("next-env.d.ts", declarationsBefore, "utf8");
    }
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = process.argv[2];
  if (!["service", "api", "e2e", "all"].includes(mode)) {
    console.error("지원하는 테스트 모드가 필요합니다.");
    process.exitCode = 1;
  } else {
    void runSqlTests(mode as Mode).then(
      code => { process.exitCode = code; },
      error => {
        console.error("격리 SQL 테스트 실행에 실패했습니다. Docker와 테스트 환경을 확인해 주세요.");
        const diagnostic = error as { name?: unknown; code?: unknown; number?: unknown };
        // Driver messages/SQL may contain credentials. Print only bounded error identifiers.
        if (typeof diagnostic.code === "string" && /^[A-Za-z_]{1,40}$/.test(diagnostic.code)) console.error("CODE", diagnostic.code);
        if (typeof diagnostic.number === "number") console.error("NUMBER", diagnostic.number);
        process.exitCode = 1;
      },
    );
  }
}
