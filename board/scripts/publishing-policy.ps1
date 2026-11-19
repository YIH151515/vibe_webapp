function Invoke-PublishingHardening {
  param([ValidateSet('Inspect','Apply','Verify')][string]$Mode,
    [Parameter(Mandatory=$true)][scriptblock]$ReadPolicy,
    [Parameter(Mandatory=$true)][scriptblock]$DisablePolicy)
  $names=@('ftp','scm')
  if($Mode-eq'Apply'){
    foreach($name in $names){$ignored=& $DisablePolicy $name;$ignored=$null}
  }
  foreach($name in $names){
    $policy=& $ReadPolicy $name
    if($policy.name-cne$name-or$policy.properties.allow-isnot[bool]){throw 'PUBLISHING_POLICY_READBACK_INVALID'}
    if($Mode-ne'Inspect'-and$policy.properties.allow-ne$false){throw 'PUBLISHING_BASIC_AUTH_STILL_ENABLED'}
    [pscustomobject]@{name=$name;allow=$policy.properties.allow}
  }
}
