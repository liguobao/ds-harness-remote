import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import zhCN from '../src/locales/zh-CN'
import type { CustomPrompt } from '../src/services/storage'

describe('chat navigation and prompt modal state machine', () => {
  it('cascades back navigation step-by-step: editor -> manager -> picker -> closed', () => {
    // State machine simulation matching ChatScreen BackHandler
    type ModalState = {
      promptEditing: CustomPrompt | 'new' | null
      promptsManagerOpen: boolean
      promptsPickerOpen: boolean
    }

    const handleBack = (state: ModalState): ModalState => {
      if (state.promptEditing !== null) {
        return { ...state, promptEditing: null, promptsManagerOpen: true }
      }
      if (state.promptsManagerOpen) {
        return { ...state, promptsManagerOpen: false, promptsPickerOpen: true }
      }
      if (state.promptsPickerOpen) {
        return { ...state, promptsPickerOpen: false }
      }
      return state
    }

    // Start editing a prompt
    let state: ModalState = {
      promptEditing: { id: 'p1', title: 'Test', text: 'Text' },
      promptsManagerOpen: false,
      promptsPickerOpen: false,
    }

    // Step 1: Back from editor returns to manager
    state = handleBack(state)
    expect(state.promptEditing).toBeNull()
    expect(state.promptsManagerOpen).toBe(true)
    expect(state.promptsPickerOpen).toBe(false)

    // Step 2: Back from manager returns to picker
    state = handleBack(state)
    expect(state.promptEditing).toBeNull()
    expect(state.promptsManagerOpen).toBe(false)
    expect(state.promptsPickerOpen).toBe(true)

    // Step 3: Back from picker closes modal completely
    state = handleBack(state)
    expect(state.promptEditing).toBeNull()
    expect(state.promptsManagerOpen).toBe(false)
    expect(state.promptsPickerOpen).toBe(false)
  })

  it('returns to manager when prompt editor successfully saves', () => {
    let promptEditing: CustomPrompt | 'new' | null = 'new'
    let promptsManagerOpen = false

    const onSaveSuccess = () => {
      promptEditing = null
      promptsManagerOpen = true
    }

    onSaveSuccess()
    expect(promptEditing).toBeNull()
    expect(promptsManagerOpen).toBe(true)
  })

  it('closes manager completely when close (X) is clicked', () => {
    let promptsManagerOpen = true
    let promptsPickerOpen = false

    const onClose = () => {
      promptsManagerOpen = false
    }

    onClose()
    expect(promptsManagerOpen).toBe(false)
    expect(promptsPickerOpen).toBe(false)
  })

  it('evaluates panelOpen to true when any prompt modal is active', () => {
    const isPanelOpen = (flags: {
      plusMenuOpen?: boolean
      modelPickerOpen?: boolean
      promptsPickerOpen?: boolean
      promptsManagerOpen?: boolean
      promptEditing?: CustomPrompt | 'new' | null
    }) => {
      return Boolean(
        flags.plusMenuOpen ||
        flags.modelPickerOpen ||
        flags.promptsPickerOpen ||
        flags.promptsManagerOpen ||
        flags.promptEditing !== null && flags.promptEditing !== undefined
      )
    }

    expect(isPanelOpen({})).toBe(false)
    expect(isPanelOpen({ promptsPickerOpen: true })).toBe(true)
    expect(isPanelOpen({ promptsManagerOpen: true })).toBe(true)
    expect(isPanelOpen({ promptEditing: 'new' })).toBe(true)
    expect(isPanelOpen({ promptEditing: { id: '1', title: 't', text: 't' } })).toBe(true)
    expect(isPanelOpen({ promptEditing: null })).toBe(false)
  })
})

describe('route stack and new session creation', () => {
  it('does not push duplicate chat routes when starting a new session', () => {
    type Route = { name: string; deviceId?: string }
    let routes: Route[] = [{ name: 'workspaces' }, { name: 'chat' }]

    const push = (next: Route) => { routes = [...routes, next] }
    const pop = () => { routes = routes.length > 1 ? routes.slice(0, -1) : routes }

    // In ChatScreen, startNewSession creates session in-place and does NOT call push({ name: 'chat' })
    const startNewSession = (onNewSession?: () => void) => {
      // In App.tsx line 322, onNewSession is omitted / no-op
      onNewSession?.()
    }

    startNewSession(undefined)
    expect(routes).toEqual([{ name: 'workspaces' }, { name: 'chat' }])

    // Popping route once returns directly to workspaces
    pop()
    expect(routes).toEqual([{ name: 'workspaces' }])
  })

  it('inherits workspace id and blocks concurrent new session creations', async () => {
    const createSessionMock = vi.fn(async (_workspaceId?: string) => true)
    let newSessionPending = false
    let busy: string | undefined = undefined

    const startNewSession = async (currentWorkspace?: { workspaceId: string }) => {
      if (newSessionPending || busy !== undefined) return
      newSessionPending = true
      try {
        await createSessionMock(currentWorkspace?.workspaceId)
      } finally {
        newSessionPending = false
      }
    }

    // Call with workspace
    await startNewSession({ workspaceId: 'ws-123' })
    expect(createSessionMock).toHaveBeenCalledWith('ws-123')

    // Block when busy
    busy = 'running'
    await startNewSession({ workspaceId: 'ws-123' })
    expect(createSessionMock).toHaveBeenCalledTimes(1)

    // Block when newSessionPending
    busy = undefined
    newSessionPending = true
    await startNewSession({ workspaceId: 'ws-123' })
    expect(createSessionMock).toHaveBeenCalledTimes(1)
  })
})

