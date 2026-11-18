param([ValidateSet('Inspect','Maintenance','DeployBaseline','Enable','Verify')][string]$Mode='Inspect',
  [ValidatePattern('^[a-f0-9]{40}$')][string]$Commit)
. (Join-Path $PSScriptRoot 'entra-common.ps1')
Assert-EntraOperator
$origin='https://app-vibe-board-prod-7b1417.azurewebsites.net'
$baselineRoot=Join-Path $script:EntraRepo 'board/.deploy/entra-schema5-maintenance'
$manifest=Get-Content -LiteralPath (Join-Path $baselineRoot 'release.json') -Raw | ConvertFrom-Json
$zip=Join-Path $baselineRoot 'board.zip'
$digest=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($manifest.commit -cnotmatch '^[a-f0-9]{40}$' -or $manifest.sha256 -cne $digest -or $manifest.nodeMajor -ne 24) { throw 'ENTRA_RECOVERY_MANIFEST_MISMATCH' }
function Get-EndpointStatus([string]$Path) {
  $handler=[Net.Http.HttpClientHandler]::new();$handler.AllowAutoRedirect=$false
  $client=[Net.Http.HttpClient]::new($handler);$client.Timeout=[TimeSpan]::FromSeconds(30)
  try{$response=$client.GetAsync($origin+$Path).GetAwaiter().GetResult();return [int]$response.StatusCode}
  finally{if($response){$response.Dispose()};$client.Dispose()}
}
function Set-ReleaseVersion([string]$Version) {
  $arm=Get-BoardAccessToken 'https://management.azure.com/'
  try {
    $document=Get-EntraSettings $arm;$values=@{}
    foreach($property in $document.properties.PSObject.Properties){$values[$property.Name]=$property.Value}
    $values.APP_VERSION=$Version
    $response=Invoke-BoardRest 'PUT' ('https://management.azure.com'+$script:EntraSite+'/config/appsettings?api-version=2024-11-01') $arm @{properties=$values}
    $response=$null
  }finally{$arm=$null;$values=$null;$document=$null}
}
switch($Mode) {
  'Inspect' {
    & (Join-Path $PSScriptRoot 'provision-entra.ps1') -Mode Verify
    & (Join-Path $PSScriptRoot 'set-entra-settings.ps1') -Mode Verify
    Write-Output ('ENTRA_BASELINE_VERIFIED '+$manifest.commit+' '+$digest)
  }
  'Maintenance' { & (Join-Path $PSScriptRoot 'set-entra-settings.ps1') -Mode Maintenance }
  'DeployBaseline' {
    & (Join-Path $PSScriptRoot 'set-entra-settings.ps1') -Mode Maintenance
    & az webapp deploy --subscription $script:EntraSpec.subscriptionId --resource-group rg-vibe-board-prod --name app-vibe-board-prod-7b1417 --src-path $zip --type zip --clean true --restart true --track-status false --output none --only-show-errors
    if($LASTEXITCODE -ne 0){throw 'ENTRA_BASELINE_DEPLOY_FAILED'}
    Set-ReleaseVersion $manifest.commit
    $closed=$false
    for($attempt=0;$attempt -lt 45;$attempt++){
      try { if((Get-EndpointStatus '/login') -eq 200 -and (Get-EndpointStatus '/api/posts') -eq 503 -and (Get-EndpointStatus '/') -eq 503){$closed=$true;break} }catch{}
      Start-Sleep -Seconds 2
    }
    if(!$closed){throw 'ENTRA_BASELINE_CLOSED_CHECK_FAILED'}
    Write-Output ('ENTRA_SCHEMA5_BASELINE_CLOSED '+$manifest.commit)
  }
  'Enable' {
    if(!$Commit -or $manifest.commit -cne $Commit){throw 'ENTRA_FINAL_ACTIONS_BASELINE_REQUIRED'}
    @{schemaVersion=5;deployedCommit=$Commit;maintenanceZipSha256=$digest} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $script:EntraRepo 'board/.deploy/entra-release-authorized.json') -Encoding utf8
    & (Join-Path $PSScriptRoot 'provision-entra.ps1') -Mode Verify
    & (Join-Path $PSScriptRoot 'set-entra-settings.ps1') -Mode Enabled
  }
  'Verify' {
    if(!$Commit){throw 'ENTRA_EXPECTED_RELEASE_COMMIT_REQUIRED'}
    $arm=Get-BoardAccessToken 'https://management.azure.com/'
    try{$settings=Get-EntraSettings $arm;if($settings.properties.AUTH_MODE -ne 'entra'){throw 'ENTRA_MODE_NOT_ENABLED'}}finally{$arm=$null;$settings=$null}
    $health=Invoke-RestMethod ($origin+'/api/health') -TimeoutSec 30
    if($health.status-ne'ok'-or$health.version-cne$Commit){throw 'ENTRA_RELEASE_HEALTH_MISMATCH'}
    if((Get-EndpointStatus '/login')-ne200-or(Get-EndpointStatus '/api/posts')-ne401-or(Get-EndpointStatus '/api/editor-config')-ne401-or(Get-EndpointStatus '/api/images/invalid')-ne401){throw 'ENTRA_RELEASE_ANONYMOUS_GUARD_FAILED'}
    $page=Get-EndpointStatus '/'
    if($page-notin@(200,303,307)){throw 'ENTRA_PROTECTED_PAGE_REDIRECT_FAILED'}
    Write-Output ('ENTRA_RELEASE_VERIFIED '+$Commit)
  }
}
