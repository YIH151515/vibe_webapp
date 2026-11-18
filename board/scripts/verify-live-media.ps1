param([Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$Commit)
& (Join-Path $PSScriptRoot 'verify-live-entra.ps1') -Commit $Commit
if ($LASTEXITCODE -ne 0) { throw 'Entra verification failed.' }
