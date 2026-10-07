import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const androidRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(androidRoot, '../..')

const [appConfig, packageMetadata, remoteGateway, alphaClient, codexClient, acpClient] = await Promise.all([
  readJson(resolve(androidRoot, 'app.json')),
  readJson(resolve(androidRoot, 'package.json')),
  readFile(resolve(repositoryRoot, 'packages/client-core/dist/remote-gateway.js'), 'utf8'),
  readFile(resolve(repositoryRoot, 'packages/client-core/dist/harness-alpha-client.js'), 'utf8'),
  readFile(resolve(repositoryRoot, 'packages/client-core/dist/codex-client.js'), 'utf8'),
  readFile(resolve(repositoryRoot, 'packages/client-core/dist/acp-client.js'), 'utf8'),
])

const appVersion = appConfig?.expo?.version
if (typeof appVersion !== 'string' || appVersion.length === 0) {
  throw new Error('apps/android/app.json must define expo.version.')
}
if (packageMetadata?.version !== appVersion) {
  throw new Error(
    `Android version mismatch: package.json=${String(packageMetadata?.version)} app.json=${appVersion}`,
  )
}

for (const marker of ['harness.api.v1', 'harness.remote.v1', 'harness.remote.call']) {
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

console.log(`Android workspace data planes verified: rc.2 ApiProxy + v0.1.2 Typert Remote + CodeX Remote + Agent ACP (${appVersion})`)

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}
