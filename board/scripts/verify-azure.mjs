import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, relative, basename } from "node:path";
import { randomUUID } from "node:crypto";

async function run(args) {
  await new Promise((done, reject) => {
    const child = spawn("docker", args, { stdio: "inherit", windowsHide: true });
    child.once("error", reject); child.once("exit", code => code === 0 ? done() : reject(new Error("Linux release verification failed")));
  });
}
export async function verifyAzure() {
  const temp = await mkdtemp(join(tmpdir(), "board-release-"));
  const name = "board-release-" + randomUUID();
  try {
    for (const item of ["src", "scripts", "sql", "tests", "public", "package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "next-env.d.ts", "eslint.config.mjs", "postcss.config.mjs"])
      try { await cp(item, join(temp, item), { recursive: true }); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    const commit = execFileSync("git", ["-c", "safe.directory=D:/vibeweb", "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    // Keep dependency/build writes on Docker's Linux filesystem; exchange only source and final ZIP.
    await run(["run", "--name", name, "--rm", "--mount", `type=bind,source=${temp},target=/exchange`, "-e", "RELEASE_COMMIT=" + commit, "node:24-bookworm", "bash", "-euc",
      "mkdir /work; cp -a /exchange/. /work/; cd /work; npm ci --no-audit --no-fund; npx playwright install --with-deps chromium; npm run build:azure; npm run package:azure; node --test tests/package.test.mjs; mkdir /exchange/.deploy; cp .deploy/board.zip .deploy/release.json /exchange/.deploy/"]);
    await mkdir(".deploy", { recursive: true });
    for (const item of ["board.zip", "release.json"]) await cp(join(temp, ".deploy", item), resolve(".deploy", item));
  } finally {
    // Only our named container and verified, randomly allocated temporary directory.
    try { execFileSync("docker", ["rm", "-f", name], { stdio: "ignore", windowsHide: true }); } catch {}
    const rel = relative(resolve(tmpdir()), resolve(temp));
    if (!rel.startsWith("..") && basename(temp).startsWith("board-release-")) await rm(temp, { recursive: true, force: true });
  }
}
await verifyAzure();
