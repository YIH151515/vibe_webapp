import { createHash } from "node:crypto";
import { assertTestDatabase } from "./database";
import { assertMediaTestStorage } from "./blob-store";
import { BoardError } from "./errors";

export const ENTRA_TENANT_ID = "69c1e470-4528-435a-a1ae-de98e0aac738";
export type EntraConfig = { mode: "entra"; origin: string; tenantId: string; clientId: string; clientSecret: string;
  issuer: string; callbackUrl: string; encryptionKey: Buffer; cryptoKeyId: string };
export type AuthConfig = { mode: "maintenance"; origin: string } | EntraConfig;
const GUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function authUnavailable(): BoardError { return new BoardError("SERVICE_UNAVAILABLE", 503, "로그인 설정 또는 연결을 확인해 주세요."); }
export function canonicalGuid(value: unknown): string {
  if (typeof value !== "string" || value.length !== 36 || !GUID.test(value) || value === "00000000-0000-0000-0000-000000000000") throw authUnavailable();
  return value.toLowerCase();
}

export function assertTestOidc(env: NodeJS.ProcessEnv): void {
  try {
    assertTestDatabase(env); assertMediaTestStorage(env);
    if (env.WEBSITE_INSTANCE_ID || env.APP_ORIGIN !== "http://127.0.0.1:3100" ||
      !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(env.TEST_OIDC_ISSUER ?? "") ||
      Number(new URL(env.TEST_OIDC_ISSUER!).port) > 65535 || new URL(env.TEST_OIDC_ISSUER!).origin !== env.TEST_OIDC_ISSUER || !env.TEST_OIDC_CLIENT_SECRET ||
      env.TEST_OIDC_CLIENT_SECRET.length < 8 || env.TEST_OIDC_CLIENT_SECRET.length > 1024 ||
      !env.TEST_OIDC_CLIENT_SECRET.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(env.TEST_OIDC_CLIENT_SECRET)) throw authUnavailable();
    canonicalGuid(env.TEST_OIDC_CLIENT_ID);
  } catch { throw authUnavailable(); }
}

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  try {
    const test = env.APP_TEST_MODE === "1";
    if (test) { assertTestDatabase(env); assertMediaTestStorage(env); }
    else if (Object.keys(env).some(key => key.startsWith("TEST_OIDC_")) || env.STORAGE_AUTH_MODE === "azurite" || env.NODE_ENV === "test") throw authUnavailable();
    if (env.APP_TEST_MODE !== undefined && !["0", "1"].includes(env.APP_TEST_MODE)) throw authUnavailable();
    const origin = env.APP_ORIGIN ?? "", url = new URL(origin);
    if (origin.length > 256 || url.origin !== origin || url.username || url.password ||
      (env.WEBSITE_INSTANCE_ID ? url.protocol !== "https:" :
        !(test ? origin === "http://127.0.0.1:3100" : ["http://127.0.0.1:3000", "http://127.0.0.1:3200"].includes(origin)))) throw authUnavailable();
    const mode = env.AUTH_MODE ?? "maintenance";
    if (mode === "maintenance") return { mode, origin };
    if (mode !== "entra" || env.ENTRA_TENANT_ID !== ENTRA_TENANT_ID ||
      env.AUTH_ENCRYPTION_KEY?.length !== 64 || !/^[a-f0-9]{64}$/.test(env.AUTH_ENCRYPTION_KEY) ||
      Object.keys(env).some(key => /^ENTRA_.*ISSUER/.test(key))) throw authUnavailable();
    if (test) assertTestOidc(env);
    const clientId = canonicalGuid(test ? env.TEST_OIDC_CLIENT_ID : env.ENTRA_CLIENT_ID);
    const clientSecret = (test ? env.TEST_OIDC_CLIENT_SECRET : env.ENTRA_CLIENT_SECRET) ?? "";
    if (clientSecret.length < 8 || clientSecret.length > 1024 || !clientSecret.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(clientSecret)) throw authUnavailable();
    const encryptionKey = Buffer.from(env.AUTH_ENCRYPTION_KEY!, "hex");
    return { mode, origin, tenantId: ENTRA_TENANT_ID, clientId, clientSecret,
      issuer: test ? env.TEST_OIDC_ISSUER! : `https://login.microsoftonline.com/${ENTRA_TENANT_ID}/v2.0`,
      callbackUrl: origin + "/api/auth/callback", encryptionKey, cryptoKeyId: createHash("sha256").update(encryptionKey).digest("hex").slice(0, 16) };
  } catch { throw authUnavailable(); }
}
