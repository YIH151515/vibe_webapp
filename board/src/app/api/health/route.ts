import { getDatabase } from "@/lib/server/database";
import { EXPECTED_SCHEMA_VERSION } from "@/lib/server/schema-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    const pool = await getDatabase();
    const result = await pool.request().query<{ version: number }>(
      "SELECT 1 AS ready; SELECT MAX(version) AS version FROM dbo.schema_migrations",
    );
    const records = result.recordsets as unknown as [unknown[], { version: number }[]];
    if (records[1]?.[0]?.version !== EXPECTED_SCHEMA_VERSION) throw new Error("Schema unavailable");
    return Response.json({ status: "ok", version: process.env.APP_VERSION ?? "local" }, { headers });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
