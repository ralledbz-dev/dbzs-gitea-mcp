# DBZS private MCP smoke test - Windows PowerShell 5.1 / PowerShell 7
[CmdletBinding()]
param(
 [string]$McpUrl = 'http://127.0.0.1:3939/mcp',
 [switch]$SkipGitea,
 [string]$ReportPath = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$script:sessionId = $null
$script:counter = 0
$script:checks = @()
$script:uri = [Uri]$McpUrl
if ($script:uri.Scheme -notin @('http','https')) { throw 'McpUrl must be HTTP(S)' }
function Check([string]$Name,[bool]$Passed,[string]$Detail) {
 $script:checks += [pscustomobject]@{ name=$Name; passed=$Passed; detail=$Detail }
 Write-Host ("[{0}] {1}: {2}" -f $(if($Passed){'PASS'}else{'FAIL'}),$Name,$Detail)
}
function Rpc([string]$Method,$Params=$null,[switch]$Notification) {
 $script:counter++
 $body = @{ jsonrpc='2.0'; method=$Method }
 if (!$Notification) { $body.id = $script:counter }
 if ($null -ne $Params) { $body.params = $Params }
 $headers = @{ Accept='application/json, text/event-stream'; 'MCP-Protocol-Version'='2025-03-26' }
 if ($script:sessionId) { $headers['Mcp-Session-Id']=$script:sessionId }
 $json = ConvertTo-Json -InputObject $body -Depth 30 -Compress
 $request = [Net.HttpWebRequest]::Create($script:uri)
 $request.Method = 'POST'
 $request.ContentType = 'application/json'
 $request.Accept = 'application/json, text/event-stream'
 foreach($key in $headers.Keys) { if($key -eq 'Accept'){continue}; $request.Headers[$key]=$headers[$key] }
 $bytes = [Text.Encoding]::UTF8.GetBytes($json)
 $request.ContentLength = $bytes.Length
 $stream=$request.GetRequestStream()
 try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
 $response=$request.GetResponse()
 try {
  $sid=$response.Headers['Mcp-Session-Id']
  if ($sid) { $script:sessionId=$sid }
  $reader=New-Object IO.StreamReader($response.GetResponseStream())
  try { $raw=$reader.ReadToEnd() } finally { $reader.Dispose() }
  if ($Notification) { return $null }
  if ($response.ContentType -like 'text/event-stream*') {
   $data=@($raw -split "`r?`n" | Where-Object { $_ -like 'data:*' } | ForEach-Object { $_.Substring(5).Trim() })
   if (!$data.Count) { throw "SSE response has no data: $Method" }
   $raw=$data[-1]
  }
  $obj=ConvertFrom-Json -InputObject $raw
  if ($obj.error) { throw ("MCP error: "+($obj.error|ConvertTo-Json -Compress)) }
  return $obj.result
 } finally { $response.Dispose() }
}
try {
 $tcp=New-Object Net.Sockets.TcpClient
 try { $tcp.Connect($script:uri.Host,$script:uri.Port); Check 'TCP connection' $true "$($script:uri.Host):$($script:uri.Port)" }
 finally { $tcp.Close() }
 $init=Rpc 'initialize' @{ protocolVersion='2025-03-26'; capabilities=@{}; clientInfo=@{name='dbzs-private-smoke-test';version='1.0.0'} }
 if (!$init.protocolVersion) { throw 'Initialize returned no protocolVersion' }
 Check 'MCP initialize' $true "$($init.protocolVersion) - $($init.serverInfo.name)"
 $null=Rpc 'notifications/initialized' @{} -Notification
 $tools=Rpc 'tools/list' @{}
 if ($null -eq $tools.tools) { throw 'tools/list returned no tools array' }
 $names=@($tools.tools | ForEach-Object { $_.name })
 Check 'MCP tools/list' $true "$($names.Count) tools"
 if (!$SkipGitea) {
  if ($names -notcontains 'gitea_list_repositories') { throw 'gitea_list_repositories not exposed' }
  $result=Rpc 'tools/call' @{name='gitea_list_repositories';arguments=@{limit=10}}
  if ($result.isError) { throw ('Gitea tool error: '+($result|ConvertTo-Json -Depth 10 -Compress)) }
  Check 'Gitea read-only tool call' $true 'gitea_list_repositories returned without MCP error'
 }
} catch {
 Check 'Smoke test' $false $_.Exception.Message
} finally {
 if ($ReportPath) {
  $report=[pscustomobject]@{ timestamp=(Get-Date).ToString('o'); endpoint=$McpUrl; checks=$script:checks; success=(@($script:checks|Where-Object { !$_.passed }).Count -eq 0) }
  $report | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -LiteralPath $ReportPath
 }
}
if (@($script:checks | Where-Object { !$_.passed }).Count -gt 0) { exit 1 }
Write-Host 'DBZS MCP LOCAL SMOKE TEST: PASS'
exit 0
