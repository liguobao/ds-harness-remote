// Verifies the compiled client-core data planes the app depends on, and the
// version coupling of whichever app package invokes it.
//
// The shared source now lives in packages/app-core while the Expo configuration
// (app.json) stays per app, so the app root is passed in rather than derived
// from this file's location:
//
//   node ../../packages/app-core/scripts/verify-workspace-data-planes.mjs "$PWD"
//
// With no argument it verifies only the client-core markers, which is the
// correct behaviour when running the shared package's own checks.
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const appRoot = process.argv[2] ? resolve(process.argv[2]) : undefined

const [remoteGateway, alphaClient, codexClient, acpClient] = await Promise.all([
  readFile(resolve(repositoryRoot, 'packages/client-core/dist/remote-gateway.js'), 'utf8'),
  readFile(resolve(repositoryRoot, 'packages/client-core/dist/harness-alpha-client.js'), 'utf8'),
  readFile(resolve(repositoryRoot, 'packages/client-core/dist/codex-client.js'), 'utf8'),
  readFile(resolve(repositoryRoot, 'packages/client-core/dist/acp-client.js'), 'utf8'),
])

for (const marker of ['harness.remote.v1', 'harness.remote.call']) {
  if (!remoteGateway.includes(marker)) {
    throw new Error(`Compiled client-core is stale or incomplete: missing ${marker}.`)
  }
}
if (!alphaClient.includes('HarnessAlphaClient')) {
  throw new Error('Compiled client-core is stale or incomplete: missing HarnessAlphaClient.')
}
for (const marker of ['CodexRemoteClient', 'codex.app.call', 'codex.app.stream.open', 'codex.app.transfer.open']) {
  if (!codexClient.includes(marker)) {
    throw new Error(`Compiled client-core is stale or incomplete: missing ${marker}.`)
  }
}
for (const marker of ['AgentAcpClient', 'agent.acp.call', 'agent.acp.stream.open', 'agent.acp.transfer.open']) {
  if (!acpClient.includes(marker)) throw new Error(`Compiled client-core is stale or incomplete: missing ${marker}.`)
}

if (!appRoot) {
  console.log('Shared data planes verified: Typert Remote + CodeX Remote + Agent ACP')
  process.exit(0)
}

const appName = appRoot.slice(repositoryRoot.length + 1) || appRoot
const [appConfig, packageMetadata] = await Promise.all([
  readJson(resolve(appRoot, 'app.json')),
  readJson(resolve(appRoot, 'package.json')),
])

const appVersion = appConfig?.expo?.version
if (typeof appVersion !== 'string' || appVersion.length === 0) {
  throw new Error(`${appName}/app.json must define expo.version.`)
}
if (packageMetadata?.version !== appVersion) {
  throw new Error(
    `${appName} version mismatch: package.json=${String(packageMetadata?.version)} app.json=${appVersion}`,
  )
}

console.log(`${appName} workspace data planes verified: Typert Remote + CodeX Remote + Agent ACP (${appVersion})`)

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}
