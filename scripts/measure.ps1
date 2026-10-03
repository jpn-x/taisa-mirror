# Measures how much the PC is loaded while MirrorX is running (CPU / memory / GPU). Read-only: it only reads counters.
#   pwsh scripts\measure.ps1 [-Baseline 20] [-Seconds 120] [-Interval 2]
# Phase 1 (-Baseline s): MirrorX does not need to run yet -> how busy the PC is by itself.
# Phase 2 (-Seconds s):  MirrorX running + mirroring      -> the load while you use it. Output = a short summary of both.
param([int]$Baseline = 20, [int]$Seconds = 120, [int]$Interval = 2)
$ErrorActionPreference = 'SilentlyContinue'
$cpus = [Environment]::ProcessorCount
function NodePids { @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server[\\/]index\.js' } | ForEach-Object { $_.ProcessId }) }
function ChromePids { @((Get-Process chrome, msedge -ErrorAction SilentlyContinue).Id) }
function CpuSum($pids) { ($pids | ForEach-Object { (Get-Process -Id $_).TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum }
Write-Host "logical CPUs: $cpus | baseline $Baseline s, then $Seconds s of mirroring ..."
$rows = @(); $phase = 'baseline'
$prevNode = CpuSum (NodePids); $prevChrome = CpuSum (ChromePids); $t0 = Get-Date; $start = Get-Date
while (((Get-Date) - $start).TotalSeconds -lt ($Baseline + $Seconds)) {
  Start-Sleep -Seconds $Interval
  $elapsed = ((Get-Date) - $start).TotalSeconds
  $phase = if ($elapsed -le $Baseline) { 'baseline' } else { 'mirroring' }
  $now = Get-Date; $dt = ($now - $t0).TotalSeconds; $t0 = $now
  $np = NodePids; $cp = ChromePids
  $n = CpuSum $np; $c = CpuSum $cp
  $nodePct = if ($np.Count) { [math]::Max(0, ($n - $prevNode) / $dt / $cpus * 100) } else { 0 }
  $chromePct = [math]::Max(0, ($c - $prevChrome) / $dt / $cpus * 100)
  $prevNode = $n; $prevChrome = $c
  $sys = (Get-Counter '\Processor(_Total)\% Processor Time').CounterSamples[0].CookedValue
  $mem = if ($np.Count) { ($np | ForEach-Object { (Get-Process -Id $_).WorkingSet64 } | Measure-Object -Sum).Sum / 1MB } else { 0 }
  $gpu = 0; $gpuDec = 0
  try { $g = (Get-Counter '\GPU Engine(*)\Utilization Percentage').CounterSamples
        foreach ($x in $g) { if ($cp | Where-Object { $x.InstanceName -match "pid_$($_)_" }) { if ($x.InstanceName -match 'engtype_VideoDecode') { $gpuDec += $x.CookedValue } else { $gpu += $x.CookedValue } } } } catch { }
  $rows += [pscustomobject]@{ Phase = $phase; NodeUp = [bool]$np.Count; NodePct = $nodePct; ChromePct = $chromePct; SysPct = $sys; NodeMB = $mem; GpuPct = $gpu; GpuDecPct = $gpuDec }
}
function Stat($label, $set, $key, $fmt) { if (-not $set) { return }; $v = $set.$key | Measure-Object -Average -Maximum; "{0,-46} avg {1,7:$fmt}   max {2,7:$fmt}" -f $label, $v.Average, $v.Maximum }
$base = $rows | Where-Object { $_.Phase -eq 'baseline' }
$mir  = $rows | Where-Object { $_.Phase -eq 'mirroring' -and $_.NodeUp }
Write-Host ''; Write-Host "== Before MirrorX (baseline, $($base.Count) samples) =="
Stat 'Chrome/Edge (ALL windows) CPU, % of whole PC' $base ChromePct 'N2'
Stat 'Whole PC CPU %' $base SysPct 'N1'
Stat 'GPU used by Chrome/Edge, %' $base GpuPct 'N1'
Write-Host ''; Write-Host "== While MirrorX runs ($($mir.Count) samples with the server up) =="
Stat 'MirrorX server (node) CPU, % of whole PC' $mir NodePct 'N2'
Stat 'Chrome/Edge (ALL windows) CPU, % of whole PC' $mir ChromePct 'N2'
Stat 'Whole PC CPU %' $mir SysPct 'N1'
Stat 'MirrorX server memory (MB)' $mir NodeMB 'N1'
Stat 'GPU used by Chrome/Edge (3D etc.), %' $mir GpuPct 'N1'
Stat 'GPU video-decode engine used by Chrome/Edge, %' $mir GpuDecPct 'N1'
Write-Host ''; Write-Host 'Note: Chrome/Edge numbers include every Chrome window open, not only MirrorX; compare with the baseline above.'
