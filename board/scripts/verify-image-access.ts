import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AzureCliCredential } from "@azure/identity";
import { ContainerClient } from "@azure/storage-blob";
import { mediaStoragePipeline } from "../src/lib/server/blob-store";

export async function verifyImageAccess(client: ContainerClient): Promise<{ containerReadable: boolean; private: boolean }> {
  const properties = await client.getProperties({ abortSignal: AbortSignal.timeout(60000) });
  if (properties.blobPublicAccess) throw Object.assign(new Error("Container allows anonymous access"), { code: "CONTAINER_PUBLIC" });
  const anonymous = await fetch(client.url + "?restype=container", { method: "HEAD", headers: { "x-ms-version": "2023-11-03" }, redirect: "error", signal: AbortSignal.timeout(15000) });
  const disabledAccount = anonymous.status === 409 && anonymous.headers.get("x-ms-error-code") === "PublicAccessNotPermitted";
  if (![401, 403, 404].includes(anonymous.status) && !disabledAccount) throw Object.assign(new Error("Anonymous access is not rejected"), { code: "ANONYMOUS_ACCESS_STATUS", statusCode: anonymous.status });
  return { containerReadable: true, private: true };
}
async function main() {
  if (process.env.APP_TEST_MODE === "1") throw Object.assign(new Error("Live verification cannot run in test mode"), { code: "UNEXPECTED_TEST_MODE" });
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  if (process.env.STORAGE_AUTH_MODE !== "azure-cli" || process.env.STORAGE_BLOB_SERVICE_URL !== "https://stvibeboardimg7b1417.blob.core.windows.net" || process.env.STORAGE_CONTAINER !== "board-images") throw Object.assign(new Error("Unexpected storage configuration"), { code: "STORAGE_CONFIG_MISMATCH" });
  const client = new ContainerClient(process.env.STORAGE_BLOB_SERVICE_URL + "/board-images", mediaStoragePipeline(new AzureCliCredential()));
  console.log(JSON.stringify(await verifyImageAccess(client)));
}
if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/verify-image-access.ts")) {
  void main().catch((error: unknown) => {
    console.error("IMAGE_ACCESS_VERIFICATION_FAILED");
    const diagnostic = error as { code?: unknown; statusCode?: unknown; name?: unknown };
    for (const value of [diagnostic.code, diagnostic.name]) if (typeof value === "string" && /^[A-Za-z_]{1,50}$/.test(value)) console.error("CODE", value);
    if (typeof diagnostic.statusCode === "number") console.error("STATUS", diagnostic.statusCode);
    process.exitCode = 1;
  });
}
