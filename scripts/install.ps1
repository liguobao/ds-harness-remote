# Installs a private runtime and a WinSW service under the current user's directory.
# Run from PowerShell opened with "Run as administrator" for the installing user.
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 on .NET Framework does not negotiate TLS 1.2 by default,
# so Invoke-WebRequest fails with "The underlying connection was closed".
# Enable it before any download runs. Tls12 exists on .NET 4.5+ (PS 5.1 baseline).
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$dshAdminPrincipal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $dshAdminPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Open PowerShell with Run as administrator under the installing Windows account, then run this script again.'
}
$installRoot = if ($env:DSH_INSTALL_DIR) { [IO.Path]::GetFullPath($env:DSH_INSTALL_DIR) } else { Join-Path $env:LOCALAPPDATA 'dsh-remote' }
$nodeVersion = if ($env:NODE_VERSION) { $env:NODE_VERSION } else { '24.21.0' }
# Dependencies (undici 8.11.x, pi-ai/pi-telemetry 0.85.x, libreoffice-kit 0.1.x)
# require Node >= 22.19.0; refuse to silently install an older runtime.
$nodeMinVersion = '22.19.0'
$dshVersion = if ($env:DSH_VERSION) { $env:DSH_VERSION } else { 'latest' }
$remoteVersion = if ($env:REMOTE_VERSION) { $env:REMOTE_VERSION } else { 'latest' }
$dshProfile = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'web' }
$registry = if ($env:NPM_REGISTRY) { $env:NPM_REGISTRY } else { 'https://registry.npmmirror.com' }
$serviceName = if ($env:DSH_SERVICE_NAME) { $env:DSH_SERVICE_NAME } else { 'DSHRemote' }
# Remote control is enabled by the bundled Host profile. Keep the terminal
# opt-out available, but enable it for automated installations by default.
$remoteTerminalEnabled = if ($env:DSH_REMOTE_TERMINAL_ENABLED -eq 'false') { 'false' } else { 'true' }
$env:DSH_REMOTE_TERMINAL_ENABLED = $remoteTerminalEnabled
# v3 supplies interactive service-account credentials without writing a password to XML.
$winSwVersion = '3.0.0-alpha.11'
if ($serviceName -notmatch '^[A-Za-z][A-Za-z0-9_-]*$') { throw 'Invalid DSH_SERVICE_NAME.' }
if ($dshProfile -notmatch '^[A-Za-z0-9_-]+$') { throw 'Invalid DSH_PROFILE.' }
if ($nodeVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid NODE_VERSION.' }
# [version] casts are PS 5.1 safe and compare correctly (no preview suffixes allowed above).
if ([version]$nodeVersion -lt [version]$nodeMinVersion) {
  throw "NODE_VERSION $nodeVersion is below the required minimum $nodeMinVersion (undici/pi-ai/libreoffice-kit engines). Clear NODE_VERSION or set it to >= $nodeMinVersion, Node 24 LTS is recommended."
}
# These paths are also embedded in cmd launchers. Reject cmd expansion/control characters.
$dshHome = if ($env:DSH_HOME) { [IO.Path]::GetFullPath($env:DSH_HOME) } else { Join-Path $env:USERPROFILE '.dsh' }
foreach ($value in @($installRoot, $dshHome)) {
  if ($value -match '[%\r\n"!^&|<>]') { throw 'Installation and DSH_HOME paths contain unsupported command characters.' }
}
$taskUser = $identity.Name
$ownerSid = $identity.User.Value
$nodeHome = Join-Path $installRoot 'node'
$prefix = Join-Path $installRoot 'packages'
$binDir = Join-Path $installRoot 'bin'
$wrapper = Join-Path $installRoot 'host.exe'
$configPath = Join-Path $installRoot 'host.xml'
$statePath = Join-Path $installRoot 'install-state.json'
if (-not (Test-Path $statePath)) {
  foreach ($name in @('node', 'packages', 'bin', 'host.exe', 'host.xml')) {
    if (Test-Path (Join-Path $installRoot $name)) { throw 'The destination contains files not owned by this installer. Choose an empty DSH_INSTALL_DIR.' }
  }
} else {
  $previous = Get-Content -Raw $statePath | ConvertFrom-Json
  if ($previous.ownerSid -ne $ownerSid -or $previous.serviceName -ne $serviceName -or $previous.profile -ne $dshProfile -or $previous.dshHome -ne $dshHome) {
    throw 'Installation settings differ from the existing installation. Use its original settings or uninstall first.'
  }
}
foreach ($directory in @($nodeHome, $prefix, $binDir)) {
  if ($dshHome -eq $directory -or $dshHome.StartsWith($directory.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'DSH_HOME must be outside the private runtime directories.'
  }
}
function Say([string]$Message) { Write-Host "[dsh-install] $Message" }
function Xml([string]$Value) { [Security.SecurityElement]::Escape($Value) }
function WinSW([string]$Operation) {
  & $wrapper $Operation --no-elevate
  if ($LASTEXITCODE -ne 0) { throw "WinSW $Operation failed (exit $LASTEXITCODE). Check $installRoot\host.out.log and $installRoot\host.err.log for details." }
}
$existing = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
if ($existing) {
  if (-not (Test-Path $statePath)) { throw "Service $serviceName already exists without this installer's ownership record. Remove or rename it before installing." }
  $previous = Get-Content -Raw $statePath | ConvertFrom-Json
  if ($previous.ownerSid -ne $ownerSid -or $previous.serviceName -ne $serviceName -or $existing.PathName.Trim('"') -ne $wrapper) {
    throw 'Existing service does not belong to this installation.'
  }
  WinSW stop
}
New-Item -ItemType Directory -Force -Path $installRoot, $prefix, $binDir | Out-Null
# Save ownership before downloads so an interrupted installation can be cleaned up.
@{ ownerSid = $ownerSid; serviceName = $serviceName; profile = $dshProfile; dshHome = $dshHome } |
  ConvertTo-Json | Set-Content -Encoding UTF8 $statePath
# PS 5.1 does not load the assembly holding RuntimeInformation in its default
# AppDomain; the class literal resolves to $null and .ToString() then throws a
# misleading "null-valued expression" error. Use the Wow64 variables instead:
# PROCESSOR_ARCHITEW6432 holds the real OS architecture when a 32-bit process
# (e.g. the 32-bit console host) runs on 64-bit Windows, and is empty for a
# native-process match. Native ARM64 reports ARM64 in both variables.
$processorArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$arch = switch ($processorArch) {
  'AMD64' { 'x64' }
  'ARM64' { 'arm64' }
  default { throw "Unsupported Windows architecture '$processorArch'. Only x64 and ARM64 are supported." }
}
$tmp = Join-Path ([IO.Path]::GetTempPath()) "dsh-install-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $node = Join-Path $nodeHome 'node.exe'
  $installedNodeVersion = if (Test-Path $node) { (& $node --version).Trim() } else { '' }
  if ($installedNodeVersion -and [version]$installedNodeVersion.TrimStart('v') -lt [version]$nodeMinVersion) {
    Say "Replacing private Node.js $installedNodeVersion (below the required minimum v$nodeMinVersion)"
  }
  if ($installedNodeVersion -ne "v$nodeVersion") {
    Say "Downloading private Node.js $nodeVersion ($arch)"
    $archive = "node-v$nodeVersion-win-$arch.zip"
    $nodeUrl = "https://npmmirror.com/mirrors/node/v$nodeVersion/$archive"
    Invoke-WebRequest -UseBasicParsing -Uri $nodeUrl -OutFile (Join-Path $tmp $archive)
    Expand-Archive -Path (Join-Path $tmp $archive) -DestinationPath $tmp
    if (Test-Path $nodeHome) { Remove-Item -Recurse -Force $nodeHome }
    Move-Item (Join-Path $tmp "node-v$nodeVersion-win-$arch") $nodeHome
  }
  if (-not (Test-Path $wrapper)) {
    # The pinned release has no native ARM64 wrapper; .NET Framework runs on Windows ARM64.
    $asset = if ($arch -eq 'arm64') { 'WinSW-net461.exe' } else { 'WinSW-x64.exe' }
    $winSwUrl = "https://github.com/winsw/winsw/releases/download/v$winSwVersion/$asset"
    Invoke-WebRequest -UseBasicParsing -Uri $winSwUrl -OutFile (Join-Path $tmp 'host.exe')
    Move-Item (Join-Path $tmp 'host.exe') $wrapper
  }
} catch {
  # Surface the failing URL and the real network/TLS cause instead of letting a
  # later null dereference hide it.
  throw "Download failed: $($_.Exception.Message). If this mentions 'The underlying connection was closed', the machine could not negotiate TLS 1.2 (see [Net.ServicePointManager] fix at the top of this script)."
} finally { Remove-Item -Recurse -Force $tmp }
$npm = Join-Path $nodeHome 'node_modules\npm\bin\npm-cli.js'
$env:Path = "$binDir;$nodeHome;$prefix;$env:Path"
$env:DSH_HOME = $dshHome
$env:npm_config_registry = $registry
Say 'Installing DSH, pnpm and Remote into the private package directory'
# npm >= 11 blocks dependency install scripts by default. node-pty (terminal),
# koffi (FFI), @deepseek-ai/dsh-subprocess-local (spawn helper postinstall),
# protobufjs and @google/genai must be allowed to run their scripts, or the
# packages install with exit code 0 but crash at runtime. Keep this list in
# sync when the DSH dependency set changes; the native-module check below is
# the safety net for list drift.
$allowScripts = 'node-pty,koffi,@deepseek-ai/dsh-subprocess-local,protobufjs,@google/genai'
& $node $npm --registry $registry install --global --prefix $prefix "--allow-scripts=$allowScripts" 'pnpm@11.21.0' "@deepseek-ai/dsh@$dshVersion" "ds-harness-remote@$remoteVersion"
if ($LASTEXITCODE -ne 0) { throw "Private package installation failed (npm exit $LASTEXITCODE)." }
# Loading the modules exercises the native binaries for real; missing or
# non-running builds fail here instead of inside the Host service.
$env:NODE_PATH = Join-Path $prefix 'node_modules'
foreach ($nativeName in @('node-pty', 'koffi')) {
  & $node -e "require('$nativeName')"
  if ($LASTEXITCODE -ne 0) {
    throw "Native module $nativeName did not load (install scripts blocked or binary missing for $arch). Re-run the installer; if it persists run: & `"$node`" `"$npm`" rebuild --global --prefix `"$prefix`" --allow-scripts=$allowScripts $nativeName"
  }
  Say "Native module loads: $nativeName"
}
$dshEntry = Join-Path $prefix 'node_modules\@deepseek-ai\dsh\lib\bin.js'
$remotePackage = Join-Path $prefix 'node_modules\ds-harness-remote'
# The npm package is packed from packages/plugin with a flat layout
# (bin/ds-harness-remote.js); resolve the entry from its manifest so both
# layouts keep working.
$remoteManifestPath = Join-Path $remotePackage 'package.json'
if (-not (Test-Path $remoteManifestPath)) { throw "Package manifest missing: $remoteManifestPath" }
$remoteManifest = Get-Content -Raw $remoteManifestPath | ConvertFrom-Json
$remoteBin = $remoteManifest.bin
$remoteBinRelative = if ($remoteBin -is [string]) { $remoteBin } else { $remoteBin.'ds-harness-remote' }
if (-not $remoteBinRelative) { throw 'ds-harness-remote package does not declare a bin entry.' }
$remoteEntry = Join-Path $remotePackage $remoteBinRelative
foreach ($entry in @($dshEntry, $remoteEntry)) {
  if (-not (Test-Path $entry)) { throw "Package entry point missing: $entry" }
}
& $node $dshEntry plugin --profile $dshProfile add -w $remotePackage
if ($LASTEXITCODE -ne 0) { throw 'Remote plugin installation failed.' }
# Only our CLI directory is persisted; private npm/node shims never shadow system tools.
@"
@echo off
setlocal
set "DSH_HOME=$dshHome"
set "PATH=$nodeHome;$prefix;%PATH%"
"$node" "$remoteEntry" %*
exit /b %errorlevel%
"@ | Set-Content -Encoding Default (Join-Path $binDir 'ds-harness-remote.cmd')
$userPath = [string][Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (($userPath -split ';') -contains $binDir)) {
  [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';') + ';' + $binDir).Trim(';')), 'User')
}
$codexHomeXml = if ($env:CODEX_HOME) { '<env name="CODEX_HOME" value="' + (Xml $env:CODEX_HOME) + '"/>' } else { '' }
@"
<service>
  <id>$(Xml $serviceName)</id>
  <name>$(Xml $serviceName)</name>
  <description>DSH Remote Host</description>
  <executable>$(Xml $node)</executable>
  <arguments>&quot;$(Xml $dshEntry)&quot; --profile $(Xml $dshProfile)</arguments>
  <workingdirectory>$(Xml $env:USERPROFILE)</workingdirectory>
  <env name="DSH_HOME" value="$(Xml $dshHome)"/>
  <env name="DSH_REMOTE_TERMINAL_ENABLED" value="$(if ($env:DSH_REMOTE_TERMINAL_ENABLED -eq 'true') { 'true' } else { '' })"/>
  <env name="USERPROFILE" value="$(Xml $env:USERPROFILE)"/>
  <env name="APPDATA" value="$(Xml $env:APPDATA)"/>
  <env name="LOCALAPPDATA" value="$(Xml $env:LOCALAPPDATA)"/>
  <env name="PATH" value="$(Xml "$nodeHome;$prefix;$env:Path")"/>
  $codexHomeXml
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <serviceaccount>
    <username>$(Xml $taskUser)</username>
    <prompt>dialog</prompt>
    <allowservicelogon>true</allowservicelogon>
  </serviceaccount>
  <onfailure action="restart" delay="10 sec"/>
  <stoptimeout>30 sec</stoptimeout>
  <log mode="roll"/>
