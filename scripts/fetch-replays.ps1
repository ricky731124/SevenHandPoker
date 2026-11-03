# 抓回放(人機回報用,.claude/skills/bot-report)。
#   powershell -File scripts/fetch-replays.ps1 -Name 鼓山金城武
# 用名字在公開 cards 節點找 uid → 下載 userReplays/{uid}(這人最近 8 場)+ replays(全站精華 8 場),
# 合併成 _replays/latest.json(id → 回放)。公司憑證會擋 curl / node fetch,所以用 Invoke-WebRequest。
param(
  [Parameter(Mandatory = $true)][string[]]$Name,
  [string]$Out = "_replays/latest.json"
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$db = 'https://seven-hand-poker-3d2e0-default-rtdb.asia-southeast1.firebasedatabase.app'

function Get-Json($path) {
  $r = Invoke-WebRequest -UseBasicParsing "$db/$path.json"
  # Invoke-WebRequest 在 PS 5.1 會用 ISO-8859-1 解 body → 自己用 UTF-8 解
  $text = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
  if ($text -eq 'null') { return $null }
  return $text | ConvertFrom-Json
}

$merged = [ordered]@{}
$cards = Get-Json 'cards'
foreach ($n in $Name) {
  $uids = @($cards.PSObject.Properties | Where-Object { $_.Value.displayName -eq $n } | ForEach-Object { $_.Name })
  if (-not $uids.Count) { Write-Host "找不到玩家:$n"; continue }
  foreach ($uid in $uids) {
    $mine = Get-Json "userReplays/$uid"
    $count = 0
    if ($mine) { foreach ($p in $mine.PSObject.Properties) { $merged[$p.Name] = $p.Value; $count++ } }
    Write-Host "$n ($uid):$count 場"
  }
}
$global = Get-Json 'replays'
$g = 0
if ($global) { foreach ($p in $global.PSObject.Properties) { if (-not $merged.Contains($p.Name)) { $merged[$p.Name] = $p.Value; $g++ } } }
Write-Host "全站精華另加:$g 場"

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
$json = [pscustomobject]$merged | ConvertTo-Json -Depth 50 -Compress
[IO.File]::WriteAllText((Join-Path (Get-Location) $Out), $json, (New-Object Text.UTF8Encoding $false))
Write-Host "→ $Out(共 $($merged.Count) 場)"
