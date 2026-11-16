param([Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$Commit, [switch]$Disabled)
$ErrorActionPreference = 'Stop'
$protected = (Get-Content (Join-Path $env:LOCALAPPDATA 'VibeBoard/azure-prod.dpapi') -Raw).Trim() | ConvertTo-SecureString
$credential = [Net.NetworkCredential]::new('', $protected).Password | ConvertFrom-Json
try {
  $arguments = @((Join-Path $PSScriptRoot '../node_modules/tsx/dist/cli.mjs'), (Join-Path $PSScriptRoot 'verify-live-media.ts'), '--commit', $Commit)
  if ($Disabled) { $arguments += '--disabled' }
  $credential.adminPassword | & node @arguments
  if ($LASTEXITCODE -ne 0) { throw 'Live media verification failed. Only owned QA may be cleaned.' }
} finally { $credential = $null; $protected = $null }
