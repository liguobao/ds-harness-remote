import { beforeEach, describe, expect, it, vi } from 'vitest'
const fs = vi.hoisted(() => ({
  requestDirectoryPermissionsAsync: vi.fn(), createFileAsync: vi.fn(), writeAsStringAsync: vi.fn(),
}))
vi.mock('expo-file-system/legacy', () => ({ StorageAccessFramework: fs, writeAsStringAsync: fs.writeAsStringAsync }))
import { exportConnectionLog } from '../src/services/export-connection-log'

describe('connection log export', () => {
  beforeEach(() => vi.resetAllMocks())
  it('does not create a file when the picker is cancelled', async () => {
    fs.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: false })
    expect(await exportConnectionLog()).toBe(false)
    expect(fs.createFileAsync).not.toHaveBeenCalled()
  })
  it('writes text only to the granted destination', async () => {
    fs.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: true, directoryUri: 'content://chosen' })
    fs.createFileAsync.mockResolvedValue('content://chosen/log')
    expect(await exportConnectionLog()).toBe(true)
    expect(fs.createFileAsync).toHaveBeenCalledWith('content://chosen', expect.stringMatching(/^dsh-remote-log-.*\.txt$/), 'text/plain')
    expect(fs.writeAsStringAsync).toHaveBeenCalledWith('content://chosen/log', expect.stringContaining('DSH Remote connection diagnostics'))
  })
  it('propagates storage failures for the retry UI', async () => {
    fs.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: true, directoryUri: 'content://chosen' })
    fs.createFileAsync.mockRejectedValue(new Error('read only'))
    await expect(exportConnectionLog()).rejects.toThrow('read only')
    expect(fs.writeAsStringAsync).not.toHaveBeenCalled()
  })
})
