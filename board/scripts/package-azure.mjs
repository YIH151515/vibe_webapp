import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve, relative, sep, basename } from "node:path";
import archiver from "archiver";

const root = resolve(".");
const output = resolve(root, ".deploy");
const staging = resolve(output, "staging");
function owned(path) {
  const rel = relative(root, path);
  if (!rel.startsWith(".deploy" + sep) || rel.includes("..")) throw new Error("Unsafe packaging path");
}
function allowed(path) {
  const name = basename(path);
  return !name.startsWith(".env") && !/\.(sqlite(?:-.*)?|pem|key|pfx|p12)$/i.test(name)
    && ![".git", ".memory", "data", "tests", "sql", ".agents", ".codex"].includes(name);
}
export async function packageAzure() {
  if (process.platform !== "linux") throw new Error("Package Linux release output on Linux only");
  owned(staging);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const standalone = resolve(".next/standalone");
  const names = await readdir(standalone);
  for (const required of ["server.js", "package.json", "node_modules", ".next"])
    if (!names.includes(required)) throw new Error("Incomplete standalone build: " + required);
  for (const name of ["server.js", "package.json", "node_modules", ".next"])
    await cp(resolve(standalone, name), resolve(staging, name), { recursive: true, dereference: true, filter: allowed });
  await cp(".next/static", resolve(staging, ".next/static"), { recursive: true, filter: allowed });
  try { await stat("public"); await cp("public", resolve(staging, "public"), { recursive: true, filter: allowed }); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const zipPath = resolve(output, "board.zip");
  owned(zipPath);
  await new Promise((done, reject) => {
    const stream = createWriteStream(zipPath);
    const zip = archiver("zip", { zlib: { level: 6 } });
    stream.once("close", done); stream.once("error", reject); zip.once("error", reject);
    zip.once("warning", reject); zip.pipe(stream); zip.directory(staging, false); void zip.finalize().catch(reject);
  });
  const sha256 = createHash("sha256").update(await readFile(zipPath)).digest("hex");
  const commit = process.env.GITHUB_SHA ?? process.env.RELEASE_COMMIT ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Release requires a Git commit SHA");
  await writeFile(resolve(output, "release.json"), JSON.stringify({ commit, sha256, nodeMajor: 24 }, null, 2) + "\n");
  console.log("Linux release ZIP and SHA256 manifest created.");
  return { zipPath, sha256 };
}
await packageAzure();
