import { randomBytes } from "node:crypto";
import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";
export type { Page, APIRequestContext, APIResponse } from "@playwright/test";

export function newClientIp(): string {
  return "2001:db8:" + randomBytes(12).toString("hex").match(/.{4}/g)!.join(":");
}

export const test = base.extend({
  request: async ({ playwright, baseURL }, provide) => {
    const context = await playwright.request.newContext({
      baseURL, extraHTTPHeaders: { "client-ip": newClientIp() },
    });
    try { await provide(context); } finally { await context.dispose(); }
  },
  context: async ({ context }, provide) => {
    await context.setExtraHTTPHeaders({ "client-ip": newClientIp() });
    await provide(context);
  },
});
