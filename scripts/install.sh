#!/usr/bin/env bash
set +x
set +a
set -euo pipefail
# Keep the one-use code out of every install/download subprocess environment.
registration_token=${DSH_REMOTE_REGISTRATION_TOKEN-}
export -n registration_token
explicit_token=${DSH_REMOTE_REGISTRATION_TOKEN+x}
unset DSH_REMOTE_REGISTRATION_TOKEN
say() { printf '[dsh-plugin] %s\n' "$*"; }
fail() { say "$*" >&2; exit 1; }
if (( $# )); then
  [[ -z "$explicit_token" ]] || fail 'Supply the registration Token only once.'
  if [[ "$1" = --token ]]; then
    [[ $# = 2 ]] || fail 'Usage: install.sh [--token TOKEN | TOKEN]'
    registration_token=$2
  else
    [[ $# = 1 && "$1" != -* ]] || fail 'Usage: install.sh [--token TOKEN | TOKEN]'
    registration_token=$1
  fi
  explicit_token=1
fi
[[ -z "$explicit_token" || -n "${registration_token//[[:space:]]/}" ]] || fail 'An explicit registration Token cannot be empty.'
os=$(uname -s)
[[ "$os" = Linux || "$os" = Darwin ]] || fail 'Only Linux and macOS are supported.'
if [[ "$os" = Linux ]]; then
  [[ $EUID = 0 ]] || fail 'Linux installation requires root (including with autostart disabled).'
fi
DSH_INSTALL_ROOT=${DSH_INSTALL_ROOT:-/opt/ds-harness-remote}
DSH_SYSTEMD_DIR=${DSH_SYSTEMD_DIR:-/etc/systemd/system}
[[ "$DSH_INSTALL_ROOT" = /* && "$DSH_SYSTEMD_DIR" = /* ]] || fail 'Installation and systemd directories must be absolute.'
autostart=0
if [[ "$os" = Linux ]]; then
  autostart=${DSH_REMOTE_AUTOSTART:-1}
  [[ "$autostart" = 0 || "$autostart" = 1 ]] || fail 'DSH_REMOTE_AUTOSTART must be 0 or 1.'
  [[ "${DSH_SERVICE_USER:-root}" = root ]] || fail 'Only DSH_SERVICE_USER=root is supported; nonroot ownership must be configured manually.'
  if [[ "$autostart" = 1 ]]; then
    command -v systemctl >/dev/null || fail 'systemctl is required; containers may set DSH_REMOTE_AUTOSTART=0.'
    systemctl show-environment >/dev/null 2>&1 || fail 'A running systemd system manager is required; containers may set DSH_REMOTE_AUTOSTART=0.'
    say 'WARNING: the managed service runs as root. Remote Host tools and terminals have root privileges. Web binds only to 127.0.0.1.'
  fi
fi
DSH_COMMAND=${DSH_COMMAND:-}
DSH_PROFILE=${DSH_PROFILE:-}
desktop_command=''
if [[ "$os" = Darwin ]]; then
  for candidate in "$HOME/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'; do
    if [[ -x "$candidate" ]]; then desktop_command=$candidate; break; fi
  done
fi
if [[ -n "$DSH_COMMAND" ]]; then
  DSH_COMMAND=$(command -v "$DSH_COMMAND") || fail 'DSH_COMMAND was not found.'
elif [[ -n "$desktop_command" ]]; then
  DSH_COMMAND=$desktop_command
elif command -v dsh >/dev/null 2>&1; then
  DSH_COMMAND=$(command -v dsh)
elif [[ "$os" = Linux && -x "$DSH_INSTALL_ROOT/bin/dsh" ]]; then
  DSH_COMMAND=$DSH_INSTALL_ROOT/bin/dsh
elif [[ "$os" = Linux ]]; then
  for prerequisite in curl tar sha256sum; do command -v "$prerequisite" >/dev/null || fail "Required command missing: $prerequisite"; done
  case "$(uname -m)" in
    x86_64) arch=x64; sha=d57d6c28a35785f58f33899a0aa0bfc83f7a8ef4448b6cf3f7d0961efc7b9189 ;;
    aarch64|arm64) arch=arm64; sha=dab232a90169737a48149149dd6707e7fdcbaefbaa94b4871047a38e93db947f ;;
    *) fail 'Private Node bootstrap supports Linux x64 and arm64 only.' ;;
  esac
  version=${DSH_VERSION:-latest}
  [[ "$version" != -* && "$version" != *[[:space:]]* ]] || fail 'Invalid DSH_VERSION.'
  [[ ! -L "$DSH_INSTALL_ROOT" && ! -L "$DSH_INSTALL_ROOT/bin" ]] || fail 'Refusing symlinked runtime directories.'
  mkdir -p "$DSH_INSTALL_ROOT/bin"
  chmod 755 "$DSH_INSTALL_ROOT" "$DSH_INSTALL_ROOT/bin"
  runtime=$(mktemp -d "$DSH_INSTALL_ROOT/runtime.XXXXXXXX")
  say 'Installing private Node.js 24.9.0, Harness and pnpm (system runtime is unchanged).'
  archive=$runtime/node.tar.gz
  curl --fail --location --proto '=https' --tlsv1.2 --output "$archive" "https://nodejs.org/dist/v24.9.0/node-v24.9.0-linux-${arch}.tar.gz"
  printf '%s  %s\n' "$sha" "$archive" | sha256sum --check --status || fail 'Node archive checksum mismatch.'
  mkdir "$runtime/node"
  tar -xzf "$archive" --strip-components=1 -C "$runtime/node"
  PATH="$runtime/node/bin:$PATH" "$runtime/node/bin/npm" install --prefix "$runtime/harness" --engine-strict "@deepseek-ai/dsh@$version" pnpm@9.15.4
  DSH_COMMAND=$DSH_INSTALL_ROOT/bin/dsh
  [[ ! -e "$DSH_COMMAND" && ! -L "$DSH_COMMAND" ]] || fail 'Refusing to replace an existing runtime wrapper.'
  { printf '#!/usr/bin/env bash\n# ds-harness-remote managed private runtime\n'; printf 'export PATH=%q:"$PATH"\n' "$runtime/node/bin:$runtime/harness/node_modules/.bin"; printf 'exec %q "$@"\n' "$runtime/harness/node_modules/.bin/dsh"; } > "$DSH_COMMAND"
  chmod 755 "$DSH_COMMAND"
else
  fail "No existing dsh command found. Install via Desktop Extensions / Plugin management (https://github.com/liguobao/ds-harness-remote), or enable Desktop's official dsh launcher."
fi
# plugin exec changes cwd; service ExecStart must also use an absolute executable.
if [[ "$DSH_COMMAND" != /* ]]; then DSH_COMMAND="$(pwd -P)/$DSH_COMMAND"; fi
[[ -f "$DSH_COMMAND" && -x "$DSH_COMMAND" ]] || fail 'DSH_COMMAND must resolve to an executable file.'
if [[ -z "$DSH_PROFILE" ]]; then
  case "$DSH_COMMAND" in
    */runtime/cli/bin/dsh) DSH_PROFILE=desktop ;;
    *) if [[ -n "$desktop_command" ]] && cmp -s "$DSH_COMMAND" "$desktop_command"; then DSH_PROFILE=desktop; else DSH_PROFILE=web; fi ;;
  esac
fi
[[ "$DSH_PROFILE" =~ ^[A-Za-z0-9_-]+$ ]] || fail 'Invalid DSH_PROFILE.'
REMOTE_VERSION=${REMOTE_VERSION:-latest}
[[ "$REMOTE_VERSION" != -* && "$REMOTE_VERSION" != *[[:space:]]* ]] || fail 'Invalid REMOTE_VERSION.'
# Optional companion: Intelligent UI renders natively in the Remote clients.
INTELLIGENT_UI=${INTELLIGENT_UI:-0}
[[ "$INTELLIGENT_UI" = 0 || "$INTELLIGENT_UI" = 1 ]] || fail 'INTELLIGENT_UI must be 0 or 1.'
INTELLIGENT_UI_VERSION=${INTELLIGENT_UI_VERSION:-latest}
[[ "$INTELLIGENT_UI_VERSION" != -* && "$INTELLIGENT_UI_VERSION" != *[[:space:]]* ]] || fail 'Invalid INTELLIGENT_UI_VERSION.'
# This helper runs in the actual profile package directory with its own Node.
# !!js is represented as inert data, never evaluated.
# Avoid command-substitution heredoc parsing bugs in macOS Bash 3.2. read
# preserves the helper literally and returns nonzero at EOF (there is no NUL).
IFS= read -r -d '' helper <<'NODE' || :
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { execFileSync, spawnSync } = require('node:child_process');
function abort(message) { const error = new Error(message); error.installerSafe = true; throw error; }
(async () => {
  const [command, profile, mode, autostart, systemdDir] = process.argv.slice(1);
  const req = createRequire(path.join(process.cwd(), 'package.json'));
  const home = fs.realpathSync(path.resolve(process.cwd(), '../..'));
  if (path.basename(process.cwd()) !== profile || path.basename(path.dirname(process.cwd())) !== 'profiles') abort('Unexpected profile working directory');
  process.env.DSH_HOME = home;
  const unit = `ds-harness-remote-${profile}.service`;
  const unitPath = path.join(systemdDir, unit);
  const marker = `# ds-harness-remote managed home=${JSON.stringify(home)}`;
  function checkOwner() {
    // A renamed service must not leave our old Host running against the legacy
    // credentials while the new package migrates them. Never stop unknown units.
    const legacyUnit = `dsh-remote-${profile}.service`;
    const legacyPath = path.join(systemdDir, legacyUnit);
    let legacy; try { legacy = fs.lstatSync(legacyPath); } catch(e) { if(e.code !== 'ENOENT') throw e; }
    if (legacy?.isFile() && !legacy.isSymbolicLink() && fs.readFileSync(legacyPath, 'utf8').split('\n').includes(`# dsh-remote managed home=${JSON.stringify(home)}`)) {
      const active = spawnSync('systemctl', ['is-active', '--quiet', legacyUnit]);
      const enabled = spawnSync('systemctl', ['is-enabled', '--quiet', legacyUnit]);
      if (active.error || enabled.error || ![0, 3, 4].includes(active.status) || ![0, 1, 3, 4].includes(enabled.status)) abort('Could not inspect the old managed Remote service; no migration was attempted');
      if (active.status === 0 || enabled.status === 0) abort(`Stop and disable the old managed service before upgrading: systemctl disable --now ${legacyUnit}`);
    }
    let st; try { st = fs.lstatSync(unitPath); } catch(e) { if(e.code !== 'ENOENT') throw e; }
    if (st && (!st.isFile() || st.isSymbolicLink() || !fs.readFileSync(unitPath, 'utf8').split('\n').includes(marker))) abort('Refusing unmanaged, symlinked or other-home systemd unit; inspect it, stop/disable it and migrate manually, or set DSH_REMOTE_AUTOSTART=0');
    const fragment = execFileSync('systemctl', ['show', unit, '--property=FragmentPath', '--value'], {encoding:'utf8'}).trim();
    if (fragment && (!st || fragment !== unitPath)) abort('Refusing another systemd unit with this name');
  }
  if (autostart === '1') checkOwner();
  if (mode === 'owner') return;
  const pkgPath = req.resolve('ds-harness-remote/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const entry = pkg.exports?.['.']?.import || pkg.main;
  if (typeof entry !== 'string') abort('Remote package has no import entry');
  const remote = await import(pathToFileURL(path.resolve(path.dirname(pkgPath), entry)).href);
  const pluginReq = createRequire(pkgPath);
  const cordisReq = createRequire(pluginReq.resolve('@deepseek-ai/cordis/package.json'));
  const includeReq = createRequire(cordisReq.resolve('@deepseek-ai/cordis-plugin-include/package.json'));
  const yaml = includeReq('js-yaml');
  class Expression { constructor(source) { this.source = source; } }
  const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', {kind:'scalar', construct: source => new Expression(source)})]);
  const dump = execFileSync(command, ['--profile', profile, '--dump-config'], {encoding:'utf8', stdio:['ignore','pipe','pipe']});
  const tree = yaml.load(dump, {schema});
  const entries = [];
  function walk(nodes, uncertain=false, disabled=false) {
    if (!Array.isArray(nodes)) abort('Unexpected composed configuration');
    for (const node of nodes) {
      if (!node || typeof node !== 'object') abort('Invalid profile entry');
      const unknown = uncertain || (node.disabled !== undefined && typeof node.disabled !== 'boolean');
      const off = disabled || node.disabled === true;
      entries.push({node, uncertain:unknown, ancestorUncertain:uncertain, off});
      if(node.children) walk(node.children, unknown, off);
      if(Array.isArray(node.config)) walk(node.config, unknown, off);
    }
  }
  walk(tree);
  // The bundle inserts exactly one static Host entry in this release (dsh-TUI
  // integration is deferred, so no complementary terminal row exists).
  const remotes = entries.filter(e => e.node.name === 'ds-harness-remote' && !e.off && !e.uncertain);
  if (remotes.length !== 1) abort('Remote configuration is missing, ambiguous or dynamically enabled');
  const input = remotes[0].node.config || {};
  function staticValue(value) { if(value instanceof Expression) abort('Dynamic Remote configuration is unsupported'); if(value && typeof value === 'object') Object.values(value).forEach(staticValue); }
  staticValue(input);
  const config = remote.resolveConfig(input);
  if (!config.enabled || config.role !== 'host' || !config.serverUrl || !config.hostControl?.enabled) abort('Remote must enable Host, serverUrl and hostControl');
  if (autostart === '1') {
    const required = ['@deepseek-ai/dsh-web-app/startup','@deepseek-ai/dsh-host-webserver','@deepseek-ai/dsh-web-app'];
    for (const name of required) if(entries.filter(e => e.node.name === name && !e.off && !e.uncertain).length !== 1) abort('Autostart requires statically active official Web startup, webserver and app');
    if(entries.some(e => !e.off && (e.uncertain && required.includes(e.node.name) || /(?:^|\/)(?:dsh-tui|dsh-headless|dsh-sdk)(?:$|\/)|(?:tui|headless|sdk).*startup/.test(e.node.name || '')))) abort('Mixed or uncertain startup is unsupported');
  }
  if (mode === 'preflight') return;
  if (mode === 'register') {
    const token = fs.readFileSync(0, 'utf8').trim();
    const root = typeof remote.prepareDefaultIdentityDirectory === 'function'
      ? await remote.prepareDefaultIdentityDirectory() : new remote.IdentityStore().directory;
    const directory = remote.serverStorageDirectory(root, config.serverUrl, 'host');
    const identity = await new remote.IdentityStore({directory}).loadOrCreate(config.deviceName);
    const store = new remote.ServerCredentialStore(directory);
    if(typeof store.withRefreshLock !== 'function') abort('Remote version lacks credential locking');
    await store.withRefreshLock(async () => {
      let credentialsExist = false;
      try { fs.lstatSync(store.path); credentialsExist = true; } catch(error) { if(error.code !== 'ENOENT') throw error; }
      if (credentialsExist) {
        if(token) abort('Host credentials already exist; stop Harness and sign out before registering again');
        if(!await store.load(config.serverUrl, identity.deviceId)) abort('Existing credentials do not match this Host identity');
        process.stdout.write('Existing Host credentials preserved.\n'); return;
      }
      if(!token) { process.stdout.write('No Token supplied; sign in using Remote before expecting Host connectivity.\n'); return; }
      await new remote.HostServerApi(config.serverUrl, store).authorizeHostWithCode(identity, token);
      process.stdout.write('Host registration completed.\n');
    });
    return;
  }
  if (mode !== 'service') abort('Invalid helper mode');
  checkOwner();
  function quote(value, exec=false) {
    if(typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) abort('Unsafe service value');
    return '"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/%/g,'%%').replace(/\$/g, exec ? '$$$$' : '$')+'"';
  }
  const env = {HOME:process.env.HOME, DSH_HOME:home, PATH:process.env.PATH, DSH_REMOTE_SERVER:config.serverUrl, DSH_REMOTE_DEVICE_NAME:config.deviceName};
  for (const key of ['DSH_REMOTE_TERMINAL_ENABLED', 'DSH_REMOTE_CURSOR_BINARY', 'DSH_REMOTE_ACP_BINARY']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  // WorkingDirectory is a single raw path, not an ExecStart-style quoted word.
  // Reject paths the unit parser would trim or treat as line continuation.
  if(home.trim() !== home || /[\\\x00-\x1f\x7f]/.test(home)) abort('Unsupported service working directory');
  const workingDirectory = home.replace(/%/g, '%%');
  const contents = [marker,'[Unit]','Description=DeepSeek Harness Remote Host','After=network-online.target','Wants=network-online.target','[Service]','Type=simple','User=root',`WorkingDirectory=${workingDirectory}`,...Object.entries(env).map(([key,value])=>`Environment=${quote(key+'='+value)}`),`ExecStart=${[command,'--profile',profile,'--no-open','--host','127.0.0.1'].map(x=>quote(x,true)).join(' ')}`,'Restart=on-failure','RestartSec=5','StandardOutput=null','StandardError=null','[Install]','WantedBy=multi-user.target',''].join('\n');
  fs.mkdirSync(systemdDir, {recursive:true});
  // Refuse a link swap or concurrent fresh creation; never truncate before verifying.
  let previous;
  try { previous = fs.lstatSync(unitPath); } catch(error) { if(error.code !== 'ENOENT') throw error; }
  const flags = fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW | (previous ? 0 : fs.constants.O_CREAT | fs.constants.O_EXCL);
  const fd = fs.openSync(unitPath, flags, 0o644);
  try {
    const current = fs.fstatSync(fd);
    if(!current.isFile() || previous && (previous.dev !== current.dev || previous.ino !== current.ino)) abort('Service file changed during installation');
    if(previous) checkOwner();
    fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, contents);
    fs.fchmodSync(fd, 0o644);
  } finally { fs.closeSync(fd); }
  execFileSync('systemctl',['daemon-reload'],{stdio:'inherit'});
  execFileSync('systemctl',['enable',unit],{stdio:'inherit'});
  execFileSync('systemctl',['restart',unit],{stdio:'inherit'});
  execFileSync('systemctl',['is-active','--quiet',unit],{stdio:'inherit'});
  process.stdout.write(`Managed service ${unit} is active; Host online status has not been verified.\n`);
})().catch(error => {
  const message = error?.installerSafe ? error.message : 'Profile setup or registration failed; check dependencies, configuration and Token validity. No secret or server response is printed.';
  process.stderr.write('[dsh-plugin] ' + message + '\n'); process.exitCode=1;
});
NODE
run_helper() { "$DSH_COMMAND" plugin --profile "$DSH_PROFILE" exec node -e "$helper" "$DSH_COMMAND" "$DSH_PROFILE" "$1" "$autostart" "$DSH_SYSTEMD_DIR"; }
# Check service ownership before changing packages, then capabilities before redemption.
if [[ "$autostart" = 1 ]]; then run_helper owner; fi
say "Installing ds-harness-remote@${REMOTE_VERSION} into profile ${DSH_PROFILE} using ${DSH_COMMAND}"
"$DSH_COMMAND" plugin --profile "$DSH_PROFILE" add -w "ds-harness-remote@${REMOTE_VERSION}"
if [[ "$INTELLIGENT_UI" = 1 ]]; then
  # Same profile as Remote, before any service restart picks up the new bundles.
  say "Installing deepseek-harness-intelligent-ui@${INTELLIGENT_UI_VERSION} into profile ${DSH_PROFILE}"
  "$DSH_COMMAND" plugin --profile "$DSH_PROFILE" add -w "deepseek-harness-intelligent-ui@${INTELLIGENT_UI_VERSION}"
fi
if [[ -n "$explicit_token" || "$autostart" = 1 ]]; then
  run_helper preflight
  printf '%s' "$registration_token" | run_helper register
fi
unset registration_token
if [[ "$autostart" = 1 ]]; then
  run_helper service
else
  say 'Remote plugin installed. No service was changed; restart the selected Harness instance and use Remote to sign in if needed.'
fi
