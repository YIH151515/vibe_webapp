param([Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$Commit)
$ErrorActionPreference = 'Stop'
$hostName = & az webapp show --resource-group rg-vibe-board-prod --name app-vibe-board-prod-7b1417 --query defaultHostName --output tsv --only-show-errors
if ($LASTEXITCODE -ne 0 -or !$hostName) { throw 'Unable to obtain deployed application host.' }
$protected = (Get-Content (Join-Path $env:LOCALAPPDATA 'VibeBoard/azure-prod.dpapi') -Raw).Trim() | ConvertTo-SecureString
$credential = [Net.NetworkCredential]::new('', $protected).Password | ConvertFrom-Json
try {
  # Native stdin only: no credential in command arguments, environment or output.
  $credential.adminPassword | & node (Join-Path $PSScriptRoot '../node_modules/tsx/dist/cli.mjs') (Join-Path $PSScriptRoot 'verify-live.ts') --url ('https://'+$hostName.Trim()) --commit $Commit --qa-writes
  if ($LASTEXITCODE -ne 0) { throw 'Live verification failed; inspect safe diagnostic output.' }
} finally { $credential = $null; $protected = $null }
