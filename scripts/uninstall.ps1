# Removes the private WinSW installation, retaining DSH profiles and credentials.
# Run as the installing user in an administrator PowerShell window.
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$dshAdminPrincipal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $dshAdminPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Open PowerShell with Run as administrator under the installing Windows account, then run this script again.'
}
$installRoot = if ($env:DSH_INSTALL_DIR) { [IO.Path]::GetFullPath($env:DSH_INSTALL_DIR) } else { Join-Path $env:LOCALAPPDATA 'dsh-remote' }
$statePath = Join-Path $installRoot 'install-state.json'
if (-not (Test-Path $statePath)) {
  throw "No installation record at $statePath. For an older global installation, use its original uninstaller."
}
$state = Get-Content -Raw $statePath | ConvertFrom-Json
$ownerSid = $identity.User.Value
if ($state.ownerSid -ne $ownerSid) { throw 'Run uninstall as the user who installed DSH Remote.' }
$serviceName = $state.serviceName
if ($serviceName -notmatch '^[A-Za-z][A-Za-z0-9_-]*$') { throw 'Invalid service name in installation record.' }
$wrapper = Join-Path $installRoot 'host.exe'
$service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
if ($service) {
  if ($service.PathName.Trim('"') -ne $wrapper) { throw 'Service executable does not belong to this installation.' }
  foreach ($operation in @('stop', 'uninstall')) {
    & $wrapper $operation --no-elevate
    if ($LASTEXITCODE -ne 0) { throw "WinSW $operation failed ($LASTEXITCODE); installation files were retained." }
  }
  if (Get-CimInstance Win32_Service -Filter "Name='$serviceName'") { throw 'Service deletion is still pending. Close Services and retry uninstall.' }
}
$nodeHome = Join-Path $installRoot 'node'
$prefix = Join-Path $installRoot 'packages'
$node = Join-Path $nodeHome 'node.exe'
$dshEntry = Join-Path $prefix 'node_modules\@deepseek-ai\dsh\lib\bin.js'
if ((Test-Path $dshEntry) -and -not $state.pluginsRemoved) {
  if (-not (Test-Path $node)) { throw 'Private Node is missing; restore the installation before removing plugins.' }
  $env:Path = "$nodeHome;$prefix;$env:Path"
  $env:DSH_HOME = $state.dshHome
  # New installs omit File Viewer; older installs and retries may have either plugin.
  # pnpm rejects the entire removal if any requested dependency is absent.
  $profileDir = Join-Path (Join-Path $state.dshHome 'profiles') $state.profile
  $manifestPath = Join-Path $profileDir 'package.json'
  if (Test-Path $manifestPath) {
    $manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
    $dependencies = foreach ($section in @('dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies')) {
      if ($manifest.$section) { $manifest.$section.PSObject.Properties.Name }
    }
    $plugins = @('ds-harness-remote', 'dsh-file-viewer' | Where-Object { $_ -in $dependencies })
    if ($plugins.Count -gt 0) {
      & $node $dshEntry plugin --profile $state.profile remove -w @plugins
      if ($LASTEXITCODE -ne 0) { throw 'Plugin removal failed; private runtime was retained. Correct the error and retry.' }
    }
  }
  $state | Add-Member -NotePropertyName pluginsRemoved -NotePropertyValue $true -Force
  $state | ConvertTo-Json | Set-Content -Encoding UTF8 $statePath
}
$binDir = Join-Path $installRoot 'bin'
$userPath = [string][Environment]::GetEnvironmentVariable('Path', 'User')
$remainingPath = ($userPath -split ';' | Where-Object { $_.TrimEnd('\') -ine $binDir.TrimEnd('\') }) -join ';'
[Environment]::SetEnvironmentVariable('Path', $remainingPath, 'User')
$env:Path = ($env:Path -split ';' | Where-Object { $_.TrimEnd('\') -notin @($binDir.TrimEnd('\'), $nodeHome.TrimEnd('\'), $prefix.TrimEnd('\')) }) -join ';'
# Delete only installer-owned entries, never the whole configurable install root.
foreach ($name in @('node', 'packages', 'bin', 'host.exe', 'host.xml', 'host.wrapper.log', 'host.out.log', 'host.err.log')) {
  $path = Join-Path $installRoot $name
  if (Test-Path $path) { Remove-Item -Recurse -Force $path }
}
# Rolled log archives from <log mode="roll"/>: host.out-<timestamp>.log etc.
Get-ChildItem -Path $installRoot -Filter 'host.*.log' -File -ErrorAction SilentlyContinue | Remove-Item -Force
Remove-Item $statePath
Write-Host "[dsh-install] Removed service, plugins and private runtime. DSH profiles and credentials remain in $($state.dshHome)."
