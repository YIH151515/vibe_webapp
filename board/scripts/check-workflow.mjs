import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

export function checkWorkflow(text) {
  const flow = parse(text);
  assert.ok(flow.on.push.branches.includes("main"));
  assert.ok(flow.on.pull_request && "workflow_dispatch" in flow.on);
  for (const trigger of [flow.on.push, flow.on.pull_request]) {
    assert.ok(trigger.paths.indexOf("!board/README.md") > trigger.paths.indexOf("board/**"));
    assert.ok(trigger.paths.includes("!board/docs/**"));
  }
  assert.deepEqual(flow.permissions, { contents: "read" });
  assert.equal(flow.defaults.run["working-directory"], "board");
  const { verify, deploy } = flow.jobs;
  assert.equal(verify["runs-on"], "ubuntu-latest");
  assert.equal(deploy.needs, "verify");
  for (const guard of ["refs/heads/main", "pull_request", "AZURE_CLIENT_ID", "AZURE_TENANT_ID", "AZURE_SUBSCRIPTION_ID", "AZURE_WEBAPP_NAME", "AZURE_RESOURCE_GROUP"])
    assert.ok(deploy.if.includes(guard));
  assert.deepEqual(deploy.permissions, { contents: "read", "id-token": "write" });
  assert.equal(deploy.concurrency["cancel-in-progress"], false);
  assert.equal(deploy.environment, undefined);
  const setup = verify.steps.find(step => step.uses?.startsWith("actions/setup-node@"));
  assert.equal(setup.with["node-version"], "24");
  assert.equal(setup.with["cache-dependency-path"], "board/package-lock.json");
  for (const job of [verify, deploy]) for (const step of job.steps)
    if (step.uses) assert.match(step.uses, /^[\w/-]+@[a-f0-9]{40}$/);
  assert.ok(verify.steps.some(step => step.run?.includes("test:all")));
  assert.ok(verify.steps.some(step => step.run?.includes("tests/package.test.mjs")));
  assert.ok(deploy.steps.some(step => step.run?.includes("manifest['sha256'] == digest")));
  assert.ok(deploy.steps.some(step => step.run?.includes("--output none")));
  assert.ok(deploy.steps.some(step => step.uses?.startsWith("Azure/login@")));
  assert.ok(deploy.steps.some(step => step.uses?.startsWith("Azure/webapps-deploy@")));
  assert.ok(!/SQL_PASSWORD|ADMIN_PASSWORD|ADMIN_SESSION_SECRET|secrets\.|publish-profile/.test(text));
  console.log("Workflow structure, artifact checks and OIDC guards passed.");
}
checkWorkflow(await readFile(new URL("../../.github/workflows/board-azure.yml", import.meta.url), "utf8"));
