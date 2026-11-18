[CmdletBinding()]
param(
	[string]$ShortcutName = "JobPilot"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Launcher = Join-Path $PSScriptRoot "start_bosshunter.ps1"
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "$ShortcutName.lnk"
$PowerShell = Join-Path $PSHOME "powershell.exe"
$IconPath = Join-Path $RepoRoot "assets\jobpilot.ico"
if (-not (Test-Path -LiteralPath $IconPath)) {
	$IconPath = Join-Path $RepoRoot "assets\bosshunter.ico"
}

# Remove legacy BossHunter shortcut if present
$LegacyShortcut = Join-Path $Desktop "BossHunter.lnk"
if ((Test-Path -LiteralPath $LegacyShortcut) -and ($ShortcutName -ne "BossHunter")) {
	Remove-Item -LiteralPath $LegacyShortcut -Force -ErrorAction SilentlyContinue
}

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $PowerShell
$Shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Launcher`""
$Shortcut.WorkingDirectory = $RepoRoot
$Shortcut.Description = "Start the JobPilot Chrome profile and local workbench"
if (Test-Path -LiteralPath $IconPath) {
	$Shortcut.IconLocation = "$IconPath,0"
}
$Shortcut.Save()

Write-Host "Created desktop shortcut: $ShortcutPath"
