import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const pluginManifest = JSON.parse(readFileSync(join(root, 'packages/plugin/package.json'), 'utf8'))
const componentManifest = JSON.parse(readFileSync(join(root, 'dsh-plugin.json'), 'utf8'))
const pluginComponentManifest = JSON.parse(readFileSync(join(root, 'packages/plugin/dsh-plugin.json'), 'utf8'))

assert.equal(manifest.name, 'ds-harness-remote', 'root package must use the canonical DSH installation id')
assert.equal(pluginManifest.name, manifest.name, 'root and npm plugin package ids must stay unified')
assert.equal(componentManifest.name, manifest.name, 'root Component manifest must use the canonical plugin id')
assert.equal(pluginComponentManifest.name, pluginManifest.name, 'npm Component manifest must use the canonical plugin id')
assert.equal(componentManifest.version, manifest.version, 'root Component manifest version must match package.json')
assert.equal(pluginComponentManifest.version, pluginManifest.version, 'npm Component manifest version must match package.json')
assert.equal(componentManifest.facets?.host?.entry, 'index.js', 'root Component manifest must expose the GitHub Host entry')
assert.equal(pluginComponentManifest.facets?.host?.entry, 'dist/index.js', 'npm Component manifest must expose the npm Host entry')
assert.ok(
  componentManifest.contributes?.commands?.some(command => command.id === 'ds-harness.remote'),
  'root Component manifest must declare the /remote command',
)
assert.equal(pluginManifest.description, manifest.description, 'root and npm package descriptions must stay unified')
assert.deepEqual(pluginManifest.keywords, manifest.keywords, 'root and npm package keywords must stay unified')
assert.equal(pluginManifest.homepage, manifest.homepage, 'root and npm package homepages must stay unified')
assert.deepEqual(pluginManifest.repository, manifest.repository, 'root and npm package repositories must stay unified')
assert.deepEqual(pluginManifest.bugs, manifest.bugs, 'root and npm package issue trackers must stay unified')
assert.equal(pluginManifest.author, manifest.author, 'root and npm package authors must stay unified')
assert.equal(pluginManifest.license, manifest.license, 'root and npm package licenses must stay unified')
assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml', 'root package must declare a DSH bundle patch')
assert.equal(manifest.dsh?.client?.platform, 'web', 'root package must declare its browser client face')
assert.ok(
  manifest.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-settings-plugins'),
  'root browser client must load after the official plugin settings surface',
)
assert.equal(manifest.main, './index.js', 'root package must expose a prebuilt Host entry at package root')
assert.equal(
  manifest.bin?.['ds-harness-remote'],
  './packages/plugin/bin/ds-harness-remote.js',
  'root package must expose the TUI-compatible Remote CLI',
)
assert.equal(manifest.bin?.remote, undefined, 'root package must not install a standalone remote executable')
assert.equal(
  pluginManifest.bin?.['ds-harness-remote'],
  './bin/ds-harness-remote.js',
  'npm plugin package must expose the Remote CLI',
)
assert.equal(pluginManifest.bin?.remote, undefined, 'npm package must not install a standalone remote executable')
assert.equal(manifest.exports?.['./client'], './packages/plugin/dist/client.github.js', 'root package must export the GitHub-root browser client entry')

for (const file of [
  'index.js',
  'dsh-plugin.json',
  'cordis.patch.yml',
  'packages/plugin/dsh-plugin.json',
  'packages/plugin/dist/index.js',
  'packages/plugin/dist/client.github.js',
  'packages/plugin/public.d.ts',
  'packages/plugin/bin/ds-harness-remote.js',
]) {
  assert.ok(existsSync(join(root, file)), `DSH plugin artifact is missing: ${file}`)
}

