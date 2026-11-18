import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  logging: { incomingRequests: { ignore: [/^\/api\/auth\/callback(?:\?|$)/] } },
  // The driver has OS-specific dependencies that must run in native Node.js.
  serverExternalPackages: ["mssql", "sharp", "@azure/storage-blob", "@azure/identity"],
  ...(process.env.NEXT_DEPLOY_STANDALONE === "1"
    ? { output: "standalone" as const, outputFileTracingRoot: process.cwd() }
    : {}),
  ...(process.env.APP_TEST_MODE === "1"
    ? { distDir: ".next-test", typescript: { tsconfigPath: "tsconfig.playwright.json" } }
    : {}),
};

export default nextConfig;
