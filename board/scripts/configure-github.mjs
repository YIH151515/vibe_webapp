import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

let stage = "local credential lookup";
try {
  let token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    const raw = execFileSync("git", ["-c", "safe.directory=D:/vibeweb", "credential", "fill"], {
      input: "protocol=https\nhost=github.com\npath=YIH151515/vibe_webapp.git\n\n", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" },
    });
    token = raw.split(/\r?\n/).find(line => line.startsWith("password="))?.slice(9);
  }
  if (!token) throw new Error("No credential");
  stage = "repository permission check";
  const base = "https://api.github.com/repos/YIH151515/vibe_webapp";
  const headers = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const repo = await fetch(base, { headers });
  if (!repo.ok) throw new Error("Repository access");
  const info = await repo.json();
  if (!info.permissions?.push) throw new Error("Repository write access");
  if (process.argv.includes("--check")) {
    console.log("Existing GitHub credential has repository write access.");
  } else {
    stage = "deployment variable configuration";
    const outputs = JSON.parse(await readFile(".deploy/azure-outputs.json", "utf8"));
    const variables = { AZURE_CLIENT_ID: outputs.clientId.value, AZURE_TENANT_ID: outputs.tenantId.value,
      AZURE_SUBSCRIPTION_ID: outputs.subscriptionId.value, AZURE_WEBAPP_NAME: "app-vibe-board-prod-7b1417", AZURE_RESOURCE_GROUP: "rg-vibe-board-prod" };
    for (const [name, value] of Object.entries(variables)) {
      let response = await fetch(base + "/actions/variables/" + name, { method: "PATCH", headers, body: JSON.stringify({ name, value }) });
      if (response.status === 404) response = await fetch(base + "/actions/variables", { method: "POST", headers, body: JSON.stringify({ name, value }) });
      if (!response.ok) throw new Error("Variable update");
      const verified = await fetch(base + "/actions/variables/" + name, { headers });
      if (!verified.ok || (await verified.json()).value !== value) throw new Error("Variable verification");
    }
    console.log("Five non-secret GitHub deployment variables set and verified.");
  }
} catch {
  console.error("GitHub unavailable at " + stage + "; no credential details were logged.");
  process.exitCode = 1;
}
