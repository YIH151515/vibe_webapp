param([string]$ResourceGroup='rg-vibe-board-prod',[string]$WebApp='app-vibe-board-prod-7b1417')
$ErrorActionPreference = 'Stop'
$vault = Join-Path $env:LOCALAPPDATA 'VibeBoard'
$secure = (Get-Content (Join-Path $vault 'azure-prod.dpapi') -Raw).Trim() | ConvertTo-SecureString
$secrets = [Net.NetworkCredential]::new('', $secure).Password | ConvertFrom-Json
$temp = Join-Path $vault ([guid]::NewGuid().ToString('N')+'.settings.json')
try {
  @{ SQL_PASSWORD=$secrets.sqlAppPassword; ADMIN_PASSWORD_HASH=$secrets.adminPasswordHash; ADMIN_SESSION_SECRET=$secrets.sessionSecret; RATE_LIMIT_KEY_SECRET=$secrets.rateKeySecret } | ConvertTo-Json | Set-Content -LiteralPath $temp
  $result = & az webapp config appsettings set --resource-group $ResourceGroup --name $WebApp --settings ('@'+$temp) --output none --only-show-errors 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'Secure settings update failed; output suppressed.' }
  Write-Output 'Runtime secrets updated without command-line values.'
} finally { Remove-Item -LiteralPath $temp -Force }
