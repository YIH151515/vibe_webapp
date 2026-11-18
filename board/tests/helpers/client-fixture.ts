import { randomBytes } from "node:crypto";
import { test as base } from "@playwright/test";
import { getDatabase } from "../../src/lib/server/database";
import { createTestActor, createTestSession } from "./auth-fixture";
export { expect } from "@playwright/test";
export type { Page, APIRequestContext, APIResponse } from "@playwright/test";
export function newClientIp(): string { return "2001:db8:" + randomBytes(12).toString("hex").match(/.{4}/g)!.join(":"); }
type Session = Awaited<ReturnType<typeof createTestSession>>;
export const test = base.extend<{ appSession: Session; principal: Session["principal"] }>({
  appSession: async ({}, provide) => { await provide(await createTestSession(await getDatabase(), createTestActor())); },
  principal: async ({ appSession }, provide) => { await provide(appSession.principal); },
  storageState: async ({ appSession, baseURL }, provide) => { await provide({ cookies: [{ name: appSession.cookieName, value: appSession.cookieValue, domain: new URL(baseURL!).hostname, path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }], origins: [] }); },
  request: async ({ playwright, baseURL, storageState }, provide) => {
    const context = await playwright.request.newContext({ baseURL, storageState, extraHTTPHeaders: { "client-ip": newClientIp(), Origin: baseURL! } });
    try { await provide(context); } finally { await context.dispose(); }
  },
  context: async ({ context }, provide) => { await context.setExtraHTTPHeaders({ "client-ip": newClientIp() }); await provide(context); },
});
