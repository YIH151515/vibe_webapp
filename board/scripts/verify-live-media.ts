import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sql, { type ConnectionPool } from "mssql";
import sharp from "sharp";
import { chromium, expect } from "@playwright/test";
import { AzureCliCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { assertTestDatabase, openDatabase, readSqlConfig } from "../src/lib/server/database";
import { assertMediaTestStorage, createBlobStore, mediaStoragePipeline, type BlobStore } from "../src/lib/server/blob-store";
import { runMediaCleanup } from "../src/lib/server/media-cleanup";
import type { Post } from "../src/lib/posts/types";

type LiveMediaCheck = { url: string; expectedCommit: string; allowQaWrites: boolean; expectEditorEnabled: boolean };
type Dependencies = { adminPassword: string; operatorPool: ConnectionPool; store: BlobStore; restart: () => Promise<void>; headers?: Record<string, string> };
type AssetRow = { id: string; blob_name: string; state: string; charge_bytes: number | string; purge_after: Date | null };
export async function verifyLiveMedia(input: LiveMediaCheck, dependencies: Dependencies) {
  const origin = new URL(input.url).origin, production = origin === "https://app-vibe-board-prod-7b1417.azurewebsites.net";
  if (!production) { assertTestDatabase(process.env); assertMediaTestStorage(process.env); assert.equal(origin, "http://127.0.0.1:3100"); }
  const checks: string[] = [], prefix = `[editor-check:${randomUUID()}]`, password = randomBytes(24).toString("hex");
  const tokens = new Set<string>(), owned = new Map<number, string>(); let cookie = "";
  const assets = new Map<string, AssetRow>(); const pool = dependencies.operatorPool;
  async function request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
    return fetch(origin + path, { method, headers: { ...dependencies.headers, Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(60000) });
  }
  async function health() {
    const response = await request("/api/health"); assert.equal(response.status, 200, "health");
    assert.deepEqual(await response.json(), { status: "ok", version: input.expectedCommit });
    const config = await request("/api/editor-config"); assert.equal(config.status, 200);
    assert.equal((await config.json()).enabled, input.expectEditorEnabled);
  }
  // Only exact in-memory token hashes identify owned sessions; no global image sweep.
  async function collectAssets() {
    for (const token of tokens) {
      const rows = (await pool.request().input("hash", sql.Char(64), createHash("sha256").update(token).digest("hex"))
        .query<AssetRow>(`SELECT a.id,a.blob_name,a.state,a.charge_bytes,a.purge_after FROM dbo.image_assets a
          JOIN dbo.upload_sessions s ON s.id=a.session_id WHERE s.token_hash=@hash`)).recordset;
      for (const row of rows) assets.set(row.id.toLowerCase(), row);
    }
  }
  async function remove(id: number) {
    const response = await request(`/api/posts/${id}`); if (response.status === 404) { owned.delete(id); return; }
    assert.equal(response.status, 200); const current = await response.json() as Post;
    assert.equal(current.title, owned.get(id)); assert.ok(current.title.startsWith(prefix));
    const deleted = cookie ? await request(`/api/admin/posts/${id}`, "DELETE", { confirm: true }, { Cookie: cookie }) : await request(`/api/posts/${id}`, "DELETE", { password });
    assert.equal(deleted.status, 204, "owned-delete"); owned.delete(id);
  }
  await health(); checks.push("health/version/runtime-flag");
  const root = await request("/"); assert.equal(root.status, 200); const html = await root.text();
  const css = html.match(/href="([^" ]+\.css(?:\?[^" ]*)?)"/); assert.ok(css);
  assert.equal((await fetch(new URL(css[1].replaceAll("&amp;", "&"), origin))).status, 200); checks.push("root/CSS");
  if (!input.allowQaWrites) return { deployedCommit: input.expectedCommit, checks, remainingQaPostIds: [], remainingQaAssetIds: [] };
  const png = await sharp({ create: { width: 80, height: 40, channels: 4, background: { r: 30, g: 80, b: 180, alpha: 0.5 } } }).png().toBuffer();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    if (!input.expectEditorEnabled) {
      assert.equal((await request("/api/upload-sessions", "POST", {})).status, 503);
      assert.equal((await request("/api/images/uploads", "POST", {})).status, 503);
      assert.equal((await request("/api/posts", "POST", { title: prefix, nickname: "deploy-check", password, document: { version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "비활성" }] }] } })).status, 503);
      const created = await request("/api/posts", "POST", { title: prefix, nickname: "deploy-check", password, content: "기존 평문\n둘째 줄" });
      assert.equal(created.status, 201, "plain-baseline"); const post = await created.json() as Post; owned.set(post.id, post.title);
      assert.equal(post.contentFormat, "plain"); assert.equal((await request(`/api/posts/${post.id}`)).status, 200); checks.push("flag0/plain-compatible/rich-session-upload-disabled");
    } else {
      browser = await chromium.launch(); const context = await browser.newContext({ extraHTTPHeaders: dependencies.headers, viewport: { width: 1280, height: 844 } });
      const page = await context.newPage(); const observations: Promise<void>[] = [];
      page.on("response", response => { if (new URL(response.url()).pathname === "/api/upload-sessions" && response.status() === 201) observations.push(response.json().then(data => { if (/^[a-f0-9]{64}$/.test(data.token)) tokens.add(data.token); })); });
      const title = prefix + " 이미지", text = "서식 본문 한글 긴 문장 ".repeat(30);
      await page.goto(origin + "/posts/new");
      await page.getByRole("textbox", { name: /^제목/ }).fill(title); await page.getByLabel(/^닉네임/).fill("deploy-check"); await page.getByLabel(/^비밀번호/).fill(password);
      const body = page.getByRole("textbox", { name: /^본문/ }); await body.fill(text); await body.press("ControlOrMeta+a");
      await page.getByRole("button", { name: "굵게", exact: true }).click();
      await page.getByLabel("이미지 선택", { exact: true }).setInputFiles({ name: "qa.png", mimeType: "image/png", buffer: png });
      const save = page.waitForResponse(r => new URL(r.url()).pathname === "/api/posts" && r.request().method() === "POST");
      await page.getByRole("button", { name: "글 등록", exact: true }).click(); const saved = await save;
      assert.equal(saved.status(), 201, "browser-image-post"); const first = await saved.json() as Post; owned.set(first.id, title);
      await Promise.all(observations); await collectAssets(); assert.equal(assets.size, 1);
      const firstAsset = [...assets.values()][0], imagePath = `/api/images/${firstAsset.id.toLowerCase()}`;
      await expect(page).toHaveURL(new RegExp(`/posts/${first.id}$`)); await expect(page.locator(".rich-content strong")).toContainText("서식 본문");
      const image = await request(imagePath); assert.equal(image.status, 200); assert.equal(image.headers.get("content-type"), "image/webp"); const original = Buffer.from(await image.arrayBuffer());
      assert.equal((await request(imagePath, "HEAD")).status, 200);
      assert.equal((await request(imagePath, "GET", undefined, { "If-None-Match": image.headers.get("etag")! })).status, 304);
      if (production) {
        const direct = await fetch(process.env.STORAGE_BLOB_SERVICE_URL + "/board-images/" + firstAsset.blob_name, { headers: { "x-ms-version": "2023-11-03" }, signal: AbortSignal.timeout(20000) });
        assert.ok([401,403,404].includes(direct.status), "private-direct-blob");
      }
      for (const width of [1280,390]) {
        await page.setViewportSize({ width, height: 844 }); await page.goto(origin + "/?q=" + encodeURIComponent(prefix));
        await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible(); await page.goto(origin + `/posts/${first.id}`);
        await expect(page.locator(".rich-content img")).toBeVisible();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "viewport-overflow");
        await page.goto(origin + `/posts/${first.id}/edit`); await expect(page.getByLabel(/^비밀번호/)).toHaveValue("");
        await expect(page.getByRole("button", { name: "굵게", exact: true })).toBeVisible();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "editor-overflow");
      }
      checks.push("browser/file-picker/format/search/1280/390/private-blob/ETag");
      const plain = await request("/api/posts", "POST", { title: prefix + " 소유권", nickname: "deploy-check", password, content: "변경 금지" });
      assert.equal(plain.status, 201); const other = await plain.json() as Post; owned.set(other.id, other.title);
      assert.equal((await request(`/api/posts/${other.id}`, "PATCH", { title: other.title, nickname: other.nickname, password, document: first.document })).status, 409);
      assert.equal((await (await request(`/api/posts/${other.id}`)).json() as Post).content, other.content);
      assert.equal((await request(`/api/posts/${first.id}`, "PATCH", { title, nickname: "deploy-check", password, document: first.document }, { Origin: "https://example.invalid" })).status, 403);
      assert.equal((await request("/api/upload-sessions", "POST", { postId: first.id, password: "incorrect-qa-password" })).status, 403);
      const session = await request("/api/upload-sessions", "POST", {}); assert.equal(session.status, 201); const { token } = await session.json(); tokens.add(token);
      async function upload(bytes: Buffer, mime: string, suppliedToken = token) {
        const form = new FormData(); form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), "qa");
        return fetch(origin + "/api/images/uploads", { method: "POST", headers: { ...dependencies.headers, ...(production ? { "client-ip": "198.51.100.52", "x-forwarded-for": "203.0.113.52", "x-client-ip": "192.0.2.52" } : {}), Origin: origin, Authorization: "Bearer " + suppliedToken, "Idempotency-Key": randomUUID() }, body: form, signal: AbortSignal.timeout(60000) });
      }
      assert.equal((await upload(png, "image/png", "0".repeat(64))).status, 401);
      assert.equal((await upload(Buffer.from("<svg/>"), "image/png")).status, 415);
      assert.equal((await upload(Buffer.alloc(5242881), "image/png")).status, 413);
      const draft = await upload(png, "image/png"); assert.equal(draft.status, 201); const draftAsset = await draft.json();
      assert.equal((await request(draftAsset.url)).status, 404);
      assert.equal((await request("/api/upload-sessions/current", "DELETE", undefined, { Authorization: "Bearer " + token })).status, 204);
      checks.push("ownership/Origin/password/token/MIME/size/draft-private");
      await dependencies.restart(); let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) { try { await health(); ready = true; break; } catch { await delay(5000); } }
      assert.ok(ready, "restart-health"); assert.deepEqual(Buffer.from(await (await request(imagePath)).arrayBuffer()), original);
      assert.deepEqual((await (await request(`/api/posts/${first.id}`)).json() as Post).document, first.document);
      // UI edit retains an attached image and adds a new one, then detaches the original.
      await page.goto(origin + `/posts/${first.id}/edit`); await page.getByLabel(/^비밀번호/).fill(password);
      await page.getByLabel("이미지 선택", { exact: true }).setInputFiles({ name: "qa.png", mimeType: "image/png", buffer: png });
      await page.getByRole("button", { name: "수정 저장", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/posts/${first.id}$`));
      await expect(page.locator(".rich-content img")).toHaveCount(2);
      assert.equal((await (await request(`/api/posts/${first.id}`)).json() as Post).createdAt, first.createdAt);
      await page.goto(origin + `/posts/${first.id}/edit`); await page.getByLabel(/^비밀번호/).fill(password);
      await page.getByRole("button", { name: "이미지 1 제거", exact: true }).click(); await page.getByRole("button", { name: "수정 저장", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/posts/${first.id}$`)); assert.equal((await request(imagePath)).status, 404);
      await Promise.all(observations); await collectAssets(); assert.ok(assets.size >= 3 && assets.size <= 5); checks.push("restart/persistent-format-and-bytes/edit/retain/add/detach/date");
      await page.goto(origin + "/admin"); await page.getByLabel("관리자 비밀번호").fill(dependencies.adminPassword);
      await page.getByRole("button", { name: "로그인", exact: true }).click(); await expect(page.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
      const admin = (await context.cookies()).find(value => value.name === "board_admin"); assert.ok(admin); cookie = `board_admin=${admin.value}`;
      assert.equal((await request(`/api/admin/posts/${first.id}`, "DELETE", { confirm: false }, { Cookie: cookie })).status, 400);
      await remove(first.id); for (const asset of assets.values()) assert.equal((await request(`/api/images/${asset.id}`)).status, 404);
      checks.push("admin-browser/consent/delete/image-inaccessible");
    }
  } finally {
    await browser?.close();
    // Reconcile a lost create response using our unguessable prefix and author password.
    const rows = (await pool.request().input("prefix", sql.NVarChar(100), prefix).query<{id:number;title:string}>("SELECT id,title FROM dbo.posts WHERE CHARINDEX(@prefix,title)=1 AND nickname=N'deploy-check'")).recordset;
    for (const row of rows) owned.set(row.id, row.title);
    for (const id of [...owned.keys()]) { try { await remove(id); } catch { console.error("OWN_QA_POST_REMAINS", id); } }
    for (const token of tokens) { try { await request("/api/upload-sessions/current", "DELETE", undefined, { Authorization: "Bearer " + token }); } catch { /* cleanup outbox handles interrupted sessions */ } }
    await collectAssets();
    if (assets.size) {
      let pending = true;
      for (let attempt = 0; attempt < 65 && pending; attempt++) {
        await runMediaCleanup(pool, dependencies.store, { assetIds: [...assets.keys()] }); await collectAssets();
        pending = [...assets.values()].some(a => !["soft_deleted","purged"].includes(a.state)); if (pending) await delay(5000);
      }
      assert.ok(!pending, "owned-cleanup-complete");
      for (const asset of assets.values()) {
        assert.equal((await request(`/api/images/${asset.id}`)).status, 404);
        if (asset.state === "soft_deleted") { assert.ok(Number(asset.charge_bytes) > 0); assert.ok(asset.purge_after && asset.purge_after.getTime() > Date.now() + 6 * 86400000); }
        if (production && asset.state === "soft_deleted") {
          const container = new BlobServiceClient(process.env.STORAGE_BLOB_SERVICE_URL!, mediaStoragePipeline(new AzureCliCredential())).getContainerClient("board-images");
          let deleted = false;
          for await (const blob of container.listBlobsFlat({ prefix: asset.blob_name, includeDeleted: true })) if (blob.name === asset.blob_name && blob.deleted) deleted = true;
          assert.ok(deleted, "Azure-soft-delete-marker");
        }
      }
      checks.push("owned-filter-cleanup/soft-delete/7-day-charge-retained");
    }
    if (cookie) {
      assert.equal((await request("/api/admin/logout", "POST", undefined, { Cookie: cookie })).status, 204);
      assert.equal((await request("/api/admin/session", "GET", undefined, { Cookie: cookie })).status, 401); cookie = ""; checks.push("logout/replay-denied");
    }
  }
  assert.equal(owned.size, 0, "owned-QA-cleaned"); await health();
  return { deployedCommit: input.expectedCommit, checks, remainingQaPostIds: [...owned.keys()], remainingQaAssetIds: [...assets.values()].filter(a => !["soft_deleted","purged"].includes(a.state)).map(a => a.id) };
}

