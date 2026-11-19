import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
test("publishing hardening writes only two disabled policies, verifies them and keeps inspection read-only",()=>{
 const modulePath=resolve("scripts/publishing-policy.ps1").replaceAll("'","''");
 const entry=resolve("scripts/harden-publishing.ps1").replaceAll("'","''");
 const script=`$ErrorActionPreference='Stop';. '${modulePath}'
 $script:state=@{ftp=$true;scm=$true};$script:calls=[Collections.Generic.List[string]]::new()
 $read={param($name)$script:calls.Add('read:'+$name);@{name=$name;properties=@{allow=$script:state[$name]}}}
 $write={param($name)$script:calls.Add('write:'+$name);$script:state[$name]=$false}
 $inspect=@(Invoke-PublishingHardening Inspect $read $write)
 if($script:calls.Count-ne2-or!$inspect[0].allow){throw 'INSPECT_MUTATED'}
 $script:calls.Clear();$result=@(Invoke-PublishingHardening Apply $read $write)
 if(($script:calls-join',')-cne'write:ftp,write:scm,read:ftp,read:scm'-or$result.Count-ne2-or$result[0].allow-or$result[1].allow){throw 'APPLY_ORDER_OR_SCOPE'}
 $script:calls.Clear();$verified=@(Invoke-PublishingHardening Verify $read $write)
 if(($script:calls-join',')-cne'read:ftp,read:scm'){throw 'VERIFY_MUTATED'}
 $script:state.scm=$true;$rejected=$false
 try{$null=Invoke-PublishingHardening Verify $read $write}catch{if($_.Exception.Message-eq'PUBLISHING_BASIC_AUTH_STILL_ENABLED'){$rejected=$true}else{throw}}
 if(!$rejected){throw 'FAILED_READBACK_ACCEPTED'}
 $bad={param($name)@{name=$name;properties=@{allow='false'}}};$rejected=$false
 try{$null=Invoke-PublishingHardening Verify $bad $write}catch{if($_.Exception.Message-eq'PUBLISHING_POLICY_READBACK_INVALID'){$rejected=$true}else{throw}}
 if(!$rejected){throw 'NON_BOOLEAN_ACCEPTED'}
 $t=$null;$e=$null;[void][Management.Automation.Language.Parser]::ParseFile('${entry}',[ref]$t,[ref]$e);if($e.Count){throw 'ENTRY_PARSE_ERROR'}
 Write-Output 'PUBLISHING_POLICY_TEST_OK'`;
 assert.equal(execFileSync("pwsh",["-NoProfile","-NonInteractive","-Command",script],{encoding:"utf8",stdio:"pipe",windowsHide:true,timeout:30000}).trim(),"PUBLISHING_POLICY_TEST_OK");
});
test("infrastructure declares both publishing policies disabled",async()=>{
 const text=await readFile("../infra/azure/main.bicep","utf8");
 const policies=[...text.matchAll(/resource\s+\w+\s+'Microsoft\.Web\/sites\/basicPublishingCredentialsPolicies@[^']+'\s*=\s*\{\s*parent:\s*app\s+name:\s*'(ftp|scm)'\s+properties:\s*\{\s*allow:\s*false\s*\}\s*\}/g)].map(m=>m[1]).sort();
 assert.deepEqual(policies,["ftp","scm"]);
});
