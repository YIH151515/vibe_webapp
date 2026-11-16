export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.WEBSITE_INSTANCE_ID &&
    process.env.MEDIA_CLEANUP_ENABLED === "1" && process.env.APP_TEST_MODE !== "1") {
    const [{ startMediaCleanup }, { getDatabase }, { getBlobStore }] = await Promise.all([
      import("./lib/server/media-cleanup"), import("./lib/server/database"), import("./lib/server/blob-store"),
    ]);
    startMediaCleanup({ getPool: getDatabase, getStore: getBlobStore });
  }
}
