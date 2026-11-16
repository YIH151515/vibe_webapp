import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sql, { type ConnectionPool } from "mssql";
import { chromium, expect } from "@playwright/test";
import { assertTestDatabase, openDatabase, readSqlConfig } from "../src/lib/server/database";
import { normalizeClientIp } from "../src/lib/server/request-context";
import type { Post } from "../src/lib/posts/types";

type LiveCheck = { url: string; expectedCommit: string; allowQaWrites: boolean };
type Dependencies = { password: string; pool: ConnectionPool; clientKey: string; headers?: Record<string,string>; restart: () => Promise<void>; browsers?: boolean };
export async function verifyLive(input: LiveCheck, dependencies: Dependencies) {
  const origin = new URL(input.url).origin;
  if (new URL(origin).protocol !== "https:") {
    assertTestDatabase(process.env);
    assert.equal(origin, "http://127.0.0.1:3100");
  }
  const checks: string[] = [], prefix = `[deployment-check:${randomUUID()}]`;
  const authorPassword = randomBytes(24).toString("hex"), owned = new Map<number,string>();
  let cookie = "", retryAfterSeconds: number | undefined;
  async function request(path: string, method = "GET", body?: unknown, headers: Record<string,string> = {}) {
    return fetch(origin + path, { method, headers: { Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers, ...dependencies.headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000), redirect: "manual" });
  }
  async function health() {
    const response = await request("/api/health"); assert.equal(response.status, 200, "health HTTP");
    assert.deepEqual(await response.json(), { status: "ok", version: input.expectedCommit });
  }
  async function bucket() {
    return (await dependencies.pool.request().input("key", sql.Char(64), dependencies.clientKey)
      .query<{used_count:number;pending_count:number;expires_at:Date}>("SELECT used_count,pending_count,expires_at FROM dbo.rate_buckets WHERE action='post-create' AND client_key=@key")).recordset[0];
  }
  async function create(index: number) {
    const title = prefix + " " + index;
    const response = await request("/api/posts", "POST", { title, content: "긴 본문\n" + "일반 텍스트 ".repeat(150), nickname: "deploy-check", password: authorPassword },
      { "client-ip": `198.51.100.${index + 10}`, "x-forwarded-for": `203.0.113.${index + 10}`, "x-client-ip": `192.0.2.${index + 10}` });
    assert.equal(response.status, 201, "QA create HTTP");
    const post = await response.json() as Post;
    owned.set(post.id, title);
    assert.deepEqual(Object.keys(post).sort(), ["content","contentFormat","createdAt","document","id","nickname","title"]);
    const current = await bucket();
    assert.ok(current && current.used_count === index && current.pending_count === 0, "Proxy headers must retain the real source's shared HMAC bucket");
    return post;
  }
  async function remove(id: number, admin = false) {
    const existing = await request(`/api/posts/${id}`);
    if (existing.status === 404) { owned.delete(id); return; }
    assert.equal(existing.status, 200);
    assert.equal((await existing.json() as Post).title, owned.get(id), "Only owned QA titles may be deleted");
    const result = admin
      ? await request(`/api/admin/posts/${id}`, "DELETE", { confirm: true }, { Cookie: cookie })
      : await request(`/api/posts/${id}`, "DELETE", { password: authorPassword });
    assert.equal(result.status, 204, "QA cleanup HTTP"); owned.delete(id);
    assert.equal((await request(`/api/posts/${id}`)).status, 404);
  }
  await health(); checks.push("health/version");
  const root = await request("/"); assert.equal(root.status, 200);
  const html = await root.text(), css = html.match(/href="([^" ]+\.css(?:\?[^" ]*)?)"/);
  assert.ok(css); assert.equal((await fetch(new URL(css[1].replaceAll("&amp;", "&"), origin))).status, 200);
  const missing = await request("/deployment-check-missing-page"); assert.equal(missing.status, 404);
  checks.push("HTTPS/root/CSS/non-JSON");
  if (!input.allowQaWrites) return { deployedCommit: input.expectedCommit, checks, qaPostIds: [] as number[] };
  const before = await bucket();
  assert.ok(!before || before.expires_at.getTime() <= Date.now() || before.used_count + before.pending_count === 0,
    "An active source bucket exists; wait for its normal window without clearing it");
  try {
    const first = await create(1);
    const wrong = await request(`/api/posts/${first.id}`, "PATCH", { title: first.title, content: "변경 금지", nickname: "deploy-check", password: "incorrect-qa-password" });
    assert.equal(wrong.status, 403);
    assert.equal((await (await request(`/api/posts/${first.id}`)).json() as Post).content, first.content);
    const cross = await request(`/api/posts/${first.id}`, "PATCH", { title: first.title, content: "변경 금지", nickname: "deploy-check", password: authorPassword }, { Origin: "https://example.invalid" });
    assert.equal(cross.status, 403);
    const update = await request(`/api/posts/${first.id}`, "PATCH", { title: first.title, content: first.content + " 수정", nickname: "deploy-check", password: authorPassword });
    assert.equal(update.status, 200); assert.equal((await update.json() as Post).createdAt, first.createdAt);
    await remove(first.id); checks.push("CRUD/password/Origin/date");
    const second = await create(2);
    assert.equal((await request(`/api/admin/posts/${second.id}`, "DELETE", { confirm: true })).status, 401);
    const login = await request("/api/admin/login", "POST", { password: dependencies.password });
    assert.equal(login.status, 200, "Admin login HTTP");
    const setCookie = login.headers.getSetCookie().find(value => value.startsWith("board_admin="));
    assert.ok(setCookie && /httponly/i.test(setCookie) && /samesite=strict/i.test(setCookie) && /path=\//i.test(setCookie));
    if (origin.startsWith("https:")) assert.ok(/; secure/i.test(setCookie));
    cookie = setCookie.split(";")[0];
    assert.equal((await request(`/api/admin/posts/${second.id}`, "DELETE", { confirm: false }, { Cookie: cookie })).status, 400);
    await remove(second.id, true); checks.push("admin/cookie/consent");
    const persistent = await create(3);
    if (dependencies.browsers) {
      const browser = await chromium.launch();
      try {
        for (const width of [1280,390]) {
          const page = await browser.newPage({ viewport: { width, height: 844 } });
          await page.goto(origin + "/?q=" + encodeURIComponent(prefix));
          await expect(page.getByRole("link", { name: persistent.title, exact: true })).toBeVisible();
          await page.goto(origin + `/posts/${persistent.id}`);
          await expect(page.getByRole("heading", { level: 1 })).toHaveText(persistent.title);
          await expect(page.locator(".post-content")).toContainText("긴 본문");
          await page.goto(origin + `/posts/${persistent.id}/edit`);
          await expect(page.getByLabel(/^비밀번호/)).toHaveValue("");
          await page.goto(origin + "/admin");
          await page.getByLabel("관리자 비밀번호").fill(dependencies.password);
          await page.getByRole("button", { name: "로그인", exact: true }).click();
          await expect(page.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
          await page.getByRole("button", { name: "로그아웃", exact: true }).click();
          await page.close();
        }
      } finally { await browser.close(); }
      checks.push("Chromium/1280/390/search/detail/admin");
    }
    await dependencies.restart();
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { await health(); ready = true; break; } catch { await delay(5000); }
    }
    assert.ok(ready, "Health after restart");
    assert.equal((await (await request(`/api/posts/${persistent.id}`)).json() as Post).title, persistent.title);
    await remove(persistent.id, true); checks.push("restart/persistent-SQL/session");
    await create(4); await create(5);
    const limited = await request("/api/posts", "POST", { title: prefix + " blocked", content: "제한", nickname: "deploy-check", password: authorPassword }, { "client-ip": "198.51.100.99", "x-forwarded-for": "203.0.113.99", "x-client-ip": "192.0.2.99" });
    assert.equal(limited.status, 429, "Source limit must survive spoofed proxy headers and restart");
    retryAfterSeconds = Number(limited.headers.get("retry-after"));
    assert.ok(Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0);
    checks.push("proxy-IP/HMAC/shared-window/429/Retry-After");
  } finally {
    for (const id of [...owned.keys()]) {
      try { await remove(id, Boolean(cookie)); } catch { console.error("Owned QA cleanup requires attention; post ID:", id, "prefix:", prefix); }
    }
    if (cookie) {
      const old = cookie;
      assert.equal((await request("/api/admin/logout", "POST", undefined, { Cookie: cookie })).status, 204);
      cookie = "";
      assert.equal((await request("/api/admin/session", "GET", undefined, { Cookie: old })).status, 401);
      checks.push("logout/replay-denied");
    }
  }
  assert.equal(owned.size, 0, "All owned QA posts cleaned");
  return { deployedCommit: input.expectedCommit, checks, qaPostIds: [] as number[], retryAfterSeconds };
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(!args.some(value => /password|cookie|secret/i.test(value)), "Credentials must arrive on stdin only");
  const url = args[args.indexOf("--url") + 1], expectedCommit = args[args.indexOf("--commit") + 1];
  assert.ok(args.includes("--url") && args.includes("--commit") && /^[a-f0-9]{40}$/.test(expectedCommit));
  assert.equal(new URL(url).origin, "https://app-vibe-board-prod-7b1417.azurewebsites.net");
  process.loadEnvFile(".env.local");
  let password = "";
  if (args.includes("--qa-writes")) {
    assert.ok(!process.stdin.isTTY, "Pass administrator password through stdin");
    for await (const chunk of process.stdin) { password += String(chunk); assert.ok(password.length <= 1024); }
    password = password.replace(/\r?\n$/, ""); assert.ok(password.length >= 8 && password.length <= 128);
  }
  const pool = await openDatabase(readSqlConfig(process.env, "migration"));
  try {
    const ip = normalizeClientIp((await (await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(15000) })).text()).trim());
    const clientKey = createHmac("sha256", Buffer.from(process.env.RATE_LIMIT_KEY_SECRET!, "hex")).update(ip).digest("hex");
    const result = await verifyLive({ url, expectedCommit, allowQaWrites: args.includes("--qa-writes") }, { password, pool, clientKey, browsers: true,
      restart: async () => {
        const execute = promisify(execFile);
        const command = "az webapp restart --resource-group rg-vibe-board-prod --name app-vibe-board-prod-7b1417 --output none --only-show-errors";
        if (process.platform === "win32") await execute("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true });
        else await execute("az", command.split(" ").slice(1));
      } });
    console.log(JSON.stringify(result, null, 2));
  } finally { password = ""; await pool.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/verify-live.ts")) {
  void main().catch(error => {
    console.error("Live verification failed; credential details suppressed.", error instanceof assert.AssertionError ? "Check: " + error.operator : "Connection or operation unavailable");
    process.exitCode = 1;
  });
}
