import { loadEnvConfig } from "@next/env";
const keys = ["AUTH_MODE", "ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "AUTH_ENCRYPTION_KEY"];
async function main() {
  let source = "";
  for await (const chunk of process.stdin) { source += String(chunk); if (source.length > 8192) throw new Error(); }
  const expected = JSON.parse(source) as Record<string, string>;
  if (Object.keys(expected).length !== keys.length || keys.some(key => typeof expected[key] !== "string")) throw new Error();
  for (const key of keys) delete process.env[key];
  loadEnvConfig(process.cwd(), true, { info() {}, error() { throw new Error(); } }, true);
  if (keys.some(key => process.env[key] !== expected[key])) throw new Error();
  console.log("ENTRA_LOCAL_ENV_ROUNDTRIP_OK");
}
void main().catch(() => { console.error("ENTRA_LOCAL_ENV_ROUNDTRIP_FAILED"); process.exitCode = 1; });
