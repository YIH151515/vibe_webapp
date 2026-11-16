param([ValidateSet('Validate','WhatIf','Apply','Verify')][string]$Mode='Validate')
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$subscription='7b1417d8-833d-4ba9-a5cd-d27c91a28b83'
$rg='rg-vibe-board-prod'; $webApp='app-vibe-board-prod-7b1417'; $storage='stvibeboardimg7b1417'
$storageId="/subscriptions/$subscription/resourceGroups/$rg/providers/Microsoft.Storage/storageAccounts/$storage"
$containerId="$storageId/blobServices/default/containers/board-images"
$role='ba92f5b4-2d11-453d-a403-e96b0029c9fe'
function Invoke-ImagesAz([string[]]$Arguments) {
  # A simple forwarding function keeps native -o/-n flags out of PowerShell's
  # advanced-function common parameter binding (OutVariable/OutBuffer).
  $Arguments=@($Arguments)+@($args)
  $value=& az @Arguments --subscription $subscription --only-show-errors 2>&1
  if ($LASTEXITCODE -ne 0) {
    $code=[regex]::Match(($value -join ' '),'AuthorizationFailed|RoleAssignmentExists|PrincipalNotFound|ResourceNotFound|InvalidTemplateDeployment').Value
    throw "Image infrastructure operation failed: $($Arguments[0..([Math]::Min(2,$Arguments.Length-1))] -join ' ') $code"
  }
  return ($value -join "`n")
}
$account=(& az account show --query '{id:id,name:name}' -o json --only-show-errors) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $account.id -ne $subscription -or $account.name -ne 'DEX') { throw 'Approved DEX subscription is not active.' }
$group=Invoke-ImagesAz group show -n $rg -o json | ConvertFrom-Json
if ($group.location -ne 'koreacentral' -or $group.tags.project -ne 'vibe-board' -or $group.tags.managedBy -ne 'vibeweb-bicep') { throw 'Resource group ownership mismatch.' }
$app=Invoke-ImagesAz webapp show -g $rg -n $webApp -o json | ConvertFrom-Json
if ($app.tags.project -ne 'vibe-board' -or $app.tags.managedBy -ne 'vibeweb-bicep') { throw 'App ownership mismatch.' }
if ($Mode -eq 'Apply' -and !$app.identity.principalId) {
  Invoke-ImagesAz webapp identity assign -g $rg -n $webApp --identities '[system]' -o none | Out-Null
  $app=Invoke-ImagesAz webapp show -g $rg -n $webApp -o json | ConvertFrom-Json
}
if (!$app.identity.principalId) { throw 'Initialize the approved app system identity before Azure template validation; no resources changed.' }
$operator=(& az ad signed-in-user show --query id -o tsv --only-show-errors).Trim()
if ($LASTEXITCODE -ne 0 -or $operator -notmatch '^[a-fA-F0-9-]{36}$') { throw 'Cannot identify local operator.' }
$runtime=$app.identity.principalId
$existing=@(Invoke-ImagesAz storage account list -g $rg --query "[?name=='$storage']" -o json | ConvertFrom-Json)
if ($existing.Count) {
  $existing=$existing[0]
  if ($existing.tags.project -ne 'vibe-board' -or $existing.tags.managedBy -ne 'vibeweb-bicep' -or
      $existing.location -ne 'koreacentral' -or $existing.kind -ne 'StorageV2' -or $existing.sku.name -ne 'Standard_LRS') { throw 'Existing storage is not the approved owned resource.' }
} elseif ($Mode -ne 'Verify') {
  $available=Invoke-ImagesAz storage account check-name -n $storage --query nameAvailable -o tsv
  if ($available.Trim() -ne 'true') { throw 'Storage name belongs to another resource; refusing reuse.' }
} else { throw 'Image storage has not been provisioned.' }
$template=Join-Path $repo 'infra/azure/images.bicep'
$temp=Join-Path $repo 'board/.deploy/images.parameters.json'
New-Item -ItemType Directory -Force -Path (Split-Path $temp) | Out-Null
@{ '$schema'='https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#';contentVersion='1.0.0.0';parameters=@{
  runtimePrincipalId=@{value=$runtime};operatorPrincipalId=@{value=$operator};storageAccountName=@{value=$storage};location=@{value='koreacentral'}
}} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temp -Encoding utf8
$common=@('--resource-group',$rg,'--template-file',$template,'--parameters',('@'+$temp))
function Assert-ImagesWhatIf {
  $diff=Invoke-ImagesAz (@('deployment','group','what-if')+$common+@('--no-pretty-print','-o','json')) | ConvertFrom-Json
  foreach ($change in $diff.changes) {
    if ($change.changeType -eq 'Delete' -or
      (!$change.resourceId.StartsWith($storageId,[StringComparison]::OrdinalIgnoreCase) -and $change.changeType -notin @('Ignore','NoChange'))) { throw 'What-if includes deletion or unrelated resource modification.' }
  }
  $diff.changes | Select-Object changeType,resourceId | Format-Table -AutoSize
}
switch ($Mode) {
  'Validate' {
    Invoke-ImagesAz (@('deployment','group','validate')+$common+@('-o','none')) | Out-Null
    Write-Output 'Image infrastructure template validated.'
  }
  'WhatIf' { Assert-ImagesWhatIf }
  'Apply' {
    Assert-ImagesWhatIf
    $deployment=Invoke-ImagesAz (@('deployment','group','create','--name','board-images','--mode','Incremental')+$common+@('-o','json')) | ConvertFrom-Json
    $deployment.properties.outputs | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $repo 'board/.deploy/images-outputs.json') -Encoding utf8
    Write-Output 'Owned private image storage and container-scoped data roles applied.'
  }
  'Verify' {
    $storageAccount=Invoke-ImagesAz storage account show -g $rg -n $storage -o json | ConvertFrom-Json
    $service=Invoke-ImagesAz storage account blob-service-properties show -g $rg -n $storage -o json | ConvertFrom-Json
    $container=Invoke-ImagesAz rest --method get --url ("https://management.azure.com${containerId}?api-version=2023-05-01") -o json | ConvertFrom-Json
    if (!$storageAccount.enableHttpsTrafficOnly -or $storageAccount.minimumTlsVersion -ne 'TLS1_2' -or
      $storageAccount.allowBlobPublicAccess -ne $false -or $storageAccount.allowSharedKeyAccess -ne $false -or
      $storageAccount.accessTier -ne 'Hot' -or !$storageAccount.encryption.services.blob.enabled -or
      $service.deleteRetentionPolicy.days -ne 7 -or !$service.deleteRetentionPolicy.enabled -or
      $service.containerDeleteRetentionPolicy.days -ne 7 -or !$service.containerDeleteRetentionPolicy.enabled -or $service.isVersioningEnabled -or
      ($container.properties.publicAccess -and $container.properties.publicAccess -ne 'None')) { throw 'Private storage/TLS/encryption/retention policy mismatch.' }
    $assignments=Invoke-ImagesAz role assignment list --scope $containerId --fill-principal-name false --fill-role-definition-name false -o json | ConvertFrom-Json
    foreach ($principal in @($runtime,$operator)) {
      if (!@($assignments | Where-Object { $_.principalId -eq $principal -and $_.scope -eq $containerId -and $_.roleDefinitionId.EndsWith('/'+$role) }).Count) { throw 'Exact container-scoped data role missing.' }
    }
    $plan=Invoke-ImagesAz appservice plan show -g $rg -n asp-vibe-board-prod -o json | ConvertFrom-Json
    $database=Invoke-ImagesAz sql db show -g $rg -s sql-vibe-board-7b1417 -n dbboardprod -o json | ConvertFrom-Json
    if ($plan.sku.name -ne 'B1' -or $plan.sku.capacity -ne 1 -or !($plan.reserved -or $plan.properties.reserved) -or $database.sku.name -ne 'Basic' -or $database.maxSizeBytes -ne 2147483648) { throw 'Existing app/SQL sizing changed.' }
    $federation=Invoke-ImagesAz identity federated-credential show -g $rg --identity-name id-vibe-board-github -n github-main -o json | ConvertFrom-Json
    if ($federation.subject -ne 'repo:YIH151515@355682187/vibe_webapp@1456296194:ref:refs/heads/main') { throw 'Deployment OIDC subject changed.' }
    $githubIdentity=Invoke-ImagesAz identity show -g $rg -n id-vibe-board-github --query id -o tsv
    if ($app.identity.userAssignedIdentities -and $app.identity.userAssignedIdentities.PSObject.Properties.Name -contains $githubIdentity.Trim()) { throw 'Deployment identity must not be attached to runtime.' }
    [ordered]@{storageAccount=$storage;blobServiceUrl="https://$storage.blob.core.windows.net";container='board-images';runtimePrincipalId=$runtime;operatorPrincipalId=$operator;containerScope=$containerId;policy='private/HTTPS/TLS1_2/SharedKeyOff/soft-delete7/versioningOff';existingSizing='B1 Linux x1 / SQL Basic 2GB'} | ConvertTo-Json
  }
}
