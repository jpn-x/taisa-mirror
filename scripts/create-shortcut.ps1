# Creates a "TAISA Mirror" shortcut on the Desktop that runs "Start TAISA Mirror.cmd".
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'TAISA Mirror.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = Join-Path $root 'Start TAISA Mirror.cmd'
$s.WorkingDirectory = $root
$s.WindowStyle = 7   # minimized
$s.IconLocation = "$env:SystemRoot\System32\imageres.dll,109"
$s.Description = 'TAISA Mirror - iPhone screen mirroring in your browser'
$s.Save()
Write-Host "Shortcut created: $lnk"
