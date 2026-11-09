import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HostIdentity } from '../src/identity-store.js'
import { IdentityStore } from '../src/identity-store.js'

const directories: string[] = []
const children: ChildProcess[] = []
let worker = ''
let scratch = ''

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'dsh-identity-lock-'))
  directories.push(scratch)
  const entry = join(scratch, 'identity-store.mjs')
  // The lock only means something across real processes, so the store is built
  // into a standalone module the workers below import.
  await build({
    entryPoints: [fileURLToPath(new URL('../src/identity-store.ts', import.meta.url))],
    outfile: entry, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  })
  worker = join(scratch, 'worker.mjs')
  await writeFile(worker, `
    import { IdentityStore } from ${JSON.stringify(pathToFileURL(entry).href)};
    const [directory, name] = process.argv.slice(2);
    process.stdout.write('ready\\n');
    const identity = await new IdentityStore({ directory }).loadOrCreate(name);
    process.stdout.write(JSON.stringify(identity) + '\\n');
  `)
})

afterAll(async () => {
  for (const child of children.splice(0)) child.kill()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('identity lock across processes', () => {
  it('settles two simultaneous first-time creations on one key pair', async () => {
    const directory = await temporaryDirectory()
    const first = startWorker(directory)
    const second = startWorker(directory)
    const created = await Promise.all([first.done, second.done])

    for (const identity of created) {
      expect(identity).toMatchObject({ deviceId: created[0]!.deviceId, publicKey: created[0]!.publicKey, privateKey: created[0]!.privateKey })
    }
    await expect(new IdentityStore({ directory }).loadOrCreate('Workstation')).resolves.toMatchObject({
      publicKey: created[0]!.publicKey, privateKey: created[0]!.privateKey,
    })
  })

  it('waits out a lock whose owner record has not landed yet instead of reclaiming it', async () => {
    const directory = await temporaryDirectory()
    const lock = join(directory, 'device.lock')
    // The window between the exclusive create and the pid write: the lock
    // exists, its record does not. Reclaiming it would admit a second creator
    // while the process that created it is still inside the critical section.
    await writeFile(lock, '')

    const contender = startWorker(directory)
    await contender.started
    await settle()
    expect(contender.child.exitCode).toBeNull()
    expect(await readFile(lock, 'utf8')).toBe('')
    expect(await readdir(directory)).toEqual(['device.lock'])

    await rm(lock, { force: true })
    await expect(contender.done).resolves.toMatchObject({ publicKey: expect.any(String) })
  })

  it('never takes over a live owner, however stale the lock looks', async () => {
    const directory = await temporaryDirectory()
    const lock = join(directory, 'device.lock')
    const owner = `${process.pid}\n`
    await writeFile(lock, owner)
    // Age is not evidence of abandonment: a suspended owner resumes and still
    // owns this file, so no contender may replace it under the old 60s rule.
    const aged = new Date(Date.now() - 6 * 60 * 60 * 1000)
    await utimes(lock, aged, aged)

    const contender = startWorker(directory)
    await contender.started
    await settle()
    expect(contender.child.exitCode).toBeNull()
    expect(await readFile(lock, 'utf8')).toBe(owner)

    // The resumed owner releases; the waiting process then proceeds, having
    // never created a lock the owner could have deleted on the way out.
    await rm(lock, { force: true })
    await expect(contender.done).resolves.toMatchObject({ publicKey: expect.any(String) })
    expect(await readFile(lock, 'utf8').catch(() => undefined)).toBeUndefined()
  })

  it('reclaims a lock whose owner died', async () => {
    const directory = await temporaryDirectory()
    await writeFile(join(directory, 'device.lock'), `${await deadPid()}\n`)

    await expect(new IdentityStore({ directory }).loadOrCreate('Workstation')).resolves.toMatchObject({
      publicKey: expect.any(String),
    })
    expect(await readdir(directory)).toEqual(['device.json', 'device.key', 'trusted-peers.json'])
  })

  it('reclaims once when two processes race for the same dead lock', async () => {
    const directory = await temporaryDirectory()
    await writeFile(join(directory, 'device.lock'), `${await deadPid()}\n`)

    const contenders = [startWorker(directory), startWorker(directory)]
    const created = await Promise.all(contenders.map(contender => contender.done))
    expect(created[1]).toMatchObject({ deviceId: created[0]!.deviceId, publicKey: created[0]!.publicKey })
    await expect(new IdentityStore({ directory }).loadOrCreate('Workstation')).resolves.toMatchObject({
      publicKey: created[0]!.publicKey, privateKey: created[0]!.privateKey,
    })
  })

  it('reclaims once when two processes race after an interrupted takeover left both device.lock and its real takeover claim', async () => {
    const directory = await temporaryDirectory()
    const lockRecord = `${await deadPid()}\n`
    const takeoverRecord = `${await deadPid()}\n`
    const takeoverName = `device.lock.takeover-${createHash('sha256').update(lockRecord).digest('hex').slice(0, 16)}`
    await writeFile(join(directory, 'device.lock'), lockRecord)
    await writeFile(join(directory, takeoverName), takeoverRecord)

    const contenders = [startWorker(directory), startWorker(directory)]
    const created = await Promise.all(contenders.map(contender => contender.done))
    expect(created[1]).toMatchObject({ deviceId: created[0]!.deviceId, publicKey: created[0]!.publicKey })
    expect((await readdir(directory)).sort()).toEqual(['device.json', 'device.key', 'trusted-peers.json'])
    await expect(new IdentityStore({ directory }).loadOrCreate('Workstation')).resolves.toMatchObject({
      publicKey: created[0]!.publicKey, privateKey: created[0]!.privateKey,
    })
  })

  it('keeps the pair consistent when a reset overlaps another process creating', async () => {
    const directory = await temporaryDirectory()
    const contender = startWorker(directory)
    const created = await new IdentityStore({ directory }).reset('Workstation')
    const workerIdentity = await contender.done

    const settled = await new IdentityStore({ directory }).loadOrCreate('Workstation')
    expect(settled.publicKey).toBe(created.publicKey)
    expect([created.deviceId, workerIdentity.deviceId]).toContain(settled.deviceId)
  })
})

function startWorker(directory: string, name = 'Workstation') {
  const child = spawn(process.execPath, [worker, directory, name], { stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let stdout = ''
  let stderr = ''
  let ready: () => void = () => undefined
  const started = new Promise<void>(resolve => { ready = resolve })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
    if (stdout.includes('ready\n')) ready()
  })
  child.stderr.on('data', (chunk: string) => { stderr += chunk })
  const done = new Promise<HostIdentity>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => {
      if (code !== 0) {
        reject(new Error(`identity worker exited with ${code}: ${stderr}`))
        return
      }
      try {
        resolve(JSON.parse(stdout.trim().split('\n').pop() ?? '') as HostIdentity)
      } catch {
        reject(new Error(`unexpected identity worker output: ${stdout}`))
      }
    })
  })
  return { child, started, done }
}

/** A pid that provably named a process which has since exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  const pid = child.pid!
  await new Promise<void>(resolve => child.once('exit', () => resolve()))
  return pid
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-identity-lock-'))
  directories.push(directory)
  return directory
}

/** Let a worker reach and contend for the lock before asserting on it. */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 400))
}
