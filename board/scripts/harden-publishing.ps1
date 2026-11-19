param([ValidateSet('Inspect','Apply','Verify')][string]$Mode='Inspect')
. (Join-Path $PSScriptRoot 'entra-common.ps1')
. (Join-Path $PSScriptRoot 'publishing-policy.ps1')
Assert-EntraOperator
$arm=Get-BoardAccessToken 'https://management.azure.com/'
try {
  $base='https://management.azure.com'+$script:EntraSite+'/basicPublishingCredentialsPolicies/'
  $read={param($name) Invoke-BoardRest 'GET' ($base+$name+'?api-version=2024-11-01') $arm}
  $disable={param($name) Invoke-BoardRest 'PUT' ($base+$name+'?api-version=2024-11-01') $arm @{properties=@{allow=$false}}}
  $result=@(Invoke-PublishingHardening -Mode $Mode -ReadPolicy $read -DisablePolicy $disable)
  $result | ConvertTo-Json -Compress
  if($Mode-ne'Inspect'){Write-Output 'PUBLISHING_BASIC_AUTH_DISABLED_VERIFIED'}
} finally { $arm=$null;$result=$null }
