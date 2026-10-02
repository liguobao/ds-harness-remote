# Install and register a Host using a one-time server-issued registration token.
param([Parameter(Mandatory = $true, Position = 0)][string]$Token)
$ErrorActionPreference = 'Stop'
if ($Token -notmatch '^[A-Za-z0-9-]+$') { throw 'The server token contains unsupported characters.' }
$env:DSH_REMOTE_TERMINAL_ENABLED = 'true'
& (Join-Path $PSScriptRoot 'install.ps1')
if ($LASTEXITCODE -ne 0) { throw 'The base installation failed.' }
& (Join-Path $env:DSH_INSTALL_DIR 'bin\ds-harness-remote.cmd') register $Token
if ($LASTEXITCODE -ne 0) { throw 'Host registration failed.' }
Write-Host '[dsh-install] Host registered and remote terminal enabled.'
