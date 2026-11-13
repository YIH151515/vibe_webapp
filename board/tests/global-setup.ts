import { assertTestDatabase, getDatabase, closeDatabase } from "../src/lib/server/database";
import { migrateDatabase } from "../src/lib/server/migrations";

export default async function globalSetup(): Promise<void> {
  assertTestDatabase(process.env);
  try { await migrateDatabase(await getDatabase()); }
  finally { await closeDatabase(); }
}
