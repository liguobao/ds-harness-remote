import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, realpath, readFile, symlink, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stageAgyImages, readAgyImage, agyImagePrompt, agyImageReferences, stripAgyImageReferences } from '../src/acp/adapters/antigravity/image-store.js'
import { parseAcpImage } from '../src/acp/image-content.js'
import { parseAcpCall } from '../src/acp/method-policy.js'

const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
const image = parseAcpImage({ type: 'image', mimeType: 'image/png', data })
describe('AGY temporary image attachments', () => {
  it('validates size, MIME, canonical base64, and image count before accepting a prompt', () => {
    expect(parseAcpCall('session/prompt', { sessionId: 'session', backend: 'antigravity', prompt: [image] }).method).toBe('session/prompt')
    for (const candidate of [{ ...image, mimeType: 'image/jpeg' }, { ...image, data: 'AAAA' }, { ...image, data: data.slice(0, -1) }, { ...image, data: 'A'.repeat(12 * 1024 * 1024) }]) expect(() => parseAcpImage(candidate)).toThrow()
    expect(() => parseAcpCall('session/prompt', { sessionId: 'session', prompt: Array(5).fill(image) })).toThrow()
  })

  it('stages private files, restores referenced images, isolates sessions and expires files', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'agy-image-test-')))
    try {
      const [path] = await stageAgyImages('session-a', [image], root)
      expect((await readFile(path!)).toString('base64')).toBe(data)
      const prompt = agyImagePrompt('Inspect this', [path!])
      expect(agyImageReferences(prompt)).toEqual([path])
      expect(stripAgyImageReferences(prompt)).toBe('Inspect this')
      expect(await readAgyImage('session-a', path!, root)).toMatchObject({ type: 'image', data })
      expect(await readAgyImage('session-b', path!, root)).toBeUndefined()
      expect(await readAgyImage('session-a', join(root, '..', 'secret.png'), root)).toBeUndefined()
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
      await utimes(path!, old, old)
      expect(await readAgyImage('session-a', path!, root)).toBeUndefined()
      await stageAgyImages('session-a', [image], root)
      await expect(readFile(path!)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('rejects symlinked cache roots and image files', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'agy-symlink-test-')))
    try {
      const root = join(base, 'root')
      const [path] = await stageAgyImages('session', [image], root)
      await symlink(root, join(base, 'alias'))
      await expect(stageAgyImages('session', [image], join(base, 'alias'))).rejects.toThrow()
      await rm(path!)
      await symlink(join(base, 'secret'), path!)
      expect(await readAgyImage('session', path!, root)).toBeUndefined()
    } finally { await rm(base, { recursive: true, force: true }) }
  })
})
