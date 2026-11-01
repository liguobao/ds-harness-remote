import { useEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { strings } from '../../locales/i18n'
import { BUILT_IN_PROMPTS, loadCustomPrompts, saveCustomPrompts, type CustomPrompt } from '../../services/storage'

export function useChatPrompts(connectionPhase: string) {
  const [promptsPickerOpen, setPromptsPickerOpen] = useState(false)
  const [customPrompts, setCustomPrompts] = useState<readonly CustomPrompt[]>()
  const [promptEditing, setPromptEditing] = useState<CustomPrompt | 'new' | null>(null)
  const [promptsManagerOpen, setPromptsManagerOpen] = useState(false)
  const [promptsLoading, setPromptsLoading] = useState(false)
  const promptsLoadingRef = useRef(false)
  const promptMutatedRef = useRef(false)
  // Composer quick prompts: load built-ins and saved entries once per connection.
  useEffect(() => {
    if (connectionPhase !== 'connected') return
    if (customPrompts !== undefined || promptsLoadingRef.current) return
    promptsLoadingRef.current = true
    setPromptsLoading(true)
    let cancelled = false
    void loadCustomPrompts()
      .then(items => {
        if (cancelled || promptMutatedRef.current) return
        setCustomPrompts(items)
      })
      .finally(() => {
        promptsLoadingRef.current = false
        if (!cancelled) setPromptsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [connectionPhase, customPrompts])
  const persistPrompts = async (next: readonly CustomPrompt[]): Promise<boolean> => {
    if (promptsLoading) return false
    promptMutatedRef.current = true
    const previous = customPrompts ?? BUILT_IN_PROMPTS
    setCustomPrompts(next)
    // Built-ins are re-seeded on every load, so a deleted one only stays gone
    // when its id is recorded; edited built-ins keep their id and are saved as
    // overrides inside `next`.
    const removed = BUILT_IN_PROMPTS
      .filter(item => !next.some(prompt => prompt.id === item.id))
      .map(item => item.id)
    try {
      await saveCustomPrompts(next, removed)
      return true
    } catch {
      setCustomPrompts(previous)
      Alert.alert(strings.chat.toolPromptSaveFailedTitle, strings.chat.toolPromptSaveFailedBody)
      return false
    }
  }

  const savePromptEdit = async (title: string, text: string) => {
    if (promptsLoading) return
    const editing = promptEditing
    const trimmedTitle = title.trim()
    const trimmedText = text.trim()
    if (trimmedTitle === '' || trimmedText === '') return
    const current = customPrompts ?? BUILT_IN_PROMPTS
    let ok = false
    if (editing === 'new') {
      ok = await persistPrompts([...current, { id: `prompt-${Date.now()}`, title: trimmedTitle, text: trimmedText }])
    } else if (editing !== null) {
      ok = await persistPrompts(current.map(item => item.id === editing.id ? { ...item, title: trimmedTitle, text: trimmedText } : item))
    }
    if (ok) {
      setPromptEditing(null)
      setPromptsManagerOpen(true)
    }
  }

  const deletePrompt = async (prompt: CustomPrompt) => {
    if (promptsLoading) return
    const current = customPrompts ?? BUILT_IN_PROMPTS
    await persistPrompts(current.filter(item => item.id !== prompt.id))
  }

  return {
    promptsPickerOpen, setPromptsPickerOpen, customPrompts, promptEditing,
    setPromptEditing, promptsManagerOpen, setPromptsManagerOpen, promptsLoading, savePromptEdit, deletePrompt
  }
}
