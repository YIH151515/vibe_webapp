targetScope = 'resourceGroup'

param names object
@allowed(['koreacentral'])
param location string = 'koreacentral'
param sqlAdminLogin string = 'board_operator'
@secure()
param sqlAdminPassword string
@secure()
param sqlAppPassword string
@secure()
param adminPasswordHash string
@secure()
param sessionSecret string
@secure()
param rateKeySecret string
param localPublicIp string
param deployRoleDefinitionId string = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'de139f84-1756-47ae-9be6-808fbbe84772')
param appVersion string = 'provisioning'
var tags = { project: 'vibe-board', environment: 'production', managedBy: 'vibeweb-bicep' }

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: names.plan
  location: location
  tags: tags
  kind: 'linux'
  sku: { name: 'B1', tier: 'Basic', capacity: 1 }
  properties: { reserved: true, perSiteScaling: false, zoneRedundant: false }
}
resource sqlServer 'Microsoft.Sql/servers@2023-08-01' = {
  name: names.sqlServer
  location: location
  tags: tags
  properties: {
    administratorLogin: sqlAdminLogin
    administratorLoginPassword: sqlAdminPassword
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}
resource database 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: sqlServer
  name: names.database
  location: location
  tags: tags
  sku: { name: 'Basic', tier: 'Basic', capacity: 5 }
  properties: {
    maxSizeBytes: 2147483648
    requestedBackupStorageRedundancy: 'Local'
    zoneRedundant: false
    readScale: 'Disabled'
  }
}
resource retention 'Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies@2023-08-01' = {
  parent: database
  name: 'default'
  properties: { retentionDays: 7 }
}
resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: names.webApp
  location: location
  tags: tags
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      appCommandLine: 'node server.js'
      alwaysOn: true
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      remoteDebuggingEnabled: false
    }
  }
}
resource settings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: app
  name: 'appsettings'
  properties: {
    SQL_SERVER: sqlServer.properties.fullyQualifiedDomainName
    SQL_DATABASE: database.name
    SQL_USER: 'board_app'
    SQL_PASSWORD: sqlAppPassword
    APP_ORIGIN: 'https://${app.properties.defaultHostName}'
    REQUEST_IP_MODE: 'app-service'
    ADMIN_PASSWORD_HASH: adminPasswordHash
    ADMIN_SESSION_SECRET: sessionSecret
    RATE_LIMIT_KEY_SECRET: rateKeySecret
    HOSTNAME: '0.0.0.0'
    NODE_ENV: 'production'
    SCM_DO_BUILD_DURING_DEPLOYMENT: 'false'
    ENABLE_ORYX_BUILD: 'false'
    WEBSITE_RUN_FROM_PACKAGE: '1'
    APP_VERSION: appVersion
  }
}
var outboundIps = union(split(app.properties.outboundIpAddresses, ','), split(app.properties.possibleOutboundIpAddresses, ','), [localPublicIp])
module firewall './firewall.bicep' = {
  name: 'board-firewall'
  params: { serverName: sqlServer.name, allowedIps: outboundIps }
}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: names.deploymentIdentity
  location: location
  tags: tags
}
resource federation 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: identity
  name: 'github-main'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    audiences: ['api://AzureADTokenExchange']
    subject: 'repo:YIH151515/vibe_webapp:ref:refs/heads/main'
  }
}
resource deployRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: app
  name: guid(app.id, identity.id, deployRoleDefinitionId)
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: deployRoleDefinitionId
  }
}
output webAppId string = app.id
output defaultHostName string = app.properties.defaultHostName
output sqlFqdn string = sqlServer.properties.fullyQualifiedDomainName
output databaseName string = database.name
output clientId string = identity.properties.clientId
output tenantId string = tenant().tenantId
output subscriptionId string = subscription().subscriptionId
