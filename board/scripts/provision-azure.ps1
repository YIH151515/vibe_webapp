param([ValidateSet('Validate','WhatIf','Apply','Verify')][string]$Mode = 'Validate')
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$template = Join-Path $repo 'infra/azure/main.bicep'
$subscription = '7b1417d8-833d-4ba9-a5cd-d27c91a28b83'
$rg = 'rg-vibe-board-prod'
$vault = Join-Path $env:LOCALAPPDATA 'VibeBoard'
$secretFile = Join-Path $vault 'azure-prod.dpapi'

function Invoke-BoardAz([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments) {
  $result = & az @Arguments --only-show-errors 2>&1
  if ($LASTEXITCODE -ne 0) { throw ('Azure operation failed: ' + ($Arguments[0..([Math]::Min(2,$Arguments.Length-1))] -join ' ') + '. Detailed output suppressed.') }
  return ($result -join "`n")
}
function Read-BoardSecrets {
  if (!(Test-Path -LiteralPath $secretFile)) {
    New-Item -ItemType Directory -Path $vault -Force | Out-Null
    & icacls $vault /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot protect credential directory.' }
    function New-BoardSecret { return [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant() }
    $admin = 'Aa1!' + (New-BoardSecret)
    $hash = $admin | & node (Join-Path $repo 'board/node_modules/tsx/dist/cli.mjs') (Join-Path $PSScriptRoot 'admin-password.ts')
    if ($LASTEXITCODE -ne 0 -or $hash -notmatch '^scrypt\$') { throw 'Cannot generate administrator hash.' }
    $value = @{
      subscriptionId=$subscription; sqlAdminPassword=('Aa1!'+(New-BoardSecret)); sqlAppPassword=('Aa1!'+(New-BoardSecret))
      adminPassword=$admin; adminPasswordHash=$hash; sessionSecret=(New-BoardSecret); rateKeySecret=(New-BoardSecret)
    } | ConvertTo-Json -Compress
    $value | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $secretFile
  }
  $secure = (Get-Content -LiteralPath $secretFile -Raw).Trim() | ConvertTo-SecureString
  $secrets = [Net.NetworkCredential]::new('', $secure).Password | ConvertFrom-Json -AsHashtable
  if ($secrets.subscriptionId -ne $subscription) { throw 'Credential subscription mismatch.' }
  return $secrets
}
function Write-BoardLocalEnvironment($secrets, $outputs, [string]$ip) {
  $path = Join-Path $repo 'board/.env.local'
  $values = [ordered]@{
    SQL_SERVER=$outputs.sqlFqdn.value; SQL_DATABASE=$outputs.databaseName.value; SQL_USER='board_app'; SQL_PASSWORD=$secrets.sqlAppPassword
    SQL_MIGRATION_USER='board_operator'; SQL_MIGRATION_PASSWORD=$secrets.sqlAdminPassword
    APP_ORIGIN='http://127.0.0.1:3000'; REQUEST_IP_MODE='local'; LOCAL_CLIENT_IP=$ip
    ADMIN_PASSWORD_HASH=$secrets.adminPasswordHash; ADMIN_SESSION_SECRET=$secrets.sessionSecret; RATE_LIMIT_KEY_SECRET=$secrets.rateKeySecret
  }
  $lines = if (Test-Path -LiteralPath $path) { @(Get-Content -LiteralPath $path) } else { @() }
  $kept = @($lines | Where-Object { $_ -notmatch '^\s*(SQL_[A-Z_]+|APP_ORIGIN|REQUEST_IP_MODE|LOCAL_CLIENT_IP|ADMIN_[A-Z_]+|RATE_LIMIT_[A-Z_]+|APP_TEST_MODE)\s*=' })
  # Next expands dollar references even inside parsed dotenv values.
  foreach ($entry in $values.GetEnumerator()) { $kept += $entry.Key + "='" + ([string]$entry.Value).Replace('$','\$') + "'" }
  [IO.File]::WriteAllLines($path, $kept, [Text.UTF8Encoding]::new($false))
}

$account = Invoke-BoardAz @('account','show','-o','json') | ConvertFrom-Json
if ($account.id -ne $subscription) { throw 'Active Azure subscription differs from approved DEX subscription.' }
$names = (Get-Content (Join-Path $repo 'infra/azure/parameters.example.json') -Raw | ConvertFrom-Json -AsHashtable).parameters.names.value
$exists = (Invoke-BoardAz @('group','exists','--name',$rg,'-o','tsv')).Trim() -eq 'true'
if ($exists) {
  $group = Invoke-BoardAz @('group','show','--name',$rg,'-o','json') | ConvertFrom-Json
  if ($group.tags.project -ne 'vibe-board' -or $group.tags.managedBy -ne 'vibeweb-bicep') { throw 'Existing group is not owned by this deployment.' }
} else {
  Invoke-BoardAz @('group','create','--name',$rg,'--location','koreacentral','--tags','project=vibe-board','managedBy=vibeweb-bicep','environment=production','-o','none') | Out-Null
}
$secrets = Read-BoardSecrets
$ip = (Invoke-RestMethod 'https://api.ipify.org').Trim()
$parsedIp = $null
if (![Net.IPAddress]::TryParse($ip,[ref]$parsedIp) -or $parsedIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $ip -eq '0.0.0.0') { throw 'A public IPv4 address is required.' }
$parameters = @{ names=@{value=$names}; localPublicIp=@{value=$ip} }
foreach ($key in @('sqlAdminPassword','sqlAppPassword','adminPasswordHash','sessionSecret','rateKeySecret')) { $parameters[$key] = @{value=$secrets[$key]} }
if ($exists) {
  $apps = Invoke-BoardAz @('webapp','list','--resource-group',$rg,'--query','[].name','-o','json') | ConvertFrom-Json
  if ($names.webApp -in $apps) {
    $version = Invoke-BoardAz @('webapp','config','appsettings','list','--name',$names.webApp,'--resource-group',$rg,'--query',"[?name=='APP_VERSION'].value | [0]",'-o','tsv')
    if ($version) { $parameters.appVersion = @{value=$version.Trim()} }
    $imageSettings=Invoke-BoardAz @('webapp','config','appsettings','list','--name',$names.webApp,'--resource-group',$rg,'--query',"[?starts_with(name,'STORAGE_') || name=='EDITOR_FEATURE_ENABLED' || name=='MEDIA_CLEANUP_ENABLED']",'-o','json') | ConvertFrom-Json
    $imageValues=@{}
    foreach($setting in $imageSettings){$imageValues[$setting.name]=[string]$setting.value}
    if($imageValues['STORAGE_BLOB_SERVICE_URL']) {
      if($imageValues['STORAGE_BLOB_SERVICE_URL'] -ne 'https://stvibeboardimg7b1417.blob.core.windows.net' -or
        $imageValues['STORAGE_AUTH_MODE'] -ne 'managed-identity' -or $imageValues['STORAGE_CONTAINER'] -ne 'board-images'){throw 'Unexpected existing image configuration; refusing overwrite.'}
      $parameters.imageStorageAccountName=@{value='stvibeboardimg7b1417'}
    }
    foreach($pair in @(@('EDITOR_FEATURE_ENABLED','editorFeatureEnabled'),@('MEDIA_CLEANUP_ENABLED','mediaCleanupEnabled'))) {
      $value=$imageValues[$pair[0]]
      if($null -ne $value -and $value -notin @('0','1')){throw 'Invalid existing image flag.'}
      $parameters[$pair[1]]=@{value=($value -eq '1')}
    }
    $existingApp=Invoke-BoardAz @('webapp','show','--name',$names.webApp,'--resource-group',$rg,'--query','identity','-o','json') | ConvertFrom-Json
    if($existingApp.userAssignedIdentities) {
      $preserved=@{}
      foreach($identityId in $existingApp.userAssignedIdentities.PSObject.Properties.Name){$preserved[$identityId]=@{}}
      $parameters.existingAppUserAssignedIdentities=@{value=$preserved}
    }
  }
}
$temp = Join-Path $vault ([guid]::NewGuid().ToString('N')+'.parameters.json')
try {
  @{ '$schema'='https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'; contentVersion='1.0.0.0'; parameters=$parameters } | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temp
  $common = @('--resource-group',$rg,'--template-file',$template,'--parameters',('@'+$temp))
  switch ($Mode) {
    'Validate' { Invoke-BoardAz (@('deployment','group','validate')+$common+@('-o','none')) | Out-Null; Write-Output 'Azure template validation passed.' }
    'WhatIf' {
      $diff = Invoke-BoardAz (@('deployment','group','what-if')+$common+@('--no-pretty-print','-o','json')) | ConvertFrom-Json
      if (@($diff.changes | Where-Object changeType -eq 'Delete').Count) { throw 'Unexpected resource deletion in what-if.' }
      $diff.changes | Select-Object changeType,resourceId | Format-Table -AutoSize
    }
    'Apply' {
      $deployment = Invoke-BoardAz (@('deployment','group','create','--name','board-production','--mode','Incremental')+$common+@('-o','json')) | ConvertFrom-Json
      $outputs = $deployment.properties.outputs
      Write-BoardLocalEnvironment $secrets $outputs $ip
      New-Item -ItemType Directory -Path (Join-Path $repo 'board/.deploy') -Force | Out-Null
      $outputs | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $repo 'board/.deploy/azure-outputs.json')
      Write-Output ('Azure resources applied. HTTPS host: '+$outputs.defaultHostName.value)
    }
    'Verify' {
      $plan = Invoke-BoardAz @('appservice','plan','show','--name',$names.plan,'--resource-group',$rg,'-o','json') | ConvertFrom-Json
      $db = Invoke-BoardAz @('sql','db','show','--server',$names.sqlServer,'--name',$names.database,'--resource-group',$rg,'-o','json') | ConvertFrom-Json
      $app = Invoke-BoardAz @('webapp','show','--name',$names.webApp,'--resource-group',$rg,'-o','json') | ConvertFrom-Json
      if ($plan.sku.name -ne 'B1' -or $plan.sku.capacity -ne 1 -or !($plan.reserved -or $plan.properties.reserved) -or $db.sku.name -ne 'Basic' -or $db.maxSizeBytes -ne 2147483648 -or $db.currentBackupStorageRedundancy -ne 'Local' -or !$app.httpsOnly) { throw 'Resource sizing/security differs from approved configuration.' }
      $rules = Invoke-BoardAz @('sql','server','firewall-rule','list','--server',$names.sqlServer,'--resource-group',$rg,'-o','json') | ConvertFrom-Json
      foreach ($rule in $rules) { if ($rule.startIpAddress -ne $rule.endIpAddress -or $rule.startIpAddress -eq '0.0.0.0') { throw 'Overbroad SQL firewall rule.' } }
      $config = Invoke-BoardAz @('webapp','config','show','--name',$names.webApp,'--resource-group',$rg,'-o','json') | ConvertFrom-Json
      if ($config.linuxFxVersion -ne 'NODE|24-lts' -or !$config.alwaysOn -or $config.appCommandLine -ne 'node server.js' -or $config.ftpsState -ne 'Disabled') { throw 'Runtime configuration mismatch.' }
      $keys = Invoke-BoardAz @('webapp','config','appsettings','list','--name',$names.webApp,'--resource-group',$rg,'--query','[].name','-o','json') | ConvertFrom-Json
      if (@($keys | Where-Object { $_ -match '^SQL_MIGRATION_|^APP_TEST_MODE$|^LOCAL_CLIENT_IP$' }).Count) { throw 'Operator/test settings present in production.' }
      foreach ($key in @('SQL_SERVER','SQL_DATABASE','SQL_USER','SQL_PASSWORD','APP_ORIGIN','REQUEST_IP_MODE','ADMIN_PASSWORD_HASH','ADMIN_SESSION_SECRET','RATE_LIMIT_KEY_SECRET','HOSTNAME','SCM_DO_BUILD_DURING_DEPLOYMENT','ENABLE_ORYX_BUILD')) {
        if ($key -notin $keys) { throw ('Missing production setting: '+$key) }
      }
      $identity = Invoke-BoardAz @('identity','show','--name',$names.deploymentIdentity,'--resource-group',$rg,'-o','json') | ConvertFrom-Json
      $roles = Invoke-BoardAz @('role','assignment','list','--assignee-object-id',$identity.principalId,'--scope',$app.id,'--query','[].roleDefinitionName','-o','json') | ConvertFrom-Json
      if ('Website Contributor' -notin $roles) { throw 'App-scoped deployment role missing.' }
      $federation = Invoke-BoardAz @('identity','federated-credential','show','--identity-name',$names.deploymentIdentity,'--resource-group',$rg,'--name','github-main','-o','json') | ConvertFrom-Json
      if ($federation.subject -ne 'repo:YIH151515@355682187/vibe_webapp@1456296194:ref:refs/heads/main' -or $federation.issuer -ne 'https://token.actions.githubusercontent.com') { throw 'OIDC federation mismatch.' }
      Write-Output 'Verified B1 Linux x1, SQL Basic 2GB Local backup, exact-IP firewall, Node24/HTTPS and setting names.'
    }
  }
} finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force } }
