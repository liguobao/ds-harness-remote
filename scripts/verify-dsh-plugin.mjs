import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
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
assert.equal(pluginManifest.version, manifest.version, 'root and npm plugin versions must stay unified')
assert.equal(componentManifest.name, manifest.name, 'root Component manifest must use the canonical plugin id')
assert.equal(pluginComponentManifest.name, pluginManifest.name, 'npm Component manifest must use the canonical plugin id')
assert.equal(componentManifest.version, manifest.version, 'root Component manifest version must match package.json')
assert.equal(pluginComponentManifest.version, pluginManifest.version, 'npm Component manifest version must match package.json')
assert.equal(componentManifest.facets?.host?.entry, 'index.js', 'root Component manifest must expose the GitHub Host entry')
assert.equal(pluginComponentManifest.facets?.host?.entry, 'dist/index.js', 'npm Component manifest must expose the npm Host entry')
for (const [label, component] of [['root', componentManifest], ['npm', pluginComponentManifest]]) {
  assert.equal(
    component.requires,
    undefined,
    `${label} Component manifest must not require terminal command contracts (dsh-TUI support is deferred)`,
  )
  assert.equal(
    component.contributes?.commands,
    undefined,
    `${label} Component manifest must not declare the retired /remote command`,
  )
}
assert.equal(pluginManifest.description, manifest.description, 'root and npm package descriptions must stay unified')
assert.deepEqual(pluginManifest.keywords, manifest.keywords, 'root and npm package keywords must stay unified')
assert.equal(pluginManifest.homepage, manifest.homepage, 'root and npm package homepages must stay unified')
const { directory: pluginRepositoryDirectory, ...pluginRepository } = pluginManifest.repository
assert.deepEqual(pluginRepository, manifest.repository, 'root and npm package repositories must stay unified')
assert.equal(pluginRepositoryDirectory, 'packages/plugin', 'npm package must identify its source directory within the repository')
assert.deepEqual(pluginManifest.bugs, manifest.bugs, 'root and npm package issue trackers must stay unified')
assert.equal(pluginManifest.author, manifest.author, 'root and npm package authors must stay unified')
assert.equal(pluginManifest.license, manifest.license, 'root and npm package licenses must stay unified')
assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml', 'root package must declare a DSH bundle patch')
assert.equal(manifest.dsh?.client?.platform, 'web', 'root package must declare its browser client face')
assert.deepEqual(pluginManifest.dsh?.client, manifest.dsh?.client, 'root and npm dsh.client metadata must stay unified')
const canonicalDshPeerRange = manifest.peerDependencies?.['@deepseek-ai/dsh-api-gateway']
assert.ok(typeof canonicalDshPeerRange === 'string' && canonicalDshPeerRange.trim().length > 0, 'root manifest must declare canonical DSH peer range')
const clientInjectSet = new Set(manifest.dsh?.client?.inject ?? [])
for (const [label, pkgManifest] of [['root', manifest], ['npm', pluginManifest]]) {
  const clientInject = pkgManifest.dsh?.client?.inject ?? []
  for (const injectedPackage of clientInject) {
    assert.equal(
      pkgManifest.peerDependencies?.[injectedPackage],
      canonicalDshPeerRange,
      `${label} manifest must align dsh.client.inject entry ${injectedPackage} peer range with DSH core`,
    )
    assert.equal(
      pkgManifest.peerDependenciesMeta?.[injectedPackage]?.optional,
      true,
      `${label} manifest must mark dsh.client.inject entry ${injectedPackage} optional in peerDependenciesMeta`,
    )
  }
  for (const [peer, meta] of Object.entries(pkgManifest.peerDependenciesMeta ?? {})) {
    if (!clientInjectSet.has(peer) && meta?.optional === true) {
      assert.fail(`${label} manifest must not mark required peer ${peer} optional`)
    }
  }
}
assert.ok(
  manifest.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-plugin-manager'),
  'root browser client must load after the official plugin settings surface',
)
assert.equal(manifest.main, './index.js', 'root package must expose a prebuilt Host entry at package root')
assert.equal(
  manifest.bin?.['ds-harness-remote'],
  './packages/plugin/bin/ds-harness-remote.js',
  'root package must expose the Remote CLI',
)
assert.equal(manifest.bin?.remote, undefined, 'root package must not install a standalone remote executable')
assert.equal(
  pluginManifest.bin?.['ds-harness-remote'],
  './bin/ds-harness-remote.js',
  'npm plugin package must expose the Remote CLI',
)
assert.equal(pluginManifest.bin?.remote, undefined, 'npm package must not install a standalone remote executable')
assert.equal(manifest.exports?.['./client'], './packages/plugin/dist/client.github.js', 'root package must export the GitHub-root browser client entry')

