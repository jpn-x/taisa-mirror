# OPTIONAL. Adds narrow Windows Firewall rules for MirrorX (Private network + local subnet only),
# instead of the broad "Node.js JavaScript Runtime" rule that Windows may offer on first start.
#   powershell -ExecutionPolicy Bypass -File scripts\firewall.ps1          (add)
#   powershell -ExecutionPolicy Bypass -File scripts\firewall.ps1 -Remove  (remove)
# Windows will ask for administrator approval (UAC). Nothing is disabled; only these rules are touched.
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"") + $(if ($Remove) { '-Remove' })
  Start-Process powershell -Verb RunAs -ArgumentList $a -Wait
  exit
}
$root = Split-Path -Parent $PSScriptRoot
$node = Join-Path $root 'runtime\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction Stop).Source }
$prefix = 'MirrorX'
Get-NetFirewallRule -DisplayName "$prefix*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Get-NetFirewallRule -DisplayName 'TAISA Mirror*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule   # rules made by older versions (codename)
if ($Remove) { Write-Host 'MirrorX firewall rules removed.'; Read-Host 'Press Enter'; exit }
New-NetFirewallRule -DisplayName "$prefix (TCP AirPlay)" -Direction Inbound -Action Allow -Program $node -Protocol TCP -LocalPort 7000, 7100 -Profile Private -RemoteAddress LocalSubnet | Out-Null
New-NetFirewallRule -DisplayName "$prefix (UDP mDNS/audio/timing)" -Direction Inbound -Action Allow -Program $node -Protocol UDP -LocalPort 5353, 7101, 7102, 7103 -Profile Private -RemoteAddress LocalSubnet | Out-Null
Write-Host "Added 2 inbound rules for $node (Private profile, local subnet only)."
Read-Host 'Press Enter'
