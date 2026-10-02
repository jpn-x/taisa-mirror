# Creates "TAISA Mirror" shortcuts on the Desktop and in the Start menu (Start > All apps / search).
# Windows does not allow programs to pin themselves; to pin: Start menu > All apps > TAISA Mirror > right-click >
# "Pin to Start" / "More" > "Pin to taskbar" (or right-click the Desktop shortcut > Show more options).
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'Start TAISA Mirror.cmd'
$places = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'))
$sh = New-Object -ComObject WScript.Shell
foreach ($dir in $places) {
  $s = $sh.CreateShortcut((Join-Path $dir 'TAISA Mirror.lnk'))
  # Target cmd.exe (not the .cmd directly): Windows only offers "Pin to Start/taskbar" for shortcuts that point at an .exe.
  $s.TargetPath = "$env:SystemRoot\System32\cmd.exe"
  $s.Arguments = "/c `"`"$target`"`""
  $s.WorkingDirectory = $root
  $s.WindowStyle = 7   # minimized
  $s.IconLocation = (Join-Path (Join-Path $root 'assets') 'taisa-mirror.ico') + ',0'
  $s.Description = 'TAISA Mirror - iPhone screen mirroring in your browser'
  $s.Save()
  Write-Host "Created: $dir\TAISA Mirror.lnk"
}
Write-Host ''
Write-Host 'Done. To pin: right-click the shortcut > Show more options > Pin to Start / Pin to taskbar.'
