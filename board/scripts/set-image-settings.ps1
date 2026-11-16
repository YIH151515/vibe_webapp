param([ValidateSet('Disabled','Enabled')][string]$Mode='Disabled')
$ErrorActionPreference='Stop'
$subscription='7b1417d8-833d-4ba9-a5cd-d27c91a28b83'
$active=(& az account show --query id -o tsv --only-show-errors).Trim()
if ($LASTEXITCODE -ne 0 -or $active -ne $subscription) { throw 'Approved subscription is not active.' }
$rg='rg-vibe-board-prod';$app='app-vibe-board-prod-7b1417';$url='https://stvibeboardimg7b1417.blob.core.windows.net'
if($Mode -eq 'Enabled') {
  $health=Invoke-RestMethod -Uri "https://$app.azurewebsites.net/api/health" -TimeoutSec 20
  $config=Invoke-RestMethod -Uri "https://$app.azurewebsites.net/api/editor-config" -TimeoutSec 20
  if($health.status -ne 'ok' -or $config.enabled -isnot [bool]){throw 'Deploy and verify the schema4-compatible runtime before enabling images.'}
}
$flag=if($Mode -eq 'Enabled'){'1'}else{'0'}
& az webapp config appsettings set --subscription $subscription -g $rg -n $app --settings STORAGE_AUTH_MODE=managed-identity "STORAGE_BLOB_SERVICE_URL=$url" STORAGE_CONTAINER=board-images "EDITOR_FEATURE_ENABLED=$flag" "MEDIA_CLEANUP_ENABLED=$flag" -o none --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'Nonsecret image settings update failed.' }
$path=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.env.local'))
if (Test-Path -LiteralPath $path) {
  # Preserve every unrelated byte/line, including escaped dollar signs in scrypt.
  $lines=[IO.File]::ReadAllLines($path)
  $kept=@($lines | Where-Object { $_ -notmatch '^\s*(STORAGE_AUTH_MODE|STORAGE_BLOB_SERVICE_URL|STORAGE_CONTAINER|EDITOR_FEATURE_ENABLED|MEDIA_CLEANUP_ENABLED)\s*=' })
  $kept+=@("STORAGE_AUTH_MODE='azure-cli'","STORAGE_BLOB_SERVICE_URL='$url'","STORAGE_CONTAINER='board-images'","EDITOR_FEATURE_ENABLED='0'","MEDIA_CLEANUP_ENABLED='0'")
  [IO.File]::WriteAllLines($path,$kept,[Text.UTF8Encoding]::new($false))
}
Write-Output "Nonsecret image settings applied ($Mode); local defaults remain disabled."
