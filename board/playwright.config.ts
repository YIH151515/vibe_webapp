import { defineConfig } from "@playwright/test";
import { assertTestDatabase } from "./src/lib/server/database";

assertTestDatabase(process.env);

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  // Windows development routes compile on first use. Await observable UI state
  // within the existing 30s test budget instead of failing during compilation.
  expect: { timeout: 15000 },
  use: { baseURL: "http://127.0.0.1:3100", browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      APP_TEST_MODE: "1", SQL_SERVER: process.env.SQL_SERVER!,
      SQL_PORT: process.env.SQL_PORT!, SQL_DATABASE: process.env.SQL_DATABASE!,
      SQL_USER: process.env.SQL_USER!, SQL_PASSWORD: process.env.SQL_PASSWORD!,
    },
  },
});
