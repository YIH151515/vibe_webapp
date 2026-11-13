import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The driver has OS-specific dependencies that must run in native Node.js.
  serverExternalPackages: ["mssql"],
  ...(process.env.APP_TEST_MODE === "1"
    ? { distDir: ".next-test", typescript: { tsconfigPath: "tsconfig.playwright.json" } }
    : {}),
};

export default nextConfig;
