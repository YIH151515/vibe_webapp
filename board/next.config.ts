import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() { return [
    { source: "/:path*", headers: securityHeaders },
    // Next's configured headers take precedence over route responses. Preserve
    // query secrecy on OIDC redirects without removing Origin from the login form.
    { source: "/api/auth/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
  ]; },
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
