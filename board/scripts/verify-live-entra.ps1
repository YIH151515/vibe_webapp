param([Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$Commit,
  [ValidateSet('Local','Production')][string]$Environment='Production', [switch]$Local)
$ErrorActionPreference = 'Stop'
$isLocal=$Local -or $Environment -eq 'Local'
$url = if ($isLocal) { 'http://127.0.0.1:3200' } else { 'https://app-vibe-board-prod-7b1417.azurewebsites.net' }
$server=$null
try {
  if($isLocal){
    if(Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue){throw 'ENTRA_LOCAL_PORT_IN_USE'}
    $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=(Get-Command node).Source
    $start.WorkingDirectory=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    foreach($argument in @('node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3200')){[void]$start.ArgumentList.Add($argument)}
    $start.Environment['APP_ORIGIN']=$url;$start.Environment['APP_VERSION']=$Commit;$start.Environment['AUTH_MODE']='entra'
    $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.WindowStyle='Hidden'
    $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
    $server=[Diagnostics.Process]::new();$server.StartInfo=$start;[void]$server.Start()
    # Drain raw Next output in memory; never relay callback queries or save a log file.
    $serverOut=$server.StandardOutput.ReadToEndAsync();$serverErr=$server.StandardError.ReadToEndAsync()
    $ready=$false
    for($attempt=0;$attempt-lt30;$attempt++){
      if($server.HasExited){throw 'ENTRA_LOCAL_SERVER_EXITED'}
      try{$health=Invoke-RestMethod ($url+'/api/health') -TimeoutSec 5;if($health.status-eq'ok'-and$health.version-ceq$Commit){$ready=$true;break}}catch{}
      Start-Sleep -Seconds 1
    }
    if(!$ready){throw 'ENTRA_LOCAL_SERVER_NOT_READY'}
    Write-Output 'ENTRA_OWN_LOCAL_SERVER_READY'
  }
  & node (Join-Path $PSScriptRoot '../node_modules/tsx/dist/cli.mjs') (Join-Path $PSScriptRoot 'verify-live-entra.ts') --url $url --commit $Commit --qa-writes
  if ($LASTEXITCODE -ne 0) { throw 'Entra verification failed. Inspect safe check markers and own QA IDs.' }
} finally {
  if($server){
    if(!$server.HasExited){$server.Kill($true);$server.WaitForExit()}
    [void]$serverOut.GetAwaiter().GetResult();[void]$serverErr.GetAwaiter().GetResult()
    $server.Dispose()
  }
}