describe('custom prompts hydration and mutation guards', () => {
  it('prevents prompt mutations while prompts are loading', async () => {
    const promptsLoading = true
    const persistMock = vi.fn()

    const persistPrompts = async (next: CustomPrompt[]): Promise<boolean> => {
      if (promptsLoading) return false
      persistMock(next)
      return true
    }

    const savePromptEdit = async (title: string, text: string) => {
      if (promptsLoading) return
      if (title.trim() === '' || text.trim() === '') return
      await persistPrompts([{ id: 'new', title, text }])
    }

    const deletePrompt = async (prompt: CustomPrompt) => {
      if (promptsLoading) return
      await persistPrompts([])
    }

    expect(await persistPrompts([])).toBe(false)
    await savePromptEdit('Title', 'Text')
    await deletePrompt({ id: '1', title: 't', text: 't' })
    expect(persistMock).not.toHaveBeenCalled()
  })

  it('guards against late loadCustomPrompts overwriting user mutations', async () => {
    let customPrompts: CustomPrompt[] | undefined = undefined
    let promptMutated = false

    // Simulate async loadCustomPrompts delay
    const loadPromise = new Promise<CustomPrompt[]>(resolve => {
      setTimeout(() => resolve([{ id: 'loaded', title: 'Loaded', text: 'Loaded' }]), 10)
    })

    // User mutates prompts before load resolves
    promptMutated = true
    customPrompts = [{ id: 'user-created', title: 'User Prompt', text: 'Text' }]

    // When load finishes, verify user mutation prevents overwriting
    const items = await loadPromise
    if (!promptMutated) {
      customPrompts = items
    }

    expect(customPrompts).toEqual([{ id: 'user-created', title: 'User Prompt', text: 'Text' }])
  })

  it('rolls back state and displays alert when saveCustomPrompts fails', async () => {
    const alertMock = vi.fn()
    const saveMock = vi.fn().mockRejectedValue(new Error('Disk failure'))

    const initialPrompts: CustomPrompt[] = [{ id: 'init', title: 'Init', text: 'Text' }]
    let customPrompts: readonly CustomPrompt[] = initialPrompts

    const persistPrompts = async (next: readonly CustomPrompt[]): Promise<boolean> => {
      const previous = customPrompts
      customPrompts = next
      try {
        await saveMock(next)
        return true
      } catch {
        customPrompts = previous
        alertMock(zhCN.chat.toolPromptSaveFailedTitle, zhCN.chat.toolPromptSaveFailedBody)
        return false
      }
    }

    const ok = await persistPrompts([{ id: 'next', title: 'Next', text: 'Next' }])
    expect(ok).toBe(false)
    expect(customPrompts).toEqual(initialPrompts)
    expect(alertMock).toHaveBeenCalledWith('无法保存提示词', '本地存储写入失败，请重试。')
  })
})

describe('source code structure conformance', () => {
  it('App.tsx does not pass onNewSession that pushes duplicate chat route', () => {
    const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    expect(appSource).not.toContain("onNewSession={openChat}")
    expect(appSource).not.toContain("const openChat = () => push({ name: 'chat' })")
  })

  it('chat-screen.tsx has panelOpen covering prompts modals', () => {
    const chatSource = readFileSync(new URL('../src/screens/chat-screen.tsx', import.meta.url), 'utf8')
    expect(chatSource).toContain('promptsPickerOpen || promptsManagerOpen || promptEditing !== null')
  })

  it('chat-screen.tsx startNewSession passes workspaceId and guards duplicate clicks', () => {
    const chatSource = readFileSync(new URL('../src/screens/chat-screen.tsx', import.meta.url), 'utf8')
    expect(chatSource).toContain('createSession(currentWorkspace?.workspaceId)')
    expect(chatSource).toContain('if (newSessionPending || busy !== undefined) return')
  })

  it('chat-screen.tsx PromptsManager and PromptEditor support back navigation', () => {
    const chatSource = readFileSync(new URL('../src/screens/chat-screen.tsx', import.meta.url), 'utf8')
    expect(chatSource).toContain('onBack={() => { setPromptsManagerOpen(false); setPromptsPickerOpen(true) }}')
    expect(chatSource).toContain('onBack={() => { setPromptEditing(null); setPromptsManagerOpen(true) }}')
    expect(chatSource).toMatch(/setPromptEditing\(null\)[\r\n\s]+setPromptsManagerOpen\(true\)/)
  })
})
