# Remove only Remote from an existing Harness profile. Run as the normal user.
$ErrorActionPreference = 'Stop'
$pluginUrl = 'https://github.com/liguobao/ds-harness-remote'
function Say([string]$Message) { Write-Host "[dsh-plugin] $Message" }
function DesktopHelp {
  Say 'DeepSeek Harness Desktop: open Extensions / Plugin management.'
  Say "Plugin address: $pluginUrl"
  Say 'Install or remove Remote there, then restart Desktop.'
  Say 'To use this script, enable Desktop''s official dsh command or set DSH_COMMAND to its launcher.'
}
# Restrict resolution to installed commands, excluding shell functions/aliases.
$dshCommand = $null
if ($env:DSH_COMMAND) {
  $dshCommand = Get-Command -Name $env:DSH_COMMAND -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $dshCommand) { throw 'DSH_COMMAND was not found.' }
} else {
  # Prefer Desktop's recorded official launcher over a standalone global CLI.
  $desktopDirectory = (Get-ItemProperty -LiteralPath 'HKCU:\Software\DeepSeekHarness\Command' -Name Directory -ErrorAction SilentlyContinue).Directory
  if ($desktopDirectory) {
    $launcher = Join-Path $desktopDirectory 'dsh.cmd'
    $dshCommand = Get-Command -Name $launcher -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  }
  if (-not $dshCommand) {
    $dshCommand = Get-Command -Name dsh -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
  }
}
if (-not $dshCommand) {
  DesktopHelp
  throw 'No existing dsh command found. No plugin was changed.'
}
$dshPath = $dshCommand.Source
$dshProfile = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } elseif ($dshPath -match '[\\/]runtime[\\/]cli[\\/]bin[\\/]dsh\.(cmd|ps1|exe)$') { 'desktop' } else { 'web' }
if ($dshProfile -notmatch '^[A-Za-z0-9_-]+$') { throw 'Invalid DSH_PROFILE.' }
if ($dshProfile -eq 'desktop') {
  Say 'Using the Desktop profile. Its official Desktop CLI must manage this reserved profile.'
}

Say "Removing ds-harness-remote from profile $dshProfile using $dshPath"
& $dshPath plugin --profile $dshProfile remove -w ds-harness-remote
if ($LASTEXITCODE -ne 0) { throw "Remote plugin removal failed (exit $LASTEXITCODE)." }
Say 'Remote plugin removed. Restart the selected Harness instance.'
