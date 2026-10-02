# Creates "TAISA Mirror" shortcuts on the Desktop and in the Start menu (Start > All apps / search).
# Windows does not allow programs to pin themselves; to pin: right-click the shortcut >
# "Show more options" > "Pin to Start" / "Pin to taskbar".
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'Start TAISA Mirror.cmd'
$places = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'))
$sh = New-Object -ComObject WScript.Shell
foreach ($dir in $places) {
  $s = $sh.CreateShortcut((Join-Path $dir 'TAISA Mirror.lnk'))
  $s.TargetPath = $target
  $s.WorkingDirectory = $root
  $s.WindowStyle = 7   # minimized
  $s.IconLocation = "$env:SystemRoot\System32\imageres.dll,109"
  $s.Description = 'TAISA Mirror - iPhone screen mirroring in your browser'
  $s.Save()
  Write-Host "Created: $dir\TAISA Mirror.lnk"
}
Write-Host ''
Write-Host 'Done. To pin: right-click the shortcut > Show more options > Pin to Start / Pin to taskbar.'
