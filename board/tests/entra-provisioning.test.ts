import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

test("deployment specification binds two confidential clients to exact callbacks and one administrator", async () => {
  const spec = JSON.parse(await readFile("../infra/azure/entra.parameters.example.json", "utf8"));
  assert.equal(spec.tenantId, "69c1e470-4528-435a-a1ae-de98e0aac738");
  assert.equal(spec.administratorObjectId, "e8222b20-96f4-4c25-a3af-1f40ebbbec56");
  assert.equal(spec.role.value, "Board.Admin"); assert.equal(spec.passwordLifetimeDays, 90);
  assert.deepEqual(spec.clients.prod.redirectUris, ["https://app-vibe-board-prod-7b1417.azurewebsites.net/api/auth/callback"]);
  assert.deepEqual(spec.clients.local.redirectUris, ["http://127.0.0.1:3000/api/auth/callback", "http://127.0.0.1:3200/api/auth/callback"]);
});
test("PowerShell provisioning and setting tools parse without running any Azure operation", () => {
  const paths = ["entra-common.ps1", "provision-entra.ps1", "set-entra-settings.ps1", "verify-entra-registration.ps1", "provision-azure.ps1"]
    .map(name => "'" + resolve("scripts", name).replaceAll("'", "''") + "'").join(",");
  const script = "$ErrorActionPreference='Stop';foreach($file in @(" + paths + ")){$t=$null;$e=$null;[void][Management.Automation.Language.Parser]::ParseFile($file,[ref]$t,[ref]$e);if($e.Count){throw 'INVALID_ENTRA_SCRIPT'}};Write-Output 'ENTRA_AST_OK'";
  const result = execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", stdio: "pipe", windowsHide: true, timeout: 30000 });
  assert.equal(result.trim(), "ENTRA_AST_OK");
});
test("cloud tools preserve unrelated settings and gate enabled mode on schema5 recovery and health", async () => {
  const provision = await readFile("scripts/provision-entra.ps1", "utf8"), settings = await readFile("scripts/set-entra-settings.ps1", "utf8");
  const whole = await readFile("scripts/provision-azure.ps1", "utf8");
  assert.match(provision, /ENTRA_NAME_COLLISION_REQUIRES_ID_REVIEW/);
  assert.match(provision, /ENTRA_UNRECORDED_PASSWORD_REFUSE_RESET/);
  assert.match(provision, /allowedMemberTypes=@\('User'\)/);
  assert.match(settings, /ENTRA_UNRELATED_SETTING_CHANGED/);
  assert.match(settings, /schemaVersion -ne 5/); assert.match(settings, /Get-FileHash/); assert.match(settings, /ENTRA_HEALTH_SCHEMA5_RELEASE_REQUIRED/);
  assert.match(whole, /Whole-template Apply is blocked/);
  assert.doesNotMatch(provision + settings, /Write-(Output|Host).*clientSecret|--password|azure-prod\.dpapi/);
});
test("Next dotenv roundtrip handles secret punctuation without printing or replacing unrelated values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "board-entra-env-"));
  try {
    const expected = { AUTH_MODE: "maintenance", ENTRA_TENANT_ID: "69c1e470-4528-435a-a1ae-de98e0aac738",
      ENTRA_CLIENT_ID: "11111111-1111-4111-8111-111111111111", ENTRA_CLIENT_SECRET: 'synthetic$credential"withquote', AUTH_ENCRYPTION_KEY: "a".repeat(64) };
    const lines = Object.entries(expected).map(([key, value]) => key + "='" + value.replaceAll("$", "\\$") + "'");
    await writeFile(join(directory, ".env.local"), "UNRELATED_SETTING=preserved\n" + lines.join("\n") + "\n");
    const result = execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/check-entra-env.ts")],
      { cwd: directory, input: JSON.stringify(expected), encoding: "utf8", env: { ...process.env, NODE_ENV: "development" }, windowsHide: true, timeout: 30000 });
    assert.equal(result.trim(), "ENTRA_LOCAL_ENV_ROUNDTRIP_OK");
    assert.match(await readFile(join(directory, ".env.local"), "utf8"), /^UNRELATED_SETTING=preserved\n/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("default access after consent cannot grant administrator privilege or hide another role assignment", () => {
  const common = resolve("scripts/entra-common.ps1").replaceAll("'", "''");
  const script = ". '" + common + "'; $admin=@{principalId='e8222b20-96f4-4c25-a3af-1f40ebbbec56';principalType='User';appRoleId='b804ef25-9734-4e12-87e3-b8ea76c73353'};" +
    "$default=@{principalId='e8222b20-96f4-4c25-a3af-1f40ebbbec56';principalType='User';appRoleId='00000000-0000-0000-0000-000000000000'};" +
    "$other=@{principalId='11111111-1111-4111-8111-111111111111';principalType='User';appRoleId='b804ef25-9734-4e12-87e3-b8ea76c73353'};" +
    "if(!(Test-BoardAdministratorAssignments @($admin,$default))){throw 'VALID_ROLE_REJECTED'};" +
    "if(Test-BoardAdministratorAssignments @($default)){throw 'DEFAULT_ESCALATED'};" +
    "if(Test-BoardAdministratorAssignments @($admin,$default,$other)){throw 'OTHER_ADMIN_ACCEPTED'};Write-Output 'ENTRA_ASSIGNMENTS_OK'";
  const result = execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 30000 });
  assert.equal(result.trim(), "ENTRA_ASSIGNMENTS_OK");
});
