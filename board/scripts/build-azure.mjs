import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";

export async function buildAzure() {
  if (process.platform !== "linux" || Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error("Azure release builds require Linux and Node 24. Use npm run verify:azure locally.");
  if ((await readdir(".")).some(name => name.startsWith(".env") && name !== ".env.example"))
    throw new Error("Release builds require a workspace without environment files.");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(SQL_|ADMIN_|RATE_LIMIT_|APP_TEST_MODE$|APP_ORIGIN$|REQUEST_IP_MODE$|LOCAL_CLIENT_IP$)/.test(key)));
  env.NEXT_DEPLOY_STANDALONE = "1";
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "build"], { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error("Azure build failed")));
  });
}
await buildAzure();
