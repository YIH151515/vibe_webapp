param([ValidateSet('Maintenance','Enabled','Verify')][string]$Mode='Verify')
. (Join-Path $PSScriptRoot 'entra-common.ps1')
Assert-EntraOperator
$credentials=Read-EntraSecrets
$metadata=Read-EntraMetadata
$armToken=Get-BoardAccessToken 'https://management.azure.com/'
$authKeys=@('AUTH_MODE','ENTRA_TENANT_ID','ENTRA_CLIENT_ID','ENTRA_CLIENT_SECRET','AUTH_ENCRYPTION_KEY')
function Test-LocalRoundtrip($Expected) {
  $start=[Diagnostics.ProcessStartInfo]::new()
  $start.FileName=(Get-Command node).Source
  $start.WorkingDirectory=Join-Path $script:EntraRepo 'board'
  $start.ArgumentList.Add('node_modules/tsx/dist/cli.mjs')
  $start.ArgumentList.Add('scripts/check-entra-env.ts')
  $start.UseShellExecute=$false; $start.CreateNoWindow=$true; $start.WindowStyle='Hidden'
  $start.RedirectStandardInput=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
  $child=[Diagnostics.Process]::new();$child.StartInfo=$start
  try {
    [void]$child.Start()
    $outTask=$child.StandardOutput.ReadToEndAsync();$errTask=$child.StandardError.ReadToEndAsync()
    $child.StandardInput.Write(($Expected | ConvertTo-Json -Compress));$child.StandardInput.Close()
    if (!$child.WaitForExit(30000)) { $child.Kill();throw 'ENTRA_ENV_CHECK_TIMEOUT' }
    $safeOutput=$outTask.GetAwaiter().GetResult();[void]$errTask.GetAwaiter().GetResult()
    if ($child.ExitCode -ne 0 -or $safeOutput.Trim() -ne 'ENTRA_LOCAL_ENV_ROUNDTRIP_OK') { throw 'ENTRA_ENV_ROUNDTRIP_FAILED' }
    Write-Output 'ENTRA_LOCAL_ENV_ROUNDTRIP_OK'
  } finally { $child.Dispose() }
}
try {
  foreach ($environment in @('prod','local')) {
    $entry=$credentials[$environment]
    if (!$entry -or $entry.clientId -ne $metadata[$environment].clientId -or [DateTimeOffset]::Parse($entry.expiresAt) -le [DateTimeOffset]::UtcNow) { throw 'ENTRA_SETTINGS_CREDENTIAL_MISSING_OR_EXPIRED' }
  }
  if ($credentials.prod.clientSecret -eq $credentials.local.clientSecret -or $credentials.prod.encryptionKey -eq $credentials.local.encryptionKey) { throw 'ENTRA_ENVIRONMENT_SECRETS_MUST_DIFFER' }
  if ($Mode -eq 'Enabled') {
    $gatePath=Join-Path $script:EntraRepo 'board/.deploy/entra-release-authorized.json'
    if (!(Test-Path -LiteralPath $gatePath)) { throw 'ENTRA_RELEASE_GATE_REQUIRED' }
    $gate=Get-Content -LiteralPath $gatePath -Raw | ConvertFrom-Json
    $baseline=Join-Path $script:EntraRepo 'board/.deploy/entra-schema5-maintenance/board.zip'
    if ($gate.schemaVersion -ne 5 -or $gate.deployedCommit -cnotmatch '^[a-f0-9]{40}$' -or
        !(Test-Path -LiteralPath $baseline) -or (Get-FileHash -LiteralPath $baseline -Algorithm SHA256).Hash.ToLowerInvariant() -cne $gate.maintenanceZipSha256) { throw 'ENTRA_RELEASE_BASELINE_REQUIRED' }
    $health=Invoke-RestMethod 'https://app-vibe-board-prod-7b1417.azurewebsites.net/api/health' -TimeoutSec 30
    if ($health.status -ne 'ok' -or $health.version -cne $gate.deployedCommit) { throw 'ENTRA_HEALTH_SCHEMA5_RELEASE_REQUIRED' }
  }
  $document=Get-EntraSettings $armToken
  $properties=@{}
  foreach ($property in $document.properties.PSObject.Properties) { $properties[$property.Name]=[string]$property.Value }
  $before=@{};foreach ($key in $properties.Keys) { $before[$key]=$properties[$key] }
  $desiredMode=if($Mode -eq 'Verify') { $properties.AUTH_MODE } elseif($Mode -eq 'Enabled') {'entra'} else {'maintenance'}
  if ($desiredMode -notin @('maintenance','entra')) { throw 'ENTRA_SETTINGS_MODE_INVALID' }
  $prod=@{AUTH_MODE=$desiredMode;ENTRA_TENANT_ID=$script:EntraSpec.tenantId;ENTRA_CLIENT_ID=$credentials.prod.clientId;ENTRA_CLIENT_SECRET=$credentials.prod.clientSecret;AUTH_ENCRYPTION_KEY=$credentials.prod.encryptionKey}
  if ($Mode -ne 'Verify') {
    foreach ($key in $authKeys) { $properties[$key]=$prod[$key] }
    $response=Invoke-BoardRest 'PUT' ('https://management.azure.com'+$script:EntraSite+'/config/appsettings?api-version=2024-11-01') $armToken @{properties=$properties}
    $response=$null
  }
  $verified=Get-EntraSettings $armToken
  foreach ($key in $authKeys) { if ($verified.properties.$key -cne $prod[$key]) { throw 'ENTRA_SETTINGS_READBACK_MISMATCH' } }
  foreach ($key in $before.Keys) { if ($key -notin $authKeys -and $verified.properties.$key -cne $before[$key]) { throw 'ENTRA_UNRELATED_SETTING_CHANGED' } }
  $local=@{AUTH_MODE=$desiredMode;ENTRA_TENANT_ID=$script:EntraSpec.tenantId;ENTRA_CLIENT_ID=$credentials.local.clientId;ENTRA_CLIENT_SECRET=$credentials.local.clientSecret;AUTH_ENCRYPTION_KEY=$credentials.local.encryptionKey}
  if ($Mode -ne 'Verify') {
    $envPath=Join-Path $script:EntraRepo 'board/.env.local'
    $raw=[IO.File]::ReadAllText($envPath)
    $newline=if($raw.Contains(([char]13).ToString()+[char]10)){([char]13).ToString()+[char]10}else{([char]10).ToString()}
    $lines=@($raw -split '\r?\n' | Where-Object { $_ -notmatch '^\s*(AUTH_MODE|ENTRA_TENANT_ID|ENTRA_CLIENT_ID|ENTRA_CLIENT_SECRET|AUTH_ENCRYPTION_KEY)\s*=' })
    foreach ($key in $authKeys) {
      $value=[string]$local[$key]
      $delimiter=@("'",'"',([char]96).ToString()) | Where-Object { !$value.Contains($_) } | Select-Object -First 1
      if (!$delimiter -or $value -match '[\r\n]') { throw 'ENTRA_DOTENV_VALUE_UNREPRESENTABLE' }
      $quoted=$delimiter+$value.Replace('$','\$')+$delimiter
      $lines+=($key+'='+$quoted)
    }
    [IO.File]::WriteAllText($envPath,($lines -join $newline)+$newline,[Text.UTF8Encoding]::new($false))
  }
  Test-LocalRoundtrip $local
  Write-Output ('ENTRA_SETTINGS_VERIFIED '+$desiredMode+' UNRELATED_SETTINGS_PRESERVED')
} finally { $credentials=$null;$armToken=$null;$document=$null;$properties=$null;$before=$null;$prod=$null;$local=$null;$verified=$null }
