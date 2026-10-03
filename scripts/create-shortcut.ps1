# Creates "TAISA Mirror" shortcuts on the Desktop and in the Start menu (Start > All apps / search).
# Windows does not allow programs to pin themselves; to pin: Start menu > All apps > TAISA Mirror > right-click >
# "Pin to Start" / "More" > "Pin to taskbar" (or right-click the Desktop shortcut > Show more options).
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'Start TAISA Mirror.cmd'
$places = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'))
$sh = New-Object -ComObject WScript.Shell
foreach ($dir in $places) {
  $s = $sh.CreateShortcut((Join-Path $dir 'TAISA Mirror.lnk'))
  # Target an .exe (Windows only offers "Pin to Start/taskbar" for shortcuts that point at an .exe).
  # conhost.exe --headless runs the launcher with NO console window at all: no flashing black window, and no
  # window that the taskbar button could turn into. (If this ever fails, use cmd.exe /c "...\Start TAISA Mirror.cmd".)
  $s.TargetPath = "$env:SystemRoot\System32\conhost.exe"
  $s.Arguments = "--headless `"$env:SystemRoot\System32\cmd.exe`" /c `"`"$target`"`""
  $s.WorkingDirectory = $root
  $s.IconLocation = (Join-Path (Join-Path $root 'assets') 'taisa-mirror.ico') + ',0'
  $s.Description = 'TAISA Mirror - iPhone screen mirroring in your browser'
  $s.Save()
  Write-Host "Created: $dir\TAISA Mirror.lnk"
}
Write-Host ''
Write-Host 'Done. To pin: right-click the shortcut > Show more options > Pin to Start / Pin to taskbar.'
