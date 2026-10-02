# Pre/post-install self-check for the Windows installer. Windows PowerShell 5.1
# compatible: no PS 7 syntax, no RuntimeInformation, no new cmdlet parameters.
# Usage:
#   Before install:  .\check-install.ps1                 (checks 1 and the
#                    NODE_VERSION override only; runtime checks are skipped)
#   After install:   .\check-install.ps1                 (all four checks)
# Exit code 0 = all applicable checks passed; 1 = at least one failed.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$failures = 0
function Pass([string]$Message) { Write-Host "[dsh-check] PASS: $Message" -ForegroundColor Green }
function Fail([string]$Message) { Write-Host "[dsh-check] FAIL: $Message" -ForegroundColor Red; $script:failures++ }
function Skip([string]$Message) { Write-Host "[dsh-check] SKIP: $Message" -ForegroundColor Yellow }
$installRoot = if ($env:DSH_INSTALL_DIR) { [IO.Path]::GetFullPath($env:DSH_INSTALL_DIR) } else { Join-Path $env:LOCALAPPDATA 'dsh-remote' }
$nodeMinVersion = '22.19.0'

# --- Check 1: architecture detection (must not use RuntimeInformation) -------
# Same Wow64 logic as install.ps1: PROCESSOR_ARCHITEW6432 wins when a 32-bit
# process runs on 64-bit Windows; PROCESSOR_ARCHITECTURE is the native value.
$processorArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$arch = switch ($processorArch) {
  'AMD64' { 'x64' }
  'ARM64' { 'arm64' }
  default { $null }
}
if ($arch) { Pass "architecture detected via environment variables: $arch (W6432='$env:PROCESSOR_ARCHITEW6432', ARCH='$env:PROCESSOR_ARCHITECTURE')" }
else { Fail "unsupported architecture: '$processorArch' (W6432='$env:PROCESSOR_ARCHITEW6432', ARCH='$env:PROCESSOR_ARCHITECTURE')" }

# --- Locate the private runtime ------------------------------------------------
$nodeHome = Join-Path $installRoot 'node'
$prefix = Join-Path $installRoot 'packages'
$node = Join-Path $nodeHome 'node.exe'
$npm = Join-Path $nodeHome 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path $node)) {
  Skip "private Node.js not found at $node; runtime checks need a completed installation."
} else {
  # --- Check 2: Node version meets the dependency minimum ---------------------
  $installedNodeVersion = (& $node --version).Trim()
  if ([version]$installedNodeVersion.TrimStart('v') -lt [version]$nodeMinVersion) {
    Fail "private Node.js $installedNodeVersion is below the required minimum v$nodeMinVersion (undici/pi-ai/libreoffice-kit engines). Re-run install.ps1 (default Node 24 LTS) or set NODE_VERSION."
  } else {
    Pass "private Node.js $installedNodeVersion >= v$nodeMinVersion"
  }
  if ($env:NODE_VERSION -and [version]$env:NODE_VERSION -lt [version]$nodeMinVersion) {
    Fail "NODE_VERSION override $env:NODE_VERSION is below the required minimum $nodeMinVersion; the installer will refuse it."
  }

  # --- Check 3: native modules load under the private runtime ------------------
  $env:NODE_PATH = Join-Path $prefix 'node_modules'
  foreach ($nativeName in @('node-pty', 'koffi')) {
    & $node -e "require('$nativeName')"
    if ($LASTEXITCODE -eq 0) { Pass "native module loads: $nativeName" }
    else { Fail "native module '$nativeName' does not load (exit $LASTEXITCODE). Install scripts were likely blocked by npm 11; re-run install.ps1, or run: & `"$node`" `"$npm`" rebuild --global --prefix `"$prefix`" --allow-scripts=node-pty,koffi $nativeName" }
  }

  # --- Check 4: CLI entry point resolves from the package manifest ------------
  $remotePackage = Join-Path $prefix 'node_modules\ds-harness-remote'
  $remoteManifestPath = Join-Path $remotePackage 'package.json'
  if (-not (Test-Path $remoteManifestPath)) {
    Fail "installed package manifest missing: $remoteManifestPath"
  } else {
    $remoteBin = (Get-Content -Raw $remoteManifestPath | ConvertFrom-Json).bin
    $remoteBinRelative = if ($remoteBin -is [string]) { $remoteBin } else { $remoteBin.'ds-harness-remote' }
    if (-not $remoteBinRelative) { Fail 'ds-harness-remote package.json declares no bin entry.' }
    else {
      $remoteEntry = Join-Path $remotePackage $remoteBinRelative
      if (Test-Path $remoteEntry) { Pass "CLI entry resolves from package.json bin: $remoteEntry" }
      else { Fail "CLI entry declared by package.json bin does not exist: $remoteEntry" }
    }
  }
  if (-not (Test-Path (Join-Path $installRoot 'bin\ds-harness-remote.cmd'))) {
    Skip "CLI launcher not created yet at $installRoot\bin\ds-harness-remote.cmd"
  }
}

if ($failures -gt 0) { Write-Host "[dsh-check] $failures check(s) failed." -ForegroundColor Red; exit 1 }
Write-Host '[dsh-check] All applicable checks passed.' -ForegroundColor Green
exit 0
