import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
try {
  const commit=process.argv[2];if(!/^[a-f0-9]{40}$/.test(commit))throw new Error();
  const credential=execFileSync("git",["-c","safe.directory=D:/vibeweb","credential","fill"],{
    input:"protocol=https\nhost=github.com\npath=YIH151515/vibe_webapp.git\n\n",encoding:"utf8",stdio:["pipe","pipe","pipe"],windowsHide:true,
    env:{...process.env,GIT_TERMINAL_PROMPT:"0",GCM_INTERACTIVE:"Never"},
  });
  const token=credential.split(/\r?\n/).find(line=>line.startsWith("password="))?.slice(9);if(!token)throw new Error();
  const headers={Authorization:"Bearer "+token,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
  const base="https://api.github.com/repos/YIH151515/vibe_webapp";
  async function get(path){const response=await fetch(base+path,{headers});if(!response.ok)throw new Error();return response.json();}
  const runs=await get("/actions/runs?head_sha="+commit+"&per_page=10");
  const run=runs.workflow_runs.find(value=>value.path===".github/workflows/board-azure.yml"&&value.head_sha===commit&&value.head_branch==="main"&&value.conclusion==="success");
  if(!run)throw new Error();
  const artifacts=await get("/actions/runs/"+run.id+"/artifacts");
  const matches=artifacts.artifacts.filter(value=>value.name==="board-release"&&!value.expired);
  if(matches.length!==1)throw new Error();
  const response=await fetch(base+"/actions/artifacts/"+matches[0].id+"/zip",{headers,redirect:"manual"});
  const location=response.headers.get("location");if(response.status!==302||!location)throw new Error();
  const target=new URL(location);
  if(target.protocol!=="https:"||![".blob.core.windows.net",".githubusercontent.com"].some(suffix=>target.hostname.endsWith(suffix)))throw new Error();
  // Signed storage redirect stays in memory; GitHub Authorization is never forwarded.
  const archive=await fetch(target,{redirect:"error"});if(!archive.ok)throw new Error();
  const folder=resolve(".deploy","actions-run-"+run.id);await mkdir(folder,{recursive:true});
  await writeFile(resolve(folder,"artifact.zip"),Buffer.from(await archive.arrayBuffer()));
  const metadata={commit,runId:run.id,url:run.html_url,artifactId:matches[0].id,conclusion:run.conclusion};
  await writeFile(resolve(folder,"github-run.json"),JSON.stringify(metadata,null,2)+"\n");console.log(JSON.stringify(metadata));
}catch{console.error("ENTRA_ACTIONS_ARTIFACT_DOWNLOAD_FAILED_DETAILS_SUPPRESSED");process.exitCode=1;}
