$ErrorActionPreference = 'Stop'
$script:EntraRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$script:EntraSpec = Get-Content -LiteralPath (Join-Path $script:EntraRepo 'infra/azure/entra.parameters.example.json') -Raw | ConvertFrom-Json -AsHashtable
$script:EntraMetaPath = Join-Path $script:EntraRepo 'board/.deploy/entra-resources.json'
$script:EntraSecretPath = Join-Path $script:EntraRepo 'board/.deploy/entra-login.dpapi'
$script:EntraSite = '/subscriptions/7b1417d8-833d-4ba9-a5cd-d27c91a28b83/resourceGroups/rg-vibe-board-prod/providers/Microsoft.Web/sites/app-vibe-board-prod-7b1417'
function Get-BoardAzJson([string[]]$Arguments) {
  $captured = & az @Arguments --only-show-errors -o json 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'AZURE_COMMAND_FAILED_DETAILS_SUPPRESSED' }
  return (($captured -join [Environment]::NewLine) | ConvertFrom-Json -AsHashtable)
}
function Assert-EntraOperator {
  $account = Get-BoardAzJson @('account','show')
  if ($account.id -ne $script:EntraSpec.subscriptionId -or $account.tenantId -ne $script:EntraSpec.tenantId) { throw 'ENTRA_ACCOUNT_SCOPE_MISMATCH' }
  $operator = Get-BoardAzJson @('ad','signed-in-user','show','--query','{id:id}')
  if ($operator.id -ne $script:EntraSpec.administratorObjectId) { throw 'ENTRA_OPERATOR_MISMATCH' }
}
function Get-BoardAccessToken([string]$Resource) {
  $captured = & az account get-access-token --resource $Resource --query accessToken -o tsv --only-show-errors 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'ENTRA_TOKEN_ACQUISITION_FAILED' }
  return ($captured -join '').Trim()
}
function Invoke-BoardRest([string]$Method,[string]$Uri,[string]$Token,$Payload=$null) {
  if ($Uri -notmatch '^https://(graph\.microsoft\.com/v1\.0/|management\.azure\.com/subscriptions/7b1417d8-833d-4ba9-a5cd-d27c91a28b83/)') { throw 'ENTRA_REST_SCOPE_REJECTED' }
  $options = @{ Method=$Method; Uri=$Uri; Headers=@{Authorization=('Bearer '+$Token)}; TimeoutSec=60; ErrorAction='Stop' }
  if ($null -ne $Payload) { $options.ContentType='application/json'; $options.Body=($Payload | ConvertTo-Json -Depth 25 -Compress) }
  try { return Invoke-RestMethod @options }
  catch {
    $status = 0; try { $status = [int]$_.Exception.Response.StatusCode } catch {}
    $code = 'REQUEST_FAILED'
    try { $candidate = ($_.ErrorDetails.Message | ConvertFrom-Json).error.code; if ($candidate -cmatch '^[A-Za-z_][A-Za-z0-9_.-]{0,70}$') { $code=$candidate } } catch {}
    throw ('ENTRA_REST_'+$status+'_'+$code)
  }
}
function Read-EntraMetadata {
  if (!(Test-Path -LiteralPath $script:EntraMetaPath)) { return @{tenantId=$script:EntraSpec.tenantId; administratorObjectId=$script:EntraSpec.administratorObjectId; roleId=$script:EntraSpec.role.id} }
  $metadata = Get-Content -LiteralPath $script:EntraMetaPath -Raw | ConvertFrom-Json -AsHashtable
  if ($metadata.tenantId -ne $script:EntraSpec.tenantId -or $metadata.administratorObjectId -ne $script:EntraSpec.administratorObjectId) { throw 'ENTRA_METADATA_SCOPE_MISMATCH' }
  return $metadata
}
function Save-EntraMetadata($Metadata) {
  [void][IO.Directory]::CreateDirectory((Split-Path $script:EntraMetaPath))
  [IO.File]::WriteAllText($script:EntraMetaPath,($Metadata | ConvertTo-Json -Depth 15),[Text.UTF8Encoding]::new($false))
}
function Read-EntraSecrets {
  if (!(Test-Path -LiteralPath $script:EntraSecretPath)) { return @{} }
  try { $secure=(Get-Content -LiteralPath $script:EntraSecretPath -Raw).Trim() | ConvertTo-SecureString; return ([Net.NetworkCredential]::new('',$secure).Password | ConvertFrom-Json -AsHashtable) }
  catch { throw 'ENTRA_DPAPI_READ_FAILED' }
}
function Save-EntraSecrets($Secrets) {
  [void][IO.Directory]::CreateDirectory((Split-Path $script:EntraSecretPath))
  $encrypted=($Secrets | ConvertTo-Json -Depth 10 -Compress) | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString
  [IO.File]::WriteAllText($script:EntraSecretPath,$encrypted,[Text.UTF8Encoding]::new($false))
}
function Get-EntraSettings([string]$Token) {
  return Invoke-BoardRest 'POST' ('https://management.azure.com'+$script:EntraSite+'/config/appsettings/list?api-version=2024-11-01') $Token
}
function Test-BoardAdministratorAssignments($Assignments) {
  # Entra consent may add Default Access (zero role); it never grants Board.Admin.
  $custom=@($Assignments | Where-Object { $_.appRoleId -ne '00000000-0000-0000-0000-000000000000' })
  return ($custom.Count -eq 1 -and $custom[0].principalId -eq $script:EntraSpec.administratorObjectId -and
    $custom[0].principalType -eq 'User' -and $custom[0].appRoleId -eq $script:EntraSpec.role.id)
}
