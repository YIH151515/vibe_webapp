import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { assertTestDatabase, openDatabase, readSqlConfig } from "../src/lib/server/database";
import { assertMediaTestStorage, createBlobStore } from "../src/lib/server/blob-store";
import { runMediaCleanup } from "../src/lib/server/media-cleanup";

export function parseCleanupArguments(args: string[]) {
  let apply = false, limit = 100;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--apply" && !apply) apply = true;
    else if (args[index] === "--limit" && /^[1-9][0-9]*$/.test(args[index + 1] ?? "")) limit = Number(args[++index]);
    else throw new Error("Invalid cleanup arguments");
  }
  if (!Number.isInteger(limit) || limit > 100) throw new Error("Invalid cleanup limit");
  return { apply, limit };
}
export async function cleanupCli(args: string[]) {
  const options = parseCleanupArguments(args);
  if (process.env.APP_TEST_MODE === "1") { assertTestDatabase(process.env); assertMediaTestStorage(process.env); }
  else {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    if (process.env.SQL_SERVER !== "sql-vibe-board-7b1417.database.windows.net" || process.env.SQL_DATABASE !== "dbboardprod" ||
      process.env.STORAGE_AUTH_MODE !== "azure-cli" || process.env.STORAGE_CONTAINER !== "board-images" ||
      !/^https:\/\/[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(process.env.STORAGE_BLOB_SERVICE_URL ?? "")) throw new Error("Unexpected cleanup environment");
  }
  const store = createBlobStore(process.env); // validates configuration; no network in dry-run
  const pool = await openDatabase(readSqlConfig(process.env));
  try {
    if (!options.apply) {
      const row = (await pool.request().query<{ pending: number }>("SELECT COUNT(*) pending FROM dbo.image_delete_jobs")).recordset[0];
      return { claimed: row.pending, deleted: 0, retained: 0, releasedBytes: 0, failed: 0 };
    }
    return await runMediaCleanup(pool, store, { limit: options.limit });
  } finally { await pool.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void cleanupCli(process.argv.slice(2)).then(result => console.log(JSON.stringify(result)), () => {
    console.error("MEDIA_CLEANUP_CLI_FAILED"); process.exitCode = 1;
  });
}
