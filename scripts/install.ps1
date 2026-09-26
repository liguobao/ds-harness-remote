# Installs a private runtime and a WinSW service under the current user's directory.
# Run from PowerShell opened with "Run as administrator" for the installing user.
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$dshAdminPrincipal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $dshAdminPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Open PowerShell with Run as administrator under the installing Windows account, then run this script again.'
}
$installRoot = if ($env:DSH_INSTALL_DIR) { [IO.Path]::GetFullPath($env:DSH_INSTALL_DIR) } else { Join-Path $env:LOCALAPPDATA 'dsh-remote' }
$nodeVersion = if ($env:NODE_VERSION) { $env:NODE_VERSION } else { '22.14.0' }
$dshVersion = if ($env:DSH_VERSION) { $env:DSH_VERSION } else { 'latest' }
$remoteVersion = if ($env:REMOTE_VERSION) { $env:REMOTE_VERSION } else { '0.4.19' }
$fileViewerVersion = if ($env:FILE_VIEWER_VERSION) { $env:FILE_VIEWER_VERSION } else { 'latest' }
$dshProfile = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'web' }
$registry = if ($env:NPM_REGISTRY) { $env:NPM_REGISTRY } else { 'https://registry.npmmirror.com' }
$serviceName = if ($env:DSH_SERVICE_NAME) { $env:DSH_SERVICE_NAME } else { 'DSHRemote' }
# v3 supplies interactive service-account credentials without writing a password to XML.
$winSwVersion = '3.0.0-alpha.11'
if ($serviceName -notmatch '^[A-Za-z][A-Za-z0-9_-]*$') { throw 'Invalid DSH_SERVICE_NAME.' }
if ($dshProfile -notmatch '^[A-Za-z0-9_-]+$') { throw 'Invalid DSH_PROFILE.' }
if ($nodeVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid NODE_VERSION.' }
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
  if ($LASTEXITCODE -ne 0) { throw "WinSW $Operation failed ($LASTEXITCODE)." }
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
$arch = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()) {
  'X64' { 'x64' }
  'Arm64' { 'arm64' }
  default { throw 'Only x64 and ARM64 Windows are supported.' }
}
$tmp = Join-Path ([IO.Path]::GetTempPath()) "dsh-install-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $node = Join-Path $nodeHome 'node.exe'
  $installedNodeVersion = if (Test-Path $node) { & $node --version } else { '' }
  if ($installedNodeVersion -ne "v$nodeVersion") {
    Say "Downloading private Node.js $nodeVersion ($arch)"
    $archive = "node-v$nodeVersion-win-$arch.zip"
    Invoke-WebRequest -UseBasicParsing -Uri "https://npmmirror.com/mirrors/node/v$nodeVersion/$archive" -OutFile (Join-Path $tmp $archive)
    Expand-Archive -Path (Join-Path $tmp $archive) -DestinationPath $tmp
    if (Test-Path $nodeHome) { Remove-Item -Recurse -Force $nodeHome }
    Move-Item (Join-Path $tmp "node-v$nodeVersion-win-$arch") $nodeHome
  }
  if (-not (Test-Path $wrapper)) {
    # The pinned release has no native ARM64 wrapper; .NET Framework runs on Windows ARM64.
    $asset = if ($arch -eq 'arm64') { 'WinSW-net461.exe' } else { 'WinSW-x64.exe' }
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/winsw/winsw/releases/download/v$winSwVersion/$asset" -OutFile (Join-Path $tmp 'host.exe')
    Move-Item (Join-Path $tmp 'host.exe') $wrapper
  }
} finally { Remove-Item -Recurse -Force $tmp }
$npm = Join-Path $nodeHome 'node_modules\npm\bin\npm-cli.js'
$env:Path = "$binDir;$nodeHome;$prefix;$env:Path"
$env:DSH_HOME = $dshHome
$env:npm_config_registry = $registry
Say 'Installing DSH, pnpm and Remote into the private package directory'
& $node $npm --registry $registry install --global --prefix $prefix 'pnpm@11.21.0' "@deepseek-ai/dsh@$dshVersion" "ds-harness-remote@$remoteVersion"
if ($LASTEXITCODE -ne 0) { throw 'Private package installation failed.' }
$dshEntry = Join-Path $prefix 'node_modules\@deepseek-ai\dsh\lib\bin.js'
$remotePackage = Join-Path $prefix 'node_modules\ds-harness-remote'
$remoteEntry = Join-Path $remotePackage 'packages\plugin\bin\ds-harness-remote.js'
foreach ($entry in @($dshEntry, $remoteEntry)) {
  if (-not (Test-Path $entry)) { throw "Package entry point missing: $entry" }
}
& $node $dshEntry plugin --profile $dshProfile add -w $remotePackage
if ($LASTEXITCODE -ne 0) { throw 'Remote plugin installation failed.' }
& $node $dshEntry plugin --profile $dshProfile add -w "dsh-file-viewer@$fileViewerVersion"
if ($LASTEXITCODE -ne 0) { throw 'File Viewer installation failed.' }
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
  <log mode="ignore"/>
</service>
"@ | Set-Content -Encoding UTF8 $configPath
if ($existing) { WinSW refresh } else {
  Say "Enter the Windows password (not PIN) for $taskUser. No password is stored in XML."
  WinSW install
}
$registered = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
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