async function main() {
  const args = process.argv.slice(2), commit = args[args.indexOf("--commit") + 1]; assert.match(commit, /^[a-f0-9]{40}$/);
  process.loadEnvFile(".env.local"); assert.equal(process.env.SQL_SERVER, "sql-vibe-board-7b1417.database.windows.net"); assert.equal(process.env.SQL_DATABASE, "dbboardprod");
  assert.equal(process.env.STORAGE_AUTH_MODE, "azure-cli"); assert.equal(process.env.STORAGE_BLOB_SERVICE_URL, "https://stvibeboardimg7b1417.blob.core.windows.net");
  let password = ""; assert.ok(!process.stdin.isTTY);
  for await (const chunk of process.stdin) { password += String(chunk); assert.ok(password.length <= 1024); } password = password.replace(/\r?\n$/, "");
  const pool = await openDatabase(readSqlConfig(process.env, "migration"));
  try {
    const result = await verifyLiveMedia({ url: "https://app-vibe-board-prod-7b1417.azurewebsites.net", expectedCommit: commit, allowQaWrites: true, expectEditorEnabled: !args.includes("--disabled") }, {
      adminPassword: password, operatorPool: pool, store: createBlobStore(process.env), restart: async () => {
        await promisify(execFile)("powershell.exe", ["-NoProfile", "-Command", "az webapp restart --subscription 7b1417d8-833d-4ba9-a5cd-d27c91a28b83 --resource-group rg-vibe-board-prod --name app-vibe-board-prod-7b1417 --output none --only-show-errors; if ($LASTEXITCODE -ne 0) { exit 1 }"], { windowsHide: true });
      },
    }); console.log(JSON.stringify(result));
  } finally { password = ""; await pool.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/verify-live-media.ts")) void main().catch(error => {
  // No Playwright assertion dump, response body, SQL text, token or credential.
  console.error("LIVE_MEDIA_CHECK_FAILED", error instanceof assert.AssertionError ? error.message.split("\n")[0].replace(/[^a-zA-Z0-9 /_-]/g, "").slice(0,100) : "operation-unavailable"); process.exitCode = 1;
});
