import { randomUUID } from "node:crypto";
import type { ConnectionPool } from "mssql";
import { assertTestOidc, ENTRA_TENANT_ID, readAuthConfig } from "../../src/lib/server/auth-config";
import { createAppSession } from "../../src/lib/server/auth-session";
import { authCookieNames } from "../../src/lib/server/auth-http";
export type TestActor = { tenantId: string; objectId: string; displayName: string; isAdmin: boolean };
export function createTestActor(overrides: Partial<TestActor> = {}): TestActor {
  assertTestOidc(process.env);
  return { tenantId: ENTRA_TENANT_ID, objectId: randomUUID(), displayName: "테스트 작성자", isAdmin: false, ...overrides };
}
export async function createTestSession(pool: ConnectionPool, actor: TestActor) {
  assertTestOidc(process.env); const config = readAuthConfig(); if (config.mode !== "entra") throw new Error("TEST_AUTH_NOT_CONFIGURED");
  const result = await createAppSession(pool, { ...actor, tokenExpiresAt: new Date(Date.now() + 3600000) }, config);
  return { ...result, cookieName: authCookieNames(config.origin).session };
}
