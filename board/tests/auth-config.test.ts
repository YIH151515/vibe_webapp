import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { assertTestOidc, ENTRA_TENANT_ID, readAuthConfig, type EntraConfig } from "../src/lib/server/auth-config";
import { getAccountKey, validateEntraClaims } from "../src/lib/server/auth-principal";
import { BoardError } from "../src/lib/server/errors";

const client = randomUUID();
const production: NodeJS.ProcessEnv = { NODE_ENV: "production", WEBSITE_INSTANCE_ID: "configuration-test", APP_ORIGIN: "https://app-vibe-board-prod-7b1417.azurewebsites.net",
  AUTH_MODE: "entra", ENTRA_TENANT_ID, ENTRA_CLIENT_ID: client, ENTRA_CLIENT_SECRET: "synthetic-client-secret", AUTH_ENCRYPTION_KEY: "a".repeat(64) };
const error = (status: number) => (value: unknown) => value instanceof BoardError && value.status === status;
function entra(env = production): EntraConfig { const result = readAuthConfig(env); assert.equal(result.mode, "entra"); return result as EntraConfig; }
function testEnv(): NodeJS.ProcessEnv { return { ...process.env, AUTH_MODE: "entra", ENTRA_TENANT_ID, AUTH_ENCRYPTION_KEY: "a".repeat(64),
  TEST_OIDC_ISSUER: "http://127.0.0.1:43123", TEST_OIDC_CLIENT_ID: client, TEST_OIDC_CLIENT_SECRET: "synthetic-test-secret" }; }

test("auth configuration derives its tenant issuer and defaults to closed maintenance", () => {
  const config = entra();
  assert.equal(config.issuer, `https://login.microsoftonline.com/${ENTRA_TENANT_ID}/v2.0`);
  assert.equal(config.callbackUrl, production.APP_ORIGIN + "/api/auth/callback");
  assert.equal(config.encryptionKey.length, 32); assert.match(config.cryptoKeyId, /^[a-f0-9]{16}$/);
  assert.deepEqual(readAuthConfig({ NODE_ENV: "development", APP_ORIGIN: "http://127.0.0.1:3000" }), { mode: "maintenance", origin: "http://127.0.0.1:3000" });
  const local: NodeJS.ProcessEnv = { ...production, WEBSITE_INSTANCE_ID: undefined, NODE_ENV: "development", APP_ORIGIN: "http://127.0.0.1:3200" };
  assert.equal(entra(local).origin, local.APP_ORIGIN);
  for (const patch of [
    { AUTH_MODE: "anonymous" }, { ENTRA_TENANT_ID: randomUUID() }, { ENTRA_CLIENT_ID: "not-a-guid" },
    { ENTRA_CLIENT_ID: "00000000-0000-0000-0000-000000000000" }, { ENTRA_CLIENT_SECRET: "" }, { ENTRA_CLIENT_SECRET: "        " },
    { AUTH_ENCRYPTION_KEY: "A".repeat(64) }, { AUTH_ENCRYPTION_KEY: "a".repeat(63) }, { ENTRA_ISSUER: "https://example.invalid" },
    { AUTH_ENCRYPTION_KEY: "a".repeat(64) + "\n" }, { ENTRA_CLIENT_ID: client + "\n" }, { ENTRA_CLIENT_SECRET: "synthetic\tsecret" },
    { APP_ORIGIN: "http://127.0.0.1:3000" }, { APP_ORIGIN: production.APP_ORIGIN + "/" }, { APP_ORIGIN: "https://user:pass@example.invalid" },
    { APP_ORIGIN: "https://example.invalid/path" }, { APP_TEST_MODE: "yes" }, { TEST_OIDC_ISSUER: "http://127.0.0.1:43123" },
    { STORAGE_AUTH_MODE: "azurite" },
  ]) assert.throws(() => readAuthConfig({ ...production, ...patch }), error(503));
  for (const origin of ["http://127.0.0.1:3100", "http://example.invalid:3000", "https://example.invalid"])
    assert.throws(() => readAuthConfig({ ...local, APP_ORIGIN: origin }), error(503));
});

