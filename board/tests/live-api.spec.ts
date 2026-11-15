import { createHmac } from "node:crypto";
import { test, expect, newClientIp } from "./helpers/client-fixture";
import { openDatabase, readSqlConfig } from "../src/lib/server/database";
import { normalizeClientIp } from "../src/lib/server/request-context";
import { verifyLive } from "../scripts/verify-live";

test("deployment verifier completes owned QA flow on an isolated SQL database", async () => {
  test.setTimeout(120000);
  const ip = newClientIp(), pool = await openDatabase(readSqlConfig(process.env));
  try {
    const result = await verifyLive({ url: "http://127.0.0.1:3100", expectedCommit: process.env.APP_VERSION ?? "local", allowQaWrites: true }, {
      pool, password: "admin-test-password", headers: { "client-ip": ip }, restart: async () => {},
      clientKey: createHmac("sha256", Buffer.from(process.env.RATE_LIMIT_KEY_SECRET!, "hex")).update(normalizeClientIp(ip)).digest("hex"),
    });
    expect(result.qaPostIds).toEqual([]);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.checks).toContain("logout/replay-denied");
  } finally { await pool.close(); }
});
