import { test, expect, newClientIp } from "./helpers/client-fixture";
import { openDatabase, readSqlConfig } from "../src/lib/server/database";
import { createBlobStore } from "../src/lib/server/blob-store";
import { verifyLiveMedia } from "../scripts/verify-live-media";

test("media release verifier uses owned isolated QA and cleans attachments", async () => {
  test.setTimeout(180000); const pool = await openDatabase(readSqlConfig(process.env));
  try {
    const result = await verifyLiveMedia({ url: "http://127.0.0.1:3100", expectedCommit: process.env.APP_VERSION ?? "local", allowQaWrites: true, expectEditorEnabled: true }, {
      adminPassword: "admin-test-password", operatorPool: pool, store: createBlobStore(process.env), headers: { "client-ip": newClientIp() }, restart: async () => {},
    });
    expect(result.remainingQaPostIds).toEqual([]); expect(result.remainingQaAssetIds).toEqual([]);
    expect(result.checks).toContain("logout/replay-denied");
  } finally { await pool.close(); }
});
