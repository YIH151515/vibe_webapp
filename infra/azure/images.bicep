targetScope = 'resourceGroup'

@allowed(['koreacentral'])
param location string = 'koreacentral'
@allowed(['stvibeboardimg7b1417'])
param storageAccountName string = 'stvibeboardimg7b1417'
@minLength(36)
@maxLength(36)
param runtimePrincipalId string
@minLength(36)
@maxLength(36)
param operatorPrincipalId string

var roleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var tags = { project: 'vibe-board', environment: 'production', managedBy: 'vibeweb-bicep' }

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    accessTier: 'Hot'
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    allowCrossTenantReplication: false
    publicNetworkAccess: 'Enabled'
  }
}
resource service 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }
    containerDeleteRetentionPolicy: { enabled: true, days: 7 }
    isVersioningEnabled: false
    cors: { corsRules: [] }
  }
}
resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: service
  name: 'board-images'
  properties: { publicAccess: 'None' }
}
resource runtimeRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: container
  name: guid(container.id, runtimePrincipalId, roleDefinitionId)
  properties: { principalId: runtimePrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: roleDefinitionId }
}
resource operatorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: container
  name: guid(container.id, operatorPrincipalId, roleDefinitionId)
  properties: { principalId: operatorPrincipalId, principalType: 'User', roleDefinitionId: roleDefinitionId }
}
output storageAccount string = storage.name
output blobServiceUrl string = 'https://${storage.name}.blob.${environment().suffixes.storage}'
output containerName string = container.name
output containerId string = container.id
output runtimePrincipalId string = runtimePrincipalId
output operatorPrincipalId string = operatorPrincipalId
