param([ValidateSet('Inspect','Apply','Verify')][string]$Mode='Inspect')
. (Join-Path $PSScriptRoot 'entra-common.ps1')
Assert-EntraOperator
$graphToken = Get-BoardAccessToken 'https://graph.microsoft.com/'
$metadata = Read-EntraMetadata
$credentials = Read-EntraSecrets
$failures = @()
try {
  $operator = Invoke-BoardRest 'GET' 'https://graph.microsoft.com/v1.0/me?$select=id,userType' $graphToken
  if ($operator.id -ne $script:EntraSpec.administratorObjectId -or $operator.userType -ne 'Member') { throw 'ENTRA_OPERATOR_MEMBER_REQUIRED' }
  foreach ($environment in @('prod','local')) {
    try {
      $definition = $script:EntraSpec.clients[$environment]
      $filter = [Uri]::EscapeDataString("displayName eq '"+$definition.displayName+"'")
      $found = Invoke-BoardRest 'GET' ('https://graph.microsoft.com/v1.0/applications?$filter='+$filter+'&$select=id,appId,displayName') $graphToken
      if ($Mode -eq 'Inspect') {
        [pscustomobject]@{environment=$environment;registered=@($found.value | Select-Object id,appId,displayName);recorded=$metadata[$environment]} | ConvertTo-Json -Depth 10
        continue
      }
      $record = $metadata[$environment]
      if (!$record) {
        if ($Mode -ne 'Apply') { throw 'ENTRA_REGISTRATION_MISSING' }
        if (@($found.value).Count -ne 0) { throw 'ENTRA_NAME_COLLISION_REQUIRES_ID_REVIEW' }
        $body = @{
          displayName=$definition.displayName; signInAudience='AzureADMyOrg'; isFallbackPublicClient=$false
          web=@{redirectUris=@($definition.redirectUris);implicitGrantSettings=@{enableIdTokenIssuance=$false;enableAccessTokenIssuance=$false}}
          optionalClaims=@{idToken=@(@{name='acct';source=$null;essential=$true;additionalProperties=@()})}
          appRoles=@(@{id=$script:EntraSpec.role.id;allowedMemberTypes=@('User');displayName='Board administrator';description='Delete board posts as administrator';isEnabled=$true;value='Board.Admin'})
          requiredResourceAccess=@()
          'owners@odata.bind'=@('https://graph.microsoft.com/v1.0/users/'+$script:EntraSpec.administratorObjectId)
        }
        $application = Invoke-BoardRest 'POST' 'https://graph.microsoft.com/v1.0/applications' $graphToken $body
        $record = @{objectId=$application.id;clientId=$application.appId;displayName=$definition.displayName;redirectUris=@($definition.redirectUris)}
        $metadata[$environment]=$record
        Save-EntraMetadata $metadata
      }
      if ($record.objectId -notmatch '^[a-fA-F0-9-]{36}$' -or $record.clientId -notmatch '^[a-fA-F0-9-]{36}$') { throw 'ENTRA_RECORDED_ID_INVALID' }
      $appUrl = 'https://graph.microsoft.com/v1.0/applications/'+$record.objectId
      $application = Invoke-BoardRest 'GET' $appUrl $graphToken
      $owners = Invoke-BoardRest 'GET' ($appUrl+'/owners?$select=id') $graphToken
      if (@($owners.value).Count -ne 1 -or $owners.value[0].id -ne $script:EntraSpec.administratorObjectId) { throw 'ENTRA_OWNER_MISMATCH' }
      $acct = @($application.optionalClaims.idToken | Where-Object name -eq 'acct')
      $role = @($application.appRoles)
      if ($application.appId -ne $record.clientId -or $application.displayName -ne $definition.displayName -or $application.signInAudience -ne 'AzureADMyOrg' -or
          $application.isFallbackPublicClient -or $application.web.implicitGrantSettings.enableIdTokenIssuance -or $application.web.implicitGrantSettings.enableAccessTokenIssuance -or
          (@($application.web.redirectUris | Sort-Object) -join '|') -cne (@($definition.redirectUris | Sort-Object) -join '|') -or
          $acct.Count -ne 1 -or !$acct[0].essential -or $role.Count -ne 1 -or $role[0].id -ne $script:EntraSpec.role.id -or $role[0].value -ne 'Board.Admin' -or
          !$role[0].isEnabled -or (@($role[0].allowedMemberTypes) -join '|') -ne 'User' -or @($application.requiredResourceAccess).Count -ne 0) { throw 'ENTRA_APPLICATION_SPEC_MISMATCH' }
      if (!$record.servicePrincipalId) {
        if ($Mode -ne 'Apply') { throw 'ENTRA_SERVICE_PRINCIPAL_MISSING' }
        $principals = Invoke-BoardRest 'GET' ('https://graph.microsoft.com/v1.0/servicePrincipals?$filter='+[Uri]::EscapeDataString("appId eq '"+$record.clientId+"'")) $graphToken
        if (@($principals.value).Count -gt 1) { throw 'ENTRA_SERVICE_PRINCIPAL_COLLISION' }
        $sp = if (@($principals.value).Count -eq 1) { $principals.value[0] } else { Invoke-BoardRest 'POST' 'https://graph.microsoft.com/v1.0/servicePrincipals' $graphToken @{appId=$record.clientId;appRoleAssignmentRequired=$false} }
        $record.servicePrincipalId=$sp.id
        Save-EntraMetadata $metadata
      }
      $spUrl='https://graph.microsoft.com/v1.0/servicePrincipals/'+$record.servicePrincipalId
      $sp=Invoke-BoardRest 'GET' $spUrl $graphToken
      if ($sp.appId -ne $record.clientId -or $sp.appOwnerOrganizationId -ne $script:EntraSpec.tenantId -or $sp.appRoleAssignmentRequired) { throw 'ENTRA_SERVICE_PRINCIPAL_SPEC_MISMATCH' }
      $stored=$credentials[$environment]
      if (!$stored) {
        if ($Mode -ne 'Apply') { throw 'ENTRA_CREDENTIAL_MISSING' }
        if (@($application.passwordCredentials).Count -gt 0) { throw 'ENTRA_UNRECORDED_PASSWORD_REFUSE_RESET' }
        $expiry=[DateTimeOffset]::UtcNow.AddDays(90).ToString('o')
        $password=Invoke-BoardRest 'POST' ($appUrl+'/addPassword') $graphToken @{passwordCredential=@{displayName='vibe-board-confidential';endDateTime=$expiry}}
        $stored=@{clientId=$record.clientId;clientSecret=$password.secretText;passwordKeyId=$password.keyId;expiresAt=$password.endDateTime;encryptionKey=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()}
        $credentials[$environment]=$stored
        Save-EntraSecrets $credentials
        $record.passwordKeyId=$stored.passwordKeyId; $record.expiresAt=$stored.expiresAt
        Save-EntraMetadata $metadata
        $password=$null
      }
      if ($stored.clientId -ne $record.clientId -or [DateTimeOffset]::Parse($stored.expiresAt) -le [DateTimeOffset]::UtcNow -or !$stored.clientSecret -or $stored.encryptionKey -cnotmatch '^[a-f0-9]{64}$') { throw 'ENTRA_STORED_CREDENTIAL_INVALID_OR_EXPIRED' }
      $application=Invoke-BoardRest 'GET' $appUrl $graphToken
      if (@($application.passwordCredentials | Where-Object { $_.keyId -eq $stored.passwordKeyId -and [DateTimeOffset]::Parse($_.endDateTime) -gt [DateTimeOffset]::UtcNow }).Count -ne 1) { throw 'ENTRA_PASSWORD_METADATA_MISMATCH' }
      $assigned=Invoke-BoardRest 'GET' ($spUrl+'/appRoleAssignedTo') $graphToken
      $assignment=@($assigned.value | Where-Object { $_.principalId -eq $script:EntraSpec.administratorObjectId -and $_.appRoleId -eq $script:EntraSpec.role.id })
      if (!$assignment.Count -and $Mode -eq 'Apply') {
        $newAssignment=Invoke-BoardRest 'POST' ($spUrl+'/appRoleAssignedTo') $graphToken @{principalId=$script:EntraSpec.administratorObjectId;resourceId=$record.servicePrincipalId;appRoleId=$script:EntraSpec.role.id}
        $record.roleAssignmentId=$newAssignment.id
        Save-EntraMetadata $metadata
        $assigned=Invoke-BoardRest 'GET' ($spUrl+'/appRoleAssignedTo') $graphToken
      }
      if (!(Test-BoardAdministratorAssignments -Assignments @($assigned.value))) { throw 'ENTRA_ADMIN_ASSIGNMENT_MISMATCH' }
      Write-Output ('ENTRA_CLIENT_VERIFIED '+$environment+' '+$record.clientId)
    } catch {
      $safeCode = $_.Exception.Message
      if ($safeCode -cnotmatch '^[A-Z][A-Za-z0-9_.-]{0,120}$') { $safeCode='ENTRA_OPERATION_FAILED_DETAILS_SUPPRESSED' }
      $failures+=@{environment=$environment;code=$safeCode}
      Write-Output ('ENTRA_CLIENT_INCOMPLETE '+$environment+' '+$safeCode)
    }
  }
  if ($Mode -eq 'Inspect') {
    $armToken=Get-BoardAccessToken 'https://management.azure.com/'
    $settings=Get-EntraSettings $armToken
    [pscustomobject]@{AUTH_MODE=$settings.properties.AUTH_MODE;ENTRA_CLIENT_ID=$settings.properties.ENTRA_CLIENT_ID} | ConvertTo-Json -Compress
  }
  if ($Mode -eq 'Apply') { $metadata.failures=$failures;Save-EntraMetadata $metadata }
  if ($failures.Count) { throw 'ENTRA_PROVISIONING_INCOMPLETE_REVIEW_SAFE_CODES' }
} finally { $graphToken=$null;$armToken=$null;$credentials=$null;$settings=$null }
