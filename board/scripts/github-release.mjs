import { execFileSync } from "node:child_process";

try {
  const credential = execFileSync("git", ["-c", "safe.directory=D:/vibeweb", "credential", "fill"], {
    input: "protocol=https\nhost=github.com\npath=YIH151515/vibe_webapp.git\n\n", encoding: "utf8", stdio: ["pipe","pipe","pipe"], windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" },
  });
  const token = credential.split(/\r?\n/).find(line => line.startsWith("password="))?.slice(9);
  if (!token) throw new Error("Authentication unavailable");
  const headers = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const base = "https://api.github.com/repos/YIH151515/vibe_webapp";
  const sha = process.argv[2] ?? execFileSync("git", ["-c","safe.directory=D:/vibeweb","rev-parse","HEAD"], { encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid commit");
  async function get(url) { const response = await fetch(url, { headers }); if (!response.ok) throw new Error("API unavailable"); return response.json(); }
  const runs = await get(base + "/actions/runs?head_sha=" + sha + "&per_page=10");
  const run = runs.workflow_runs.find(value => value.path === ".github/workflows/board-azure.yml");
  if (!run) { console.log(JSON.stringify({ commit: sha, status: "not-started" })); }
  else {
    const { jobs } = await get(run.jobs_url);
    const result = { id: run.id, url: run.html_url, commit: sha, status: run.status, conclusion: run.conclusion,
      jobs: jobs.map(job => ({ id: job.id, name: job.name, status: job.status, conclusion: job.conclusion,
        steps: job.steps?.map(step => ({ name: step.name, status: step.status, conclusion: step.conclusion })) })) };
    console.log(JSON.stringify(result, null, 2));
    if (process.argv.includes("--failure")) for (const job of jobs.filter(job => job.conclusion === "failure")) {
      const annotations = await get(job.check_run_url + "/annotations");
      for (const entry of annotations) console.log(String(entry.message).replaceAll(token,"[REDACTED]").slice(0,4000));
      const response = await fetch(base + "/actions/jobs/" + job.id + "/logs", { headers });
      if (response.ok) {
        const lines = (await response.text()).replaceAll(token,"[REDACTED]").split("\n");
        const errors = lines.filter(line => /error|failed|denied|##\[error\]/i.test(line));
        console.log(errors.slice(-20).join("\n").replace(/(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g,"[REDACTED]").slice(-7000));
      }
    }
  }
} catch { console.error("GitHub release inspection failed; authentication details suppressed."); process.exitCode = 1; }