</service>
"@ | Set-Content -Encoding UTF8 $configPath
if ($existing) { WinSW refresh } else {
  # WinSW's <prompt>dialog</prompt> only appears in an interactive session. In a
  # non-interactive one the service installs with an empty password, "starts
  # successfully", and then fails with events 7038/7000. Fail early instead.
  if (-not [Environment]::UserInteractive) {
    throw "This PowerShell session is not interactive, so WinSW cannot prompt for the password of $taskUser. Run the installer from an administrator console under that account, or register the account manually after install: sc.exe config $serviceName obj= `"$taskUser`" password= `"<Windows password>`" (then start the service from Services)."
  }
  Say "Enter the Windows password (not PIN) for $taskUser. No password is stored in XML."
  WinSW install
}
$registered = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
if (-not $registered) { throw "Service $serviceName was not registered. Check $installRoot\host.out.log and host.wrapper.log for the WinSW failure." }
$serviceSid = (New-Object Security.Principal.NTAccount($registered.StartName)).Translate([Security.Principal.SecurityIdentifier]).Value
if ($serviceSid -ne $ownerSid) { throw 'Service account differs from the installing user. Service was not started; uninstall and retry with the correct account.' }
# Replace only an old logon task belonging to this user, after the new service is installed.
$oldTask = Get-ScheduledTask -TaskName $serviceName -ErrorAction SilentlyContinue
if ($oldTask) {
  $oldSid = if ($oldTask.Principal.UserId -match '^S-1-') { $oldTask.Principal.UserId } else { (New-Object Security.Principal.NTAccount($oldTask.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value }
  if ($oldSid -ne $ownerSid) { throw 'An existing logon task belongs to another user; migration aborted.' }
  Stop-ScheduledTask -InputObject $oldTask
  Unregister-ScheduledTask -InputObject $oldTask -Confirm:$false
}
WinSW start
$service = Get-Service -Name $serviceName
$service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(30))
Say "Installed in $installRoot; service $serviceName is running as $taskUser."
Say 'Run: ds-harness-remote login zhihu (or login github), then ds-harness-remote status.'
Say "After login/logout, restart the service from Services, or run in administrator PowerShell: & '$wrapper' restart --no-elevate"
