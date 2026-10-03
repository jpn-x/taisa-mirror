# Measures how much the PC is loaded while MirrorX is running (CPU / memory / GPU). Read-only: it only reads counters.
#   pwsh scripts\measure.ps1 [-Seconds 60] [-Interval 2]
# Start MirrorX, connect the iPhone and play something first, then run this. Output = a short summary.
param([int]$Seconds = 60, [int]$Interval = 2)
$ErrorActionPreference = 'SilentlyContinue'
$cpus = [Environment]::ProcessorCount
function NodePids { Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server[\\/]index\.js' } | ForEach-Object { $_.ProcessId } }
function ChromePids { (Get-Process chrome, msedge -ErrorAction SilentlyContinue).Id }
$np = @(NodePids)
if (-not $np.Count) { Write-Host 'MirrorX (node server\index.js) is not running. Start it first.'; exit 1 }
Write-Host "MirrorX node pid(s): $($np -join ', ')  | logical CPUs: $cpus | measuring $Seconds s ..."
$rows = @()
$prevNode = ($np | ForEach-Object { (Get-Process -Id $_).TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum
$cp = @(ChromePids); $prevChrome = ($cp | ForEach-Object { (Get-Process -Id $_).TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum
$t0 = Get-Date
for ($t = 0; $t -lt $Seconds; $t += $Interval) {
  Start-Sleep -Seconds $Interval
  $now = Get-Date; $dt = ($now - $t0).TotalSeconds; $t0 = $now
  $n = ($np | ForEach-Object { (Get-Process -Id $_).TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum
  $cp = @(ChromePids)
  $c = ($cp | ForEach-Object { (Get-Process -Id $_).TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum
  $nodePct = [math]::Max(0, ($n - $prevNode) / $dt / $cpus * 100); $chromePct = [math]::Max(0, ($c - $prevChrome) / $dt / $cpus * 100)
  $prevNode = $n; $prevChrome = $c
  $sys = (Get-Counter '\Processor(_Total)\% Processor Time').CounterSamples[0].CookedValue
  $mem = ($np | ForEach-Object { (Get-Process -Id $_).WorkingSet64 } | Measure-Object -Sum).Sum / 1MB
  $gpu = 0; $gpuDec = 0
  try { $g = (Get-Counter '\GPU Engine(*)\Utilization Percentage').CounterSamples
        foreach ($s in $g) { if ($cp | Where-Object { $s.InstanceName -match "pid_$($_)_" }) { if ($s.InstanceName -match 'engtype_VideoDecode') { $gpuDec += $s.CookedValue } else { $gpu += $s.CookedValue } } } } catch { }
  $rows += [pscustomobject]@{ NodePct = $nodePct; ChromePct = $chromePct; SysPct = $sys; NodeMB = $mem; GpuPct = $gpu; GpuDecPct = $gpuDec }
}
function Stat($name, $key, $fmt) { $v = $rows.$key | Measure-Object -Average -Maximum; "{0,-44} avg {1,7:$fmt}   max {2,7:$fmt}" -f $name, $v.Average, $v.Maximum }
Write-Host ''
Stat 'MirrorX server (node) CPU, % of whole PC' NodePct 'N2'
Stat 'Chrome/Edge (ALL windows) CPU, % of whole PC' ChromePct 'N2'
Stat 'Whole PC CPU %' SysPct 'N1'
Stat 'MirrorX server memory (MB)' NodeMB 'N1'
Stat 'GPU used by Chrome/Edge (3D etc.), %' GpuPct 'N1'
Stat 'GPU video-decode engine used by Chrome/Edge, %' GpuDecPct 'N1'
Write-Host ''
Write-Host 'Note: Chrome/Edge numbers include every Chrome window you have open, not only MirrorX.'
