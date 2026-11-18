import { createServer, type IncomingMessage } from "node:http";
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { once } from "node:events";
import { assertTestDatabase } from "../../src/lib/server/database";
import { assertMediaTestStorage } from "../../src/lib/server/blob-store";
import { ENTRA_TENANT_ID } from "../../src/lib/server/auth-config";

const actors: Record<string, string> = { alice: "11111111-1111-4111-8111-111111111111", bob: "22222222-2222-4222-8222-222222222222", admin: "33333333-3333-4333-8333-333333333333" };
export async function startFakeOidcIssuer(env: NodeJS.ProcessEnv = process.env) {
  assertTestDatabase(env); assertMediaTestStorage(env);
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 }), other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const clientId = randomUUID(), clientSecret = randomBytes(32).toString("hex"), kid = randomUUID();
  const jwk = { ...keys.publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" };
  const codes = new Map<string, { verifier: string; nonce: string; redirect: string; actor: string; expires: number }>();
  let issuer = "", metadataFault = "none";
  async function form(request: IncomingMessage) {
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of request) { bytes += chunk.length; if (bytes > 4096) throw new Error("TEST_BODY_LIMIT"); chunks.push(Buffer.from(chunk)); }
    return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  }
  const server = createServer((request, response) => {
    const json = (status: number, value: unknown) => { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(value)); };
    void (async () => {
      const url = new URL(request.url ?? "/", issuer);
      if (url.pathname === "/.well-known/openid-configuration") {
        if (metadataFault === "malformed") { response.end("<html>invalid metadata</html>"); return; }
        if (metadataFault === "redirect") { response.writeHead(302, { Location: "https://example.invalid/metadata" }); response.end(); return; }
        return json(200, { issuer, authorization_endpoint: issuer + "/authorize", token_endpoint: metadataFault === "foreign-endpoint" ? "https://example.invalid/token" : issuer + "/token", jwks_uri: issuer + "/jwks",
          response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_post"], code_challenge_methods_supported: ["S256"], authorization_response_iss_parameter_supported: true });
      }
      if (url.pathname === "/jwks") return json(200, { keys: [jwk] });
      if (url.pathname === "/authorize") {
        const q = url.searchParams, redirect = q.get("redirect_uri") ?? "";
        if (q.get("client_id") !== clientId || redirect !== "http://127.0.0.1:3100/api/auth/callback" || q.get("response_type") !== "code" ||
          q.get("code_challenge_method") !== "S256" || q.get("scope") !== "openid profile" || !/^[A-Za-z0-9_-]{43}$/.test(q.get("code_challenge") ?? "") ||
          q.get("state")?.length !== 64 || q.get("nonce")?.length !== 64 || [...q.keys()].some(key => q.getAll(key).length !== 1)) return json(400, { error: "invalid_request" });
        const actor = /(?:^|;\s*)oidc_test_user=([a-z-]+)/.exec(request.headers.cookie ?? "")?.[1] ?? "alice";
        const callback = new URL(redirect); callback.searchParams.set("state", q.get("state")!); callback.searchParams.set("iss", issuer);
        for (const [code, value] of codes) if (value.expires <= Date.now()) codes.delete(code);
        if (actor === "cancel") callback.searchParams.set("error", "access_denied");
        else {
          if (codes.size >= 1000) return json(503, { error: "temporarily_unavailable" });
          const code = randomBytes(32).toString("base64url");
          codes.set(code, { verifier: q.get("code_challenge")!, nonce: q.get("nonce")!, redirect, actor, expires: Date.now() + 60000 }); callback.searchParams.set("code", code);
        }
        response.writeHead(302, { Location: callback.href, "Cache-Control": "no-store" }); response.end(); return;
      }
      if (url.pathname === "/token" && request.method === "POST") {
        const q = await form(request), code = q.get("code") ?? "", saved = codes.get(code); codes.delete(code);
        if (!saved || saved.expires <= Date.now() || q.get("client_id") !== clientId || q.get("client_secret") !== clientSecret || q.get("redirect_uri") !== saved.redirect ||
          q.get("grant_type") !== "authorization_code" || [...q.keys()].some(key => q.getAll(key).length !== 1) ||
          createHash("sha256").update(q.get("code_verifier") ?? "").digest("base64url") !== saved.verifier) return json(400, { error: "invalid_grant" });
        if (saved.actor === "unavailable") return json(503, { error: "temporarily_unavailable" });
        const now = Math.floor(Date.now() / 1000), actor = saved.actor;
        const claims: Record<string, unknown> = { iss: issuer, aud: clientId, sub: actors[actor] ?? actors.alice, oid: actors[actor] ?? actors.alice,
          tid: ENTRA_TENANT_ID, name: actor === "admin" ? "테스트 관리자" : "테스트 사용자", acct: 0, iat: now, exp: now + 3600, nonce: saved.nonce };
        if (actor === "admin") claims.roles = ["Board.Admin"];
        if (actor === "guest") claims.acct = 1;
        if (actor === "missing-acct") delete claims.acct;
        if (actor === "wrong-tenant") claims.tid = randomUUID();
        if (actor === "wrong-audience") claims.aud = randomUUID();
        if (actor === "wrong-issuer") claims.iss = issuer + "/wrong";
        if (actor === "wrong-nonce") claims.nonce = "bad-nonce";
        if (actor === "expired") claims.exp = now - 300;
        if (actor === "future-iat") claims.iat = now + 300;
        if (actor === "unknown-role") claims.roles = ["board.admin"];
        const header = { alg: "RS256", kid: actor === "wrong-kid" ? "missing-key" : kid, typ: "JWT" };
        const payload = Buffer.from(JSON.stringify(header)).toString("base64url") + "." + Buffer.from(JSON.stringify(claims)).toString("base64url");
        const signature = sign("RSA-SHA256", Buffer.from(payload), actor === "bad-signature" ? other.privateKey : keys.privateKey).toString("base64url");
        return json(200, { token_type: "Bearer", access_token: randomBytes(32).toString("hex"), expires_in: 3600,
          id_token: actor === "malformed-token" ? "not-a-jwt" : payload + "." + signature });
      }
      json(404, { error: "not_found" });
    })().catch(() => { if (!response.headersSent) json(500, { error: "test_operation_failed" }); else response.end(); });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("TEST_OIDC_NOT_LISTENING");
  issuer = "http://127.0.0.1:" + address.port;
  return { issuer, clientId, clientSecret, setMetadataFault(value: string) { metadataFault = value; },
    async close() { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
