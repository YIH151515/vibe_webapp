param([Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$Commit, [switch]$Local)
$ErrorActionPreference = 'Stop'
$url = if ($Local) { 'http://127.0.0.1:3200' } else { 'https://app-vibe-board-prod-7b1417.azurewebsites.net' }
& node (Join-Path $PSScriptRoot '../node_modules/tsx/dist/cli.mjs') (Join-Path $PSScriptRoot 'verify-live-entra.ts') --url $url --commit $Commit --qa-writes
if ($LASTEXITCODE -ne 0) { throw 'Entra verification failed. Inspect safe check markers and own QA IDs.' }