test("test OIDC requires the SQL, Azurite, loopback and runtime guards together", () => {
  assertTestOidc(testEnv()); assert.equal(entra(testEnv()).issuer, testEnv().TEST_OIDC_ISSUER);
  for (const patch of [
    { SQL_SERVER: "production.database.windows.net" }, { SQL_DATABASE: "dbboardprod" }, { NODE_ENV: "production" },
    { WEBSITE_INSTANCE_ID: "must-not-test-cloud" }, { APP_ORIGIN: "http://127.0.0.1:3000" }, { TEST_OIDC_CLIENT_ID: "invalid" },
    { TEST_OIDC_ISSUER: "https://login.microsoftonline.com" }, { TEST_OIDC_ISSUER: "http://127.0.0.1:99999" },
    { TEST_OIDC_ISSUER: "http://127.0.0.1:43123/path" }, { TEST_OIDC_ISSUER: "http://127.0.0.1:43123?x=1" },
    { TEST_OIDC_ISSUER: "http://127.0.0.1:80" }, { TEST_OIDC_CLIENT_SECRET: "" }, { AZURITE_KEY: "not-a-test-key" },
    { TEST_OIDC_CLIENT_ID: client + "\n" }, { TEST_OIDC_CLIENT_SECRET: "synthetic\nsecret" },
    { STORAGE_BLOB_SERVICE_URL: "https://example.blob.core.windows.net" },
  ] satisfies Partial<NodeJS.ProcessEnv>[]) assert.throws(() => assertTestOidc({ ...testEnv(), ...patch }), error(503));
});

test("verified Member claims use immutable IDs, exact roles and complete display names", () => {
  const config = entra(), oid = randomUUID(), exp = Math.floor(Date.now() / 1000) + 3600;
  const claims = { tid: ENTRA_TENANT_ID.toUpperCase(), oid: oid.toUpperCase(), acct: 0, name: " 윤일호 ", exp, roles: ["Board.Admin"] };
  const identity = validateEntraClaims(claims, config);
  assert.equal(identity.tenantId, ENTRA_TENANT_ID); assert.equal(identity.objectId, oid); assert.equal(identity.displayName, "윤일호");
  assert.equal(identity.isAdmin, true); assert.equal(identity.tokenExpiresAt.getTime(), exp * 1000);
  assert.equal(validateEntraClaims({ ...claims, acct: "0", roles: undefined, name: "가" }, config).isAdmin, false);
  assert.equal(validateEntraClaims({ ...claims, roles: ["board.admin", "Board.Admin ", "OtherRole"] }, config).isAdmin, false);
  for (const size of [1, 21, 256]) assert.equal(validateEntraClaims({ ...claims, name: "가".repeat(size) }, config).displayName.length, size);
  for (const acct of [1, "1", undefined, null, false, [], "00"]) assert.throws(() => validateEntraClaims({ ...claims, acct }, config), error(403));
  assert.throws(() => validateEntraClaims({ ...claims, tid: randomUUID() }, config), error(403));
  for (const patch of [
    { oid: "not-a-guid" }, { oid: "00000000-0000-0000-0000-000000000000" }, { name: " " }, { name: "가".repeat(257) },
    { oid: oid + "\n" },
    { name: "이름\n위조" }, { exp: 0 }, { exp: Number.NaN }, { exp: "123" }, { exp: Number.MAX_SAFE_INTEGER },
    { roles: "Board.Admin" }, { roles: [null] }, { roles: Array(33).fill("User") }, { roles: ["r".repeat(129)] },
  ]) assert.throws(() => validateEntraClaims({ ...claims, ...patch }, config), error(401));
});

test("account quotas depend on canonical tenant and object IDs, not the browser or IP", () => {
  const tenantId = ENTRA_TENANT_ID, objectId = randomUUID(), key = randomBytes(32).toString("hex"), env: NodeJS.ProcessEnv = { NODE_ENV: "test", RATE_LIMIT_KEY_SECRET: key };
  const value = getAccountKey({ tenantId, objectId }, env);
  assert.equal(value, getAccountKey({ tenantId: tenantId.toUpperCase(), objectId: objectId.toUpperCase() }, env));
  assert.equal(value, createHmac("sha256", Buffer.from(key, "hex")).update(JSON.stringify(["board-user-v1", tenantId, objectId])).digest("hex"));
  assert.notEqual(value, getAccountKey({ tenantId, objectId: randomUUID() }, env));
  assert.notEqual(value, getAccountKey({ tenantId: randomUUID(), objectId }, env));
  assert.notEqual(value, getAccountKey({ tenantId, objectId }, { NODE_ENV: "test", RATE_LIMIT_KEY_SECRET: "b".repeat(64) }));
  assert.throws(() => getAccountKey({ tenantId, objectId }, { NODE_ENV: "test" }), error(503));
  assert.throws(() => getAccountKey({ tenantId, objectId }, { NODE_ENV: "test", RATE_LIMIT_KEY_SECRET: key + "\n" }), error(503));
});
