. (Join-Path $PSScriptRoot 'entra-common.ps1')
Assert-EntraOperator
if (Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue) { throw 'ENTRA_PREFLIGHT_PORT_3200_IN_USE' }
$credentials=Read-EntraSecrets
try {
  if (!$credentials.local) { throw 'ENTRA_LOCAL_CREDENTIAL_MISSING' }
  $credentials.local | ConvertTo-Json -Compress | & node (Join-Path $PSScriptRoot '../node_modules/tsx/dist/cli.mjs') (Join-Path $PSScriptRoot 'verify-entra-registration.ts')
  if ($LASTEXITCODE -ne 0) { throw 'ENTRA_REAL_PREFLIGHT_INCOMPLETE' }
} finally { $credentials=$null }
