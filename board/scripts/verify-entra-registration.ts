import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import * as oidc from "openid-client";
import { readAuthConfig, type EntraConfig } from "../src/lib/server/auth-config";
import { getOidcClient } from "../src/lib/server/oidc-client";
import { validateEntraClaims } from "../src/lib/server/auth-principal";

const administrator = "e8222b20-96f4-4c25-a3af-1f40ebbbec56";
export async function verifyEntraRegistration(config: EntraConfig, options: { port: 3200; timeoutMs: number }): Promise<{ tenantMatches: boolean; member: boolean; admin: boolean; checks: string[] }> {
  if (options.port !== 3200 || options.timeoutMs < 1 || options.timeoutMs > 600000 ||
    config.origin !== "http://127.0.0.1:3200" || config.issuer !== "https://login.microsoftonline.com/69c1e470-4528-435a-a1ae-de98e0aac738/v2.0") throw new Error("PREFLIGHT_SCOPE_REJECTED");
  const client = await getOidcClient(config);
  type Proof = { browser: string; state: string; nonce: string; verifier: string; expires: number };
  let proof: Proof | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let accept!: (value: { tenantMatches: boolean; member: boolean; admin: boolean; checks: string[] }) => void, deny!: (code: string) => void;
  const verdict = new Promise<{ tenantMatches: boolean; member: boolean; admin: boolean; checks: string[] }>((yes, no) => { accept = yes; deny = code => no(new Error(code)); });
  // The rejection is observed even if starting a browser fails before awaiting it.
  void verdict.catch(() => undefined);
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "GET" || request.headers.host !== "127.0.0.1:3200" || (request.url?.length ?? 0) > 8192) throw new Error();
      const url = new URL(request.url ?? "/", config.origin);
      if (url.pathname === "/") {
        const verifier = oidc.randomPKCECodeVerifier();
        proof = { browser: randomBytes(32).toString("hex"), state: randomBytes(32).toString("hex"), nonce: randomBytes(32).toString("hex"), verifier, expires: Date.now() + 600000 };
        const authorization = oidc.buildAuthorizationUrl(client, { redirect_uri: config.callbackUrl, scope: "openid profile", response_type: "code", response_mode: "query",
          state: proof.state, nonce: proof.nonce, code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256" });
        response.writeHead(303, { Location: authorization.href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
          "Set-Cookie": "board_preflight=" + proof.browser + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=600" }); response.end(); return;
      }
      if (url.pathname !== "/api/auth/callback") { response.writeHead(404); response.end(); return; }
      const saved = proof, cookies = (request.headers.cookie ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith("board_preflight="));
      if (!saved || saved.expires <= Date.now() || cookies.length !== 1 || cookies[0] !== "board_preflight=" + saved.browser ||
        url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== saved.state) throw new Error();
      proof = undefined;
      const tokens = await oidc.authorizationCodeGrant(client, url, { expectedState: saved.state, expectedNonce: saved.nonce, pkceCodeVerifier: saved.verifier, idTokenExpected: true });
      const claims = tokens.claims(); if (!claims) throw new Error();
      const identity = validateEntraClaims(claims as Record<string, unknown>, config);
      if (identity.objectId !== administrator || !identity.isAdmin) throw new Error();
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      response.end("<!doctype html><html lang='ko'><meta charset='utf-8'><title>로그인 확인 완료</title><p>회사 구성원과 게시판 관리자 권한을 확인했습니다. 이 창은 자동으로 닫힙니다.</p></html>");
      accept({ tenantMatches: true, member: true, admin: true, checks: ["real-code-pkce-nonce-signature", "tenant-member", "initial-administrator-oid", "Board.Admin"] });
    })().catch(() => {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      response.end("회사 로그인 또는 게시판 관리자 권한을 확인하지 못했습니다."); deny("PREFLIGHT_PROTOCOL_OR_ACCOUNT_REJECTED");
    });
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await new Promise<void>((yes, no) => { server.once("error", no); server.listen(3200, "127.0.0.1", yes); });
    timer = setTimeout(() => deny("PREFLIGHT_TIMEOUT"), options.timeoutMs);
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    console.log("ENTRA_PREFLIGHT_BROWSER_READY http://127.0.0.1:3200");
    await page.goto(config.origin);
    return await verdict;
  } finally {
    if (timer) clearTimeout(timer); proof = undefined;
    await browser?.close();
    server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
  }
}
async function main() {
  let payload = "";
  for await (const chunk of process.stdin) { payload += String(chunk); if (payload.length > 8192) throw new Error(); }
  const local = JSON.parse(payload) as { clientId: string; clientSecret: string; encryptionKey: string };
  const config = readAuthConfig({ NODE_ENV: "development", AUTH_MODE: "entra", APP_ORIGIN: "http://127.0.0.1:3200",
    ENTRA_TENANT_ID: "69c1e470-4528-435a-a1ae-de98e0aac738", ENTRA_CLIENT_ID: local.clientId, ENTRA_CLIENT_SECRET: local.clientSecret, AUTH_ENCRYPTION_KEY: local.encryptionKey });
  payload = ""; local.clientSecret = ""; local.encryptionKey = "";
  if (config.mode !== "entra") throw new Error();
  console.log(JSON.stringify(await verifyEntraRegistration(config, { port: 3200, timeoutMs: 600000 })));
}
if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/verify-entra-registration.ts")) void main().catch((error: unknown) => {
  const code = error instanceof Error && ["PREFLIGHT_TIMEOUT", "PREFLIGHT_SCOPE_REJECTED", "PREFLIGHT_PROTOCOL_OR_ACCOUNT_REJECTED"].includes(error.message) ? error.message : "PREFLIGHT_OPERATION_UNAVAILABLE";
  console.error("ENTRA_PREFLIGHT_FAILED", code, "브라우저 로그인/MFA, Member·관리자 역할 및 3200 포트를 확인해 주세요."); process.exitCode = 1;
});
