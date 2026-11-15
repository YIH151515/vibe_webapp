param serverName string
param allowedIps array
resource server 'Microsoft.Sql/servers@2023-08-01' existing = { name: serverName }
resource rules 'Microsoft.Sql/servers/firewallRules@2023-08-01' = [for ip in allowedIps: {
  parent: server
  name: 'board-${replace(ip, '.', '-')}'
  properties: { startIpAddress: ip, endIpAddress: ip }
}]
