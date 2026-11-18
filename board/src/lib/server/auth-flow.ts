import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import sql, { type ConnectionPool } from "mssql";
import * as oidc from "openid-client";
import { authUnavailable, type EntraConfig } from "./auth-config";
import { unauthorized, validateEntraClaims } from "./auth-principal";
import { createAppSession } from "./auth-session";
import { BoardError } from "./errors";
import { getOidcClient } from "./oidc-client";

const hex = (value: unknown): value is string => typeof value === "string" && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 2048 || !raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f\u007f-\u009f]/.test(raw)) return "/";
  try {
    const original = new URL(raw, "https://return.invalid");
    if (original.origin !== "https://return.invalid") return "/";
    let value = original.pathname;
    for (let round = 0; round <= 4; round++) {
      if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f-\u009f]/.test(value)) return "/";
      const url = new URL(value, "https://return.invalid");
      if (url.origin !== "https://return.invalid" || /^\/(?:login|api\/auth)(?:\/|$)/i.test(url.pathname)) return "/";
      const next = decodeURIComponent(value); if (next === value) return original.pathname + original.search + original.hash;
      if (round === 4) return "/"; value = next;
    }
  } catch { /* Treat unparseable paths as the board root. */ }
  return "/";
}
function aad(state: string, browser: string, config: EntraConfig): Buffer {
  return Buffer.from(JSON.stringify([hash(state), hash(browser), config.origin, config.clientId]));
}
export async function beginLogin(pool: ConnectionPool, config: EntraConfig, browserCookie: string | undefined, returnTo: string) {
  const client = await getOidcClient(config), state = randomBytes(32).toString("hex"), nonce = randomBytes(32).toString("hex");
  const browser = hex(browserCookie) ? browserCookie : randomBytes(32).toString("hex");
  const verifier = oidc.randomPKCECodeVerifier(), iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", config.encryptionKey, iv);
  cipher.setAAD(aad(state, browser, config));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ verifier, nonce })), cipher.final()]);
  const secret = Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]);
  try {
    await pool.request().input("state", sql.Char(64), hash(state)).input("browser", sql.Char(64), hash(browser))
      .input("client", sql.UniqueIdentifier, config.clientId).input("origin", sql.NVarChar(256), config.origin)
      .input("return", sql.NVarChar(2048), safeReturnTo(returnTo)).input("cipher", sql.VarBinary(2048), secret).input("key", sql.Char(16), config.cryptoKeyId)
      .query(`DECLARE @now DATETIME2(3)=SYSUTCDATETIME(); INSERT dbo.oidc_login_attempts(state_hash,browser_hash,client_id,app_origin,return_to,secret_cipher,crypto_key_id,created_at,expires_at)
        VALUES(@state,@browser,@client,@origin,@return,@cipher,@key,@now,DATEADD(minute,10,@now));`);
  } catch { throw authUnavailable(); }
  const authorizationUrl = oidc.buildAuthorizationUrl(client, { redirect_uri: config.callbackUrl, response_type: "code", response_mode: "query",
    scope: "openid profile", state, nonce, code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256" }).href;
  return { authorizationUrl, browserCookie: browser };
}

export async function finishLogin(pool: ConnectionPool, config: EntraConfig, callbackUrl: URL, browserCookie: string | undefined) {
  const query = callbackUrl.searchParams;
  if (callbackUrl.origin !== config.origin || callbackUrl.pathname !== "/api/auth/callback" || callbackUrl.search.length > 8192 ||
    ["state", "code", "error", "error_description"].some(key => query.getAll(key).length > 1) || !hex(query.get("state")) || !hex(browserCookie)) throw unauthorized();
  const state = query.get("state")!;
  let row: { secret_cipher: Buffer; crypto_key_id: string; return_to: string } | undefined;
  try {
    row = (await pool.request().input("state", sql.Char(64), hash(state)).input("browser", sql.Char(64), hash(browserCookie))
      .input("client", sql.UniqueIdentifier, config.clientId).input("origin", sql.NVarChar(256), config.origin).query<{ secret_cipher: Buffer; crypto_key_id: string; return_to: string }>(`
        DELETE FROM dbo.oidc_login_attempts OUTPUT deleted.secret_cipher,deleted.crypto_key_id,deleted.return_to
        WHERE state_hash=@state AND browser_hash=@browser AND client_id=@client
          AND app_origin COLLATE Latin1_General_100_BIN2=@origin AND expires_at>SYSUTCDATETIME();
      `)).recordset[0];
  } catch { throw authUnavailable(); }
  if (!row) throw unauthorized();
  if (query.has("error")) throw new BoardError("UNAUTHENTICATED", 401, query.get("error") === "access_denied" ? "로그인을 취소했습니다." : "다시 로그인해 주세요.");
  if (!query.get("code") || row.crypto_key_id !== config.cryptoKeyId) throw unauthorized();
  let proof: { verifier: string; nonce: string };
  try {
    const bytes = row.secret_cipher;
    if (bytes[0] !== 1 || bytes.length < 30) throw unauthorized();
    const decipher = createDecipheriv("aes-256-gcm", config.encryptionKey, bytes.subarray(1, 13));
    decipher.setAuthTag(bytes.subarray(13, 29)); decipher.setAAD(aad(state, browserCookie, config));
    proof = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]).toString("utf8"));
    if (!hex(proof.nonce) || typeof proof.verifier !== "string" || !/^[a-zA-Z0-9_-]{43,128}$/.test(proof.verifier)) throw unauthorized();
  } catch { throw unauthorized(); }
  const client = await getOidcClient(config);
  let claims: Record<string, unknown>;
  try {
    const tokens = await oidc.authorizationCodeGrant(client, callbackUrl, { expectedState: state, expectedNonce: proof.nonce, pkceCodeVerifier: proof.verifier, idTokenExpected: true });
    const verified = tokens.claims(); if (!verified) throw unauthorized(); claims = verified;
  } catch (error) {
    if (error instanceof BoardError) throw error;
    let cause: unknown = error;
    for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
      if (cause instanceof TypeError || (cause instanceof BoardError && cause.status === 503) ||
        ["TimeoutError", "AbortError"].includes((cause as { name?: string }).name ?? "")) throw authUnavailable();
      cause = (cause as { cause?: unknown }).cause;
    }
    throw unauthorized();
  }
  const identity = validateEntraClaims(claims, config);
  return { ...await createAppSession(pool, identity, config), returnTo: safeReturnTo(row.return_to) };
}