assert.ok(Array.isArray(pluginManifest.files), 'npm plugin package must declare an explicit files allowlist')
const normalizedPluginFiles = pluginManifest.files.map(entry => entry.replace(/^\.\//, ''))
assert.ok(normalizedPluginFiles.includes('dist/index.js'), 'npm plugin files allowlist must include dist/index.js')
assert.ok(normalizedPluginFiles.includes('dist/client.js'), 'npm plugin files allowlist must include dist/client.js')
for (const forbiddenEntry of ['dist', 'dist/', 'dist/*', 'dist/**', 'dist/client.github.js']) {
  assert.ok(
    !normalizedPluginFiles.includes(forbiddenEntry),
    `npm plugin files allowlist must not include ${forbiddenEntry}`,
  )
}
for (const entry of normalizedPluginFiles) {
  if (!entry.startsWith('!') && entry.startsWith('dist/')) {
    assert.ok(
      entry === 'dist/index.js' || entry === 'dist/client.js',
      `npm plugin files allowlist must not include unexpected dist entry: ${entry}`,
    )
  }
}

for (const [packageRoot, packageManifest] of [[root, manifest], [join(root, 'packages/plugin'), pluginManifest]]) {
  const require = createRequire(join(packageRoot, 'package.json'))
  assert.equal(
    require.resolve(packageManifest.name),
    join(packageRoot, packageManifest.main),
    'DSH CJS-style discovery must resolve the Host entry for both GitHub and npm installations',
  )
}

for (const file of [
  'index.js',
  'dsh-plugin.json',
  'cordis.patch.yml',
  'packages/plugin/dsh-plugin.json',
  'packages/plugin/dist/index.js',
  'packages/plugin/dist/client.js',
  'packages/plugin/dist/client.github.js',
  'packages/plugin/public.d.ts',
  'packages/plugin/bin/ds-harness-remote.js',
]) {
  assert.ok(existsSync(join(root, file)), `DSH plugin artifact is missing: ${file}`)
}

const allowedDistEntries = new Set(['index.js', 'index.js.map', 'client.js', 'client.github.js'])
const distEntries = readdirSync(join(root, 'packages/plugin/dist')).sort()
assert.deepEqual(
  distEntries.filter(entry => !allowedDistEntries.has(entry)),
  [],
  'packages/plugin/dist must not contain stale or unbundled compiler outputs',
)

const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
assert.match(patch, /^\s*- id:\s*ds-harness-remote\s*$/m, 'root patch must use the canonical Cordis instance id')
assert.match(
  patch,
  new RegExp(`name:\\s*['"]?${manifest.name.replaceAll('-', '\\-')}['"]?`),
  'root patch must load the installed GitHub root package',
)
assert.match(
  patch,
  /inject:\s*(?:-\s*webServer|\[.*?webServer.*?\])/,
  'root patch must declare the webServer service for host control',
)

assert.doesNotMatch(patch, /ds-harness-remote-tui/, 'root patch must not insert the retired dsh-TUI Host entry')
assert.doesNotMatch(patch, /!!js/, 'root patch must stay static while dsh-TUI integration is deferred')

const npmPatch = readFileSync(join(root, 'packages/plugin/cordis.patch.yml'), 'utf8')
assert.match(npmPatch, /inject:\s*(?:-\s*webServer|\[.*?webServer.*?\])/, 'npm patch must declare the webServer service for host control')
assert.doesNotMatch(npmPatch, /ds-harness-remote-tui/, 'npm patch must not insert the retired dsh-TUI Host entry')
assert.doesNotMatch(npmPatch, /!!js/, 'npm patch must stay static while dsh-TUI integration is deferred')

const rootHostEntry = readFileSync(join(root, 'index.js'), 'utf8')
assert.match(rootHostEntry, /packages\/plugin\/dist\/index\.js/, 'root Host entry must forward to the committed bundle')

const publicTypes = readFileSync(join(root, 'packages/plugin/public.d.ts'), 'utf8')
assert.match(publicTypes, /name:\s*'ds-harness-remote'/, 'public types must expose the canonical plugin id')

const unpublishedWorkspaceImportPattern =
  /(?:\bfrom\s+|\b(?:import|require)\s*\(\s*)['"]@dsh-remote\/|^\s*(?:import|export)\s+['"]@dsh-remote\//m

const hostBundle = readFileSync(join(root, 'packages/plugin/dist/index.js'), 'utf8')
assert.doesNotMatch(hostBundle, unpublishedWorkspaceImportPattern, 'Host bundle must not import unpublished workspace packages')
assert.doesNotMatch(
  hostBundle,
  /tuiScenes|tuiCommandTrees|ds-harness-remote-tui/,
  'Host bundle must not reference dsh-TUI services or the retired terminal entry',
)
assert.doesNotMatch(
  hostBundle,
  /(?:from\s+|require\()["']ws["']/,
  'Host bundle must inline its WebSocket dependency so a node_modules-free installation still loads',
)
assert.doesNotMatch(
  hostBundle,
  /(?:from\s+|require\()["']qrcode["']/,
  'Host bundle must inline its terminal QR encoder',
)
assert.doesNotMatch(
  hostBundle,
  /(?:from\s+|require\()["']@deepseek-ai\/schemastery["']/,
  'Host bundle must inline its config schema library so bundle-only installations load',
)
assert.deepEqual(
  [...hostBundle.matchAll(/^import\s[^;]*?from\s+"([^".][^"]*)"/gm)]
    .map(match => match[1])
    .filter(specifier => !isBuiltin(specifier))
    .filter(specifier => !specifier.startsWith('node:')),
  [],
  'Host bundle must inline all runtime packages; the optional Connection peer is loaded lazily so node_modules-free installs load',
)
assert.doesNotMatch(
  hostBundle,
  /\bsettingsNamespace\b/,
  'Host bundle must not import the settingsNamespace helper removed by DSH alpha.2',
)

const clientBundle = readFileSync(join(root, 'packages/plugin/dist/client.github.js'), 'utf8')
assert.doesNotMatch(
  clientBundle,
  unpublishedWorkspaceImportPattern,
  'GitHub browser client bundle must not import unpublished workspace packages',
)
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
assert.doesNotMatch(
  npmClientBundle,
  unpublishedWorkspaceImportPattern,
  'npm browser client bundle must not import unpublished workspace packages',
)
let npmClient
runInNewContext(npmClientBundle, {
  window: { __ModuleLoader__: { load: handoff => { npmClient = handoff } } },
})
assert.equal(npmClient?.id, pluginManifest.name, 'npm client module id must match the nested package name')

console.log(`Verified DSH bundle package ${manifest.name}@${manifest.version}`)