const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
assert.match(patch, /^\s*- id:\s*ds-harness-remote\s*$/m, 'root patch must use the canonical Cordis instance id')
assert.match(
  patch,
  new RegExp(`name:\\s*['"]?${manifest.name.replaceAll('-', '\\-')}['"]?`),
  'root patch must load the installed GitHub root package',
)
assert.match(
  patch,
  /inject:\s*\[settings, typertGateway, commands, tuiCommandTrees, tuiScenes\]/,
  'root patch must expose dsh-TUI command and scene services to the Host plugin',
)

const rootHostEntry = readFileSync(join(root, 'index.js'), 'utf8')
assert.match(rootHostEntry, /packages\/plugin\/dist\/index\.js/, 'root Host entry must forward to the committed bundle')

const publicTypes = readFileSync(join(root, 'packages/plugin/public.d.ts'), 'utf8')
assert.match(publicTypes, /name:\s*'ds-harness-remote'/, 'public types must expose the canonical plugin id')

const hostBundle = readFileSync(join(root, 'packages/plugin/dist/index.js'), 'utf8')
assert.doesNotMatch(hostBundle, /(?:from\s+|require\()['\"]@dsh-remote\//, 'Host bundle must not import unpublished workspace packages')
assert.match(hostBundle, /name:\s*["']remote["']/, 'Host bundle must register the dsh-TUI /remote command')
assert.doesNotMatch(
  hostBundle,
  /\bsettingsNamespace\b/,
  'Host bundle must not import the settingsNamespace helper removed by DSH alpha.2',
)

const clientBundle = readFileSync(join(root, 'packages/plugin/dist/client.github.js'), 'utf8')
assert.match(clientBundle, /window\.__ModuleLoader__\.load/, 'browser client entry must register with the DSH module loader')
assert.match(clientBundle, /status\.events/, 'browser client must open the Host status event stream')
assert.match(clientBundle, /new EventSource/, 'browser client must push-render Host status through EventSource')
assert.match(clientBundle, /useSyncExternalStore/, 'browser client must render Host status from the pushed stream')
assert.doesNotMatch(
  clientBundle,
  /setInterval\(refresh/,
  'browser client must not poll the loopback status endpoint on a fixed interval',
)
assert.match(clientBundle, /localeNamespace\s*=\s*"ds-harness-remote"/, 'browser client locale namespace must use the canonical plugin id')
assert.match(clientBundle, /plugins\.row\.config/, 'browser client must contribute its options to the RC1 plugin row config surface')
assert.match(clientBundle, /plugins\.bundle\.config/, 'browser client must keep contributing to the installed-bundle config surface')
assert.doesNotMatch(
  clientBundle,
  /settings\.plugin\.item/,
  'browser client must not target the settings.plugin.item slot retired in DSH 0.1.7-rc.1',
)
assert.ok(
  clientBundle.includes('DeepSeek 远程连接') || clientBundle.includes('DeepSeek \\u8FDC\\u7A0B\\u8FDE\\u63A5'),
  'browser client must expose the Chinese plugin name',
)
assert.doesNotMatch(clientBundle, /settings\.plugins\.tab/, 'browser client must not create a separate plugin settings tab')
assert.doesNotMatch(clientBundle, /require\(["']qrcode["']\)/, 'browser client must inline its QR encoder')

let githubClient
runInNewContext(clientBundle, {
  window: { __ModuleLoader__: { load: handoff => { githubClient = handoff } } },
})
assert.equal(githubClient?.id, manifest.name, 'browser client module id must match the GitHub root package name')
assert.equal(typeof githubClient?.factory, 'function', 'browser client entry must register a factory')

const npmClientBundle = readFileSync(join(root, 'packages/plugin/dist/client.js'), 'utf8')
let npmClient
runInNewContext(npmClientBundle, {
  window: { __ModuleLoader__: { load: handoff => { npmClient = handoff } } },
})
assert.equal(npmClient?.id, pluginManifest.name, 'npm client module id must match the nested package name')

console.log(`Verified DSH bundle package ${manifest.name}@${manifest.version}`)
