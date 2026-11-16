import { beforeEach, expect, it, vi } from 'vitest'
import type { RemoteSession } from '../src/types'

const mocks = vi.hoisted(() => ({ library: vi.fn(), camera: vi.fn(), permission: vi.fn(), document: vi.fn(), alert: vi.fn() }))
vi.mock('react', () => ({ useState: (value: unknown) => [value, vi.fn()] }))
vi.mock('react-native', () => ({ Image: {} }))
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: mocks.library, launchCameraAsync: mocks.camera, requestCameraPermissionsAsync: mocks.permission }))
vi.mock('expo-document-picker', () => ({ getDocumentAsync: mocks.document }))
vi.mock('expo-file-system', () => ({ File: class { size = 1024 } }))
vi.mock('../src/ui/alert', () => ({ Alert: { alert: mocks.alert } }))
vi.mock('../src/services/browse-memory', () => ({ useBrowseMemory: { getState: () => ({ entries: {} }) } }))
vi.mock('../src/state/store', () => ({ useAppStore: { getState: () => ({
  selectedSession: { sessionId: 's1' }, connection: { stats: { mode: 'relay' } },
}) } }))
import { useChatAttachments } from '../src/screens/chat/use-chat-attachments'

beforeEach(() => vi.clearAllMocks())

function picker(backend = 'harness') {
  const setImages = vi.fn()
  const files: unknown[] = []
  const attachments = useChatAttachments({
    session: { sessionId: 's1', backend } as RemoteSession,
    memoryKey: 's1', images: [], setImages, stagedFiles: [],
    setStagedFiles: update => { files.push(...(typeof update === 'function' ? update([]) : update)) },
    sessionGenerationRef: { current: 0 },
  })
  return { ...attachments, files, setImages }
}

it('allows photos and videos without direct image input and stages both as workspace files', async () => {
  mocks.library.mockResolvedValue({ canceled: false, assets: [
    { uri: 'file:///photo.jpg', fileName: 'MVIMG_20261113_203501.jpg', mimeType: 'image/jpeg', type: 'image' },
    { uri: 'file:///clip.mp4', fileName: 'clip.mp4', mimeType: 'video/mp4', type: 'video', duration: 2000 },
  ] })
  const result = picker()
  await result.pickImages()
  expect(mocks.library).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images', 'videos'] }))
  expect(result.files).toEqual([
    expect.objectContaining({ name: 'MVIMG_20261113_203501.jpg', mimeType: 'image/jpeg', size: 1024 }),
    expect.objectContaining({ name: 'clip.mp4', mimeType: 'video/mp4', durationMs: 2000 }),
  ])
  expect(mocks.alert).not.toHaveBeenCalled()
  expect(result.setImages).not.toHaveBeenCalled()
})

it('accepts a normal JPG through the document picker without reporting an unsupported format', async () => {
  mocks.document.mockResolvedValue({ canceled: false, assets: [
    { uri: 'file:///photo.jpg', name: 'MVIMG_20261113_203501.jpg', mimeType: 'image/jpeg' },
  ] })
  const result = picker()
  await result.pickFiles()
  expect(result.files).toEqual([expect.objectContaining({ name: 'MVIMG_20261113_203501.jpg', mimeType: 'image/jpeg' })])
  expect(mocks.alert).not.toHaveBeenCalled()
})

it('preserves direct image attachments for sessions that support them', async () => {
  mocks.library.mockResolvedValue({ canceled: false, assets: [
    { uri: 'file:///photo.jpg', fileName: 'photo.jpg', mimeType: 'image/jpeg', type: 'image', base64: '/9j/AAAA', width: 20, height: 20 },
  ] })
  const result = picker('codex')
  await result.pickImages()
  expect(result.setImages).toHaveBeenCalledWith([expect.objectContaining({ mediaType: 'image/jpeg', name: 'photo.jpg' })])
  expect(result.files).toEqual([])
  expect(mocks.alert).not.toHaveBeenCalled()
})

it('offers camera capture without direct image input and stages the photo as a workspace file', async () => {
  mocks.permission.mockResolvedValue({ granted: true })
  mocks.camera.mockResolvedValue({ canceled: false, assets: [
    { uri: 'file:///camera.jpg', fileName: 'camera.jpg', mimeType: 'image/jpeg', type: 'image' },
  ] })
  const result = picker()
  await result.takePhoto()
  expect(mocks.permission).toHaveBeenCalledTimes(1)
  expect(mocks.camera).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], base64: false }))
  expect(result.files).toEqual([expect.objectContaining({ name: 'camera.jpg', mimeType: 'image/jpeg' })])
  expect(mocks.alert).not.toHaveBeenCalled()
})

it('does not open the camera when permission is refused', async () => {
  mocks.permission.mockResolvedValue({ granted: false })
  const result = picker()
  await result.takePhoto()
  expect(mocks.camera).not.toHaveBeenCalled()
  expect(result.files).toEqual([])
  expect(mocks.alert).toHaveBeenCalledTimes(1)
})
