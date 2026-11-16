import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { once } from "node:events";

test("release ZIP runs independently, serves assets and fails health safely without SQL", { timeout: 60000 }, async () => {
  const zip = resolve(".deploy/board.zip");
  const names = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }).trim().split("\n");
  for (const file of ["server.js", "package.json"]) assert.ok(names.includes(file));
  assert.ok(names.some(name => name.startsWith("node_modules/")));
  assert.ok(names.some(name => name.startsWith(".next/static/") && name.endsWith(".css")));
  for (const name of names) {
    assert.ok(!name.startsWith("/") && !name.split("/").includes(".."));
    assert.ok(!/(^|\/)(\.env[^/]*|\.git|\.memory)(\/|$)|\.(sqlite(?:-[^/]*)?|pem|key|pfx|p12)$/i.test(name), name);
    assert.ok(!/^(src|scripts|data|tests|sql)\//.test(name), name);
  }
  const manifest = JSON.parse(await readFile(".deploy/release.json", "utf8"));
  assert.equal(manifest.sha256, createHash("sha256").update(await readFile(zip)).digest("hex"));
  assert.match(manifest.commit, /^[a-f0-9]{40}$/); assert.equal(manifest.nodeMajor, 24);
  const temp = await mkdtemp(join(tmpdir(), "board-package-test-"));
  let child;
  try {
    execFileSync("unzip", ["-q", zip, "-d", temp]);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SQL_|ADMIN_|APP_|RATE_LIMIT_|MEDIA_|STORAGE_|AZURITE_|EDITOR_|AZURE_)/.test(key)));
    execFileSync(process.execPath, ["-e", `
      const assert = require('node:assert/strict');
      const sharp = require('sharp');
      assert.equal(typeof require('@azure/storage-blob').BlobServiceClient, 'function');
      assert.equal(typeof require('@azure/identity').ManagedIdentityCredential, 'function');
      sharp({create:{width:1,height:1,channels:4,background:'transparent'}}).png().toBuffer()
        .then(png => sharp(png).webp().toBuffer()).then(async bytes => {
          assert.equal((await sharp(bytes).metadata()).format, 'webp');
        }).catch(() => { process.exitCode = 1; });
    `], { cwd: temp, env, stdio: "pipe", timeout: 15000 });
    const reservation = createServer().listen(0, "127.0.0.1");
    await once(reservation, "listening"); const port = reservation.address().port;
    await new Promise(done => reservation.close(done));
    child = spawn(process.execPath, ["server.js"], { cwd: temp, env: { ...env, WEBSITE_INSTANCE_ID: "package-check", MEDIA_CLEANUP_ENABLED: "0", HOSTNAME: "0.0.0.0", PORT: String(port) }, stdio: "ignore" });
    const base = `http://127.0.0.1:${port}`;
    let response;
    for (let i = 0; i < 100; i++) {
      try { response = await fetch(base); if (response.status === 200) break; } catch {}
      await new Promise(done => setTimeout(done, 200));
    }
    assert.equal(response?.status, 200);
    const html = await response.text();
    const css = html.match(/href="([^" ]+\.css(?:\?[^" ]*)?)"/);
    assert.ok(css); assert.equal((await fetch(new URL(css[1].replaceAll("&amp;", "&"), base))).status, 200);
    const health = await fetch(base + "/api/health");
    assert.equal(health.status, 503); assert.equal(health.headers.get("cache-control"), "no-store");
    assert.deepEqual(await health.json(), { status: "unavailable" });
    const editorConfig = await fetch(base + "/api/editor-config");
    assert.equal(editorConfig.status, 200); assert.equal(editorConfig.headers.get("cache-control"), "no-store");
    assert.deepEqual(await editorConfig.json(), { enabled: false, maxFileBytes: 5242880, maxImages: 5, maxInputBytes: 20971520 });
    assert.equal((await fetch(base)).status, 200);
  } finally {
    if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
    await rm(temp, { recursive: true, force: true });
  }
});
