import { lstat, opendir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkspaceUploadBudget } from './workspace-upload-budget.js'

const ORPHAN_UPLOAD_NAME = /^\.dsh-upload-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.part$/iu

export async function cleanOrphanUploads(root: string, dev: number, ino: number, budget: WorkspaceUploadBudget): Promise<void> {
  const now = Date.now()
  if (now - (budget.scannedRoots.get(root) ?? 0) < 60 * 60 * 1000) return
  const cutoff = now - 24 * 60 * 60 * 1000
  try {
    const entries = await opendir(root)
    for await (const { name } of entries) {
      if (!ORPHAN_UPLOAD_NAME.test(name)) continue
      const path = join(root, name)
      if (budget.activePaths.has(path)) continue
      try {
        const [directory, file] = await Promise.all([lstat(root), lstat(path)])
        if (!directory.isDirectory() || directory.dev !== dev || directory.ino !== ino
          || !file.isFile() || file.dev !== dev || file.nlink !== 1
          || file.uid !== process.geteuid?.() || (file.mode & 0o777) !== 0o600
          || file.mtimeMs > cutoff) continue
        await unlink(path)
      } catch { /* A changed entry is not safe to remove. */ }
    }
  } catch { /* A failed scan must not block an authorized upload. */ return }
  budget.scannedRoots.set(root, now)
  if (budget.scannedRoots.size > 1024) budget.scannedRoots.delete(budget.scannedRoots.keys().next().value!)
}
