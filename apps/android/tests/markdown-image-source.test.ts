import { describe, expect, it, vi } from 'vitest'
import { chatImageWorkspacePath, createChatImageLoader, markdownImageSource } from '../src/services/chat-image-loader'

describe('Markdown file preview image paths (#426)', () => {
  it.each([
    ['../assets/chapter-04/figure.png', 'notes/chapters/note.md', 'notes/assets/chapter-04/figure.png'],
    ['./figure.png', 'notes/note.md', 'notes/figure.png'],
    ['figure.png', 'note.md', 'figure.png'],
    ['../figure.png', 'C:\\work\\notes\\note.md', 'C:/work/figure.png'],
    ['../figure.png', '/work/notes/note.md', '/work/figure.png'],
    ['a%20b%25%23%3F.png', 'notes/note.md', 'notes/a b%#?.png'],
  ])('resolves %s relative to %s', (src, file, expected) => {
    expect(chatImageWorkspacePath(markdownImageSource(src, file)!)).toBe(expected)
  })

  it('preserves absolute sources, data URIs and ordinary chat semantics', () => {
    for (const src of ['/work/a.png', 'C:\\work\\a.png', 'file:///work/a.png', 'data:image/png;base64,AAAA']) {
      expect(markdownImageSource(src, 'notes/note.md')).toBe(src)
    }
    expect(markdownImageSource('../a.png')).toBe('../a.png')
  })

  it.each(['../../a.png', '%2e%2e/%2e%2e/a.png', 'https://host/a.png', '//host/a.png', '%68ttps%3A//host/a.png', 'a%00.png'])('rejects invalid preview reference %s', src => {
    expect(markdownImageSource(src, 'notes/note.md')).toBeUndefined()
  })

  it('passes the resolved path to the authorized workspace reader', async () => {
    const workspace = vi.fn(async () => { throw new Error('stop after path assertion') })
    const loader = createChatImageLoader({ sessionId: 's1', attachment: vi.fn(), workspace, assertCurrent: () => {} })
    const signal = new AbortController().signal
    await expect(loader({ uri: markdownImageSource('../assets/fig.png', 'notes/chapters/note.md') }, signal)).rejects.toThrow()
    expect(workspace).toHaveBeenCalledWith('notes/assets/fig.png', signal)
  })
})
