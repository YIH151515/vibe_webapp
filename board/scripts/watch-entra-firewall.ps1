param([Parameter(Mandatory=$true)][string]$Ip,
  [Parameter(Mandatory=$true)][ValidatePattern('^board-entra-temp-[a-f0-9]{32}$')][string]$RuleName,
  [Parameter(Mandatory=$true)][string]$CompletionFile)
. (Join-Path $PSScriptRoot 'entra-common.ps1')
Assert-EntraOperator
$parsed=$null
if(![Net.IPAddress]::TryParse($Ip,[ref]$parsed)-or$parsed.AddressFamily-ne[Net.Sockets.AddressFamily]::InterNetwork-or
  $Ip-match'^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'){throw 'ENTRA_PUBLIC_OPERATOR_IPV4_REQUIRED'}
$deployRoot=[IO.Path]::GetFullPath((Join-Path $script:EntraRepo 'board/.deploy'))+[IO.Path]::DirectorySeparatorChar
$finish=[IO.Path]::GetFullPath($CompletionFile)
if(!$finish.StartsWith($deployRoot,[StringComparison]::OrdinalIgnoreCase)-or(Test-Path -LiteralPath $finish)){throw 'ENTRA_FIREWALL_SIGNAL_PATH_REJECTED'}
$uri='https://management.azure.com/subscriptions/7b1417d8-833d-4ba9-a5cd-d27c91a28b83/resourceGroups/rg-vibe-board-prod/providers/Microsoft.Sql/servers/sql-vibe-board-7b1417/firewallRules/'+$RuleName+'?api-version=2023-08-01'
$created=$false
try {
  $arm=Get-BoardAccessToken 'https://management.azure.com/'
  $existing=$false
  try{$existingRule=Invoke-BoardRest 'GET' $uri $arm;$existing=$true}catch{if($_.Exception.Message-notmatch'^ENTRA_REST_404_'){throw}}
  if($existing){throw 'ENTRA_TEMP_FIREWALL_NAME_COLLISION'}
  $response=Invoke-BoardRest 'PUT' $uri $arm @{properties=@{startIpAddress=$Ip;endIpAddress=$Ip}}
  $created=$true
  $verified=Invoke-BoardRest 'GET' $uri $arm
  if($verified.properties.startIpAddress-ne$Ip-or$verified.properties.endIpAddress-ne$Ip){throw 'ENTRA_TEMP_FIREWALL_READBACK_MISMATCH'}
  $expires=[DateTimeOffset]::UtcNow.AddMinutes(60)
  @{ruleName=$RuleName;ip=$Ip;expiresAt=$expires.ToString('o');completionFile=$finish;state='active'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $deployRoot 'entra-temp-firewall.json') -Encoding utf8
  Write-Output ('ENTRA_TEMP_FIREWALL_ACTIVE '+$RuleName+' MAX_60_MINUTES')
  $arm=$null;$response=$null;$verified=$null
  while([DateTimeOffset]::UtcNow-lt$expires-and!(Test-Path -LiteralPath $finish)){Start-Sleep -Seconds 3}
} finally {
  if($created){
    try{
      $arm=Get-BoardAccessToken 'https://management.azure.com/'
      $current=Invoke-BoardRest 'GET' $uri $arm
      if($current.name-ne$RuleName-or$current.properties.startIpAddress-ne$Ip-or$current.properties.endIpAddress-ne$Ip){throw 'ENTRA_TEMP_FIREWALL_OWNERSHIP_CHANGED'}
      $response=Invoke-BoardRest 'DELETE' $uri $arm
      $removed=$false
      for($attempt=0;$attempt-lt10;$attempt++){
        try{$remaining=Invoke-BoardRest 'GET' $uri $arm}catch{if($_.Exception.Message-match'^ENTRA_REST_404_'){$removed=$true;break};throw}
        Start-Sleep -Seconds 2
      }
      if(!$removed){throw 'ENTRA_TEMP_FIREWALL_DELETE_PENDING'}
      @{ruleName=$RuleName;state='removed'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $deployRoot 'entra-temp-firewall.json') -Encoding utf8
      Write-Output ('ENTRA_TEMP_FIREWALL_REMOVED '+$RuleName)
    }catch{Write-Output ('ENTRA_TEMP_FIREWALL_CLEANUP_REQUIRED '+$RuleName);throw 'ENTRA_TEMP_FIREWALL_CLEANUP_FAILED_DETAILS_SUPPRESSED'}
  }
  $arm=$null;$response=$null;$current=$null;$remaining=$null
}
