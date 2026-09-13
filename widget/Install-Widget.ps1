<#
  Creates a Desktop shortcut for the RGossips stats widget, and optionally a
  Startup shortcut so it comes up with Windows.

    powershell -NoProfile -ExecutionPolicy Bypass -File Install-Widget.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File Install-Widget.ps1 -NoStartup
    powershell -NoProfile -ExecutionPolicy Bypass -File Install-Widget.ps1 -Uninstall
#>
param(
  [switch]$NoStartup,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$launcher   = Join-Path $ScriptDir 'Start-Widget.vbs'
$config     = Join-Path $ScriptDir 'config.json'
$example    = Join-Path $ScriptDir 'config.example.json'
$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'RGossips Admin Widget.lnk'
$startupLnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'RGossips Admin Widget.lnk'

if ($Uninstall) {
  foreach ($p in @($desktopLnk, $startupLnk)) {
    if (Test-Path $p) { Remove-Item $p -Force; Write-Host "removed  $p" }
  }
  Write-Host 'Shortcuts removed. Widget files and settings were left in place.'
  return
}

if (-not (Test-Path $launcher)) { throw "Start-Widget.vbs not found in $ScriptDir" }

# config.json holds the API token, so it is gitignored - seed it from the example.
if (-not (Test-Path $config)) {
  Copy-Item $example $config
  Write-Host "created  $config"
  Write-Host '         -> put the WIDGET_API_TOKEN value in its "token" field, then relaunch the widget.'
}

$sh = New-Object -ComObject WScript.Shell
function New-Link ([string]$path) {
  $lnk = $sh.CreateShortcut($path)
  $lnk.TargetPath       = $launcher
  $lnk.WorkingDirectory = $ScriptDir
  $lnk.Description      = 'RGossips admin stats widget'
  $lnk.IconLocation     = "$env:SystemRoot\System32\imageres.dll,77"
  $lnk.Save()
  Write-Host "created  $path"
}

New-Link $desktopLnk
if (-not $NoStartup) { New-Link $startupLnk }

Write-Host ''
Write-Host 'Done. Starting the widget now...'
Start-Process -FilePath $launcher
