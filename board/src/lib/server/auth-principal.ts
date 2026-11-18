import { createHmac } from "node:crypto";
import { authUnavailable, canonicalGuid, type EntraConfig } from "./auth-config";
import { BoardError } from "./errors";

export type Principal = { tenantId: string; objectId: string; displayName: string; isAdmin: boolean; sessionHash: string; expiresAt: Date };
export type VerifiedIdentity = Omit<Principal, "sessionHash" | "expiresAt"> & { tokenExpiresAt: Date };
export function unauthorized(): BoardError { return new BoardError("UNAUTHENTICATED", 401, "다시 로그인해 주세요."); }
export function forbidden(): BoardError { return new BoardError("FORBIDDEN", 403, "접근 권한이 없습니다."); }
export function validDisplayName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 256 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw unauthorized();
  return value.trim();
}
/** Call only with claims whose signature, issuer, audience, expiry and nonce the OIDC client verified. */
export function validateEntraClaims(claims: Record<string, unknown>, config: EntraConfig): VerifiedIdentity {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) throw unauthorized();
  let tenantId: string, objectId: string;
  try { tenantId = canonicalGuid(claims.tid); objectId = canonicalGuid(claims.oid); } catch { throw unauthorized(); }
  if (tenantId !== config.tenantId || (claims.acct !== 0 && claims.acct !== "0")) throw forbidden();
  if (typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) || claims.exp <= Date.now() / 1000 ||
    !Number.isFinite(new Date(claims.exp * 1000).getTime())) throw unauthorized();
  if (claims.iat !== undefined && (typeof claims.iat !== "number" || !Number.isSafeInteger(claims.iat) ||
    claims.iat < 0 || claims.iat > Date.now() / 1000 + 30 || claims.iat > claims.exp)) throw unauthorized();
  const roles = claims.roles === undefined ? [] : claims.roles;
  if (!Array.isArray(roles) || roles.length > 32 || roles.some(role => typeof role !== "string" || !role.length || role.length > 128)) throw unauthorized();
  return { tenantId, objectId, displayName: validDisplayName(claims.name), isAdmin: roles.includes("Board.Admin"), tokenExpiresAt: new Date(claims.exp * 1000) };
}

export function getAccountKey(principal: Pick<Principal, "tenantId" | "objectId">, env: NodeJS.ProcessEnv = process.env): string {
  const key = env.RATE_LIMIT_KEY_SECRET ?? "";
  if (key.length !== 64 || !/^[a-f0-9]{64}$/.test(key)) throw authUnavailable();
  return createHmac("sha256", Buffer.from(key, "hex")).update(JSON.stringify([
    "board-user-v1", canonicalGuid(principal.tenantId), canonicalGuid(principal.objectId),
  ])).digest("hex");
}
