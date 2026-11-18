import { randomBytes } from "node:crypto";
import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";
import { assertMediaTestStorage, createBlobStore, mediaStoragePipeline } from "../../src/lib/server/blob-store";
import { sqlFixture } from "./sql-fixture";

export async function mediaFixture() {
  assertMediaTestStorage(process.env);
  const sql = await sqlFixture();
  const database = await sql.pool.request().query<{ name: string }>("SELECT DB_NAME() AS name");
  const env: NodeJS.ProcessEnv = { ...process.env, SQL_DATABASE: database.recordset[0].name,
    STORAGE_CONTAINER: "board-test-" + randomBytes(16).toString("hex") };
  assertMediaTestStorage(env);
  const container = new BlobServiceClient(env.STORAGE_BLOB_SERVICE_URL!,
    mediaStoragePipeline(new StorageSharedKeyCredential(env.AZURITE_ACCOUNT!, env.AZURITE_KEY!))).getContainerClient(env.STORAGE_CONTAINER!);
  try { await container.create(); }
  catch (error) { await sql.close(); throw error; }
  return { pool: sql.pool, principal: sql.principal, context: sql.context, store: createBlobStore(env), containerName: env.STORAGE_CONTAINER!,
    async close() { try { await container.delete(); } finally { await sql.close(); } } };
}
