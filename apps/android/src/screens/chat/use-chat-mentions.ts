import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, TextInput } from 'react-native'
import { strings } from '../../locales/i18n'
import type { SkillEntry } from '../../services/session-tools'
import { requireSessionTools } from '../../state/store'
import type { RemoteSession, WorkspaceView } from '../../types'
import { detectMention, fileMentionText, filterByQuery, maskPersonalPath, sessionMentionText, type MentionGroup, type MentionItem, type MentionType } from '../../ui/mention-popover'
import { OfficialMenuIcons } from '../../ui/official-menu-icons'
import { resolveSessionDisplayTitle } from '../session-title'
import { relativeTime } from './presentation'

type Options = {
  session: RemoteSession | undefined
  sessions: RemoteSession[]
  workspaces: WorkspaceView[]
  connectionPhase: string
  draft: string
  setDraft: (value: string) => void
  setPermissionPickerOpen: (value: boolean) => void
  setModelPickerOpen: (value: boolean) => void
}

export function useChatMentions({ session, sessions, workspaces, connectionPhase, draft, setDraft, setPermissionPickerOpen, setModelPickerOpen }: Options) {
  // `/` command and `@` reference popover state anchored to the composer cursor.
  const [mentionType, setMentionType] = useState<MentionType | null>(null)
  const [mentionQuery, setMentionQuery] = useState('')
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const composerInputRef = useRef<TextInput>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const selectionRef = useRef({ start: 0, end: 0 })
  /** Start index of the active `/` / `@` trigger inside the draft. */
  const mentionSpanRef = useRef(0)
  const [skillCatalog, setSkillCatalog] = useState<SkillEntry[]>()
  const [skillCatalogFailed, setSkillCatalogFailed] = useState(false)
  const [workspaceFileRefs, setWorkspaceFileRefs] = useState<WorkspaceFileRef[]>()
  const [fileListFailed, setFileListFailed] = useState(false)
  const skillRequestedRef = useRef<string | undefined>(undefined)
  const filesRequestedRef = useRef<string | undefined>(undefined)
  // `/` 技能目录与 `@` 文件树按会话懒加载一次；未拉取成功时技能分组回落到内置技能。
  useEffect(() => {
    setSkillCatalog(undefined)
    setSkillCatalogFailed(false)
    setWorkspaceFileRefs(undefined)
    setFileListFailed(false)
    skillRequestedRef.current = undefined
    filesRequestedRef.current = undefined
    setMentionType(null)
  }, [session?.sessionId])
  useEffect(() => {
    const sessionId = session?.sessionId
    if (mentionType === null || sessionId === undefined) return
    if (session?.backend === 'codex' || session?.backend === 'claude' || session?.backend === 'hermes' || connectionPhase !== 'connected') return
    if (mentionType === 'command' && skillCatalog === undefined && skillRequestedRef.current !== sessionId) {
      skillRequestedRef.current = sessionId
      void Promise.resolve().then(() => requireSessionTools().listSkills(sessionId))
        .then(rows => { if (skillRequestedRef.current === sessionId) setSkillCatalog(rows) })
        .catch(() => { if (skillRequestedRef.current === sessionId) setSkillCatalogFailed(true) })
    }
    if (mentionType === 'context' && workspaceFileRefs === undefined && filesRequestedRef.current !== sessionId) {
      filesRequestedRef.current = sessionId
      void loadWorkspaceFileRefs(sessionId)
        .then(rows => { if (filesRequestedRef.current === sessionId) setWorkspaceFileRefs(rows) })
        .catch(() => { if (filesRequestedRef.current === sessionId) setFileListFailed(true) })
    }
  }, [mentionType, session?.sessionId, session?.backend, connectionPhase, skillCatalog, workspaceFileRefs])
  const skillItems: MentionItem[] = useMemo(() => (skillCatalog ?? []).map(row => ({
    id: `skill:${row.name}`,
    icon: OfficialMenuIcons.skill,
    title: row.name,
    description: row.modelInvocable ? row.description : `${strings.mention.skillUserOnly} · ${row.description}`,
    onPress: () => insertMentionText(`/${row.name} `),
  })), [skillCatalog, strings])
  // 「@」菜单：对话 / 文件 两组，均支持模糊检索。
  const sessionItems: MentionItem[] = useMemo(() => sessions.filter(item => item.sessionId !== session?.sessionId && item.backend !== 'codex')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(item => {
      const title = resolveSessionDisplayTitle(item) ?? item.title ?? item.sessionId
      const owner = workspaces.find(workspace => workspace.sessionIds.includes(item.sessionId))
      return {
        id: item.sessionId,
        icon: OfficialMenuIcons.referenceSession,
        title,
        description: owner === undefined ? strings.chat.workspaceNone : `${owner.title} · ${maskPersonalPath(owner.path)}`,
        meta: relativeTime(item.updatedAt),
        onPress: () => insertMentionText(sessionMentionText(item.sessionId, title)),
      }
    }), [session?.sessionId, sessions, workspaces, strings])
  const fileItems: MentionItem[] = useMemo(() => (workspaceFileRefs ?? []).map(ref => {
    const isDir = ref.kind === 'directory'
    const Icon = isDir ? OfficialMenuIcons.referenceFolder : OfficialMenuIcons.referenceFile
    return {
      id: ref.path,
      icon: Icon,
      title: ref.path,
      onPress: () => { const mention = fileMentionText(ref.path, isDir); if (mention !== undefined) insertMentionText(mention) },
    }
  }), [workspaceFileRefs])

  const applyDraft = (next: string) => {
    draftRef.current = next
    setDraft(next)
  }

  const closeMention = () => setMentionType(null)

  const updateMention = (text: string, cursor: number) => {
    const detected = detectMention(text, cursor)
    if (detected === undefined) {
      setMentionType(null)
      return
    }
    mentionSpanRef.current = detected.start
    setMentionQuery(detected.query)
    setMentionType(detected.type)
  }

  /** Insert the picked command or reference text at the trigger span, keeping the caret behind it (web composer grammar). */
  const insertMentionText = (text: string) => {
    const start = mentionSpanRef.current
    const end = selectionRef.current.end
    const current = draftRef.current
    const next = current.slice(0, start) + text + current.slice(end)
    const cursor = start + text.length
    applyDraft(next)
    selectionRef.current = { start: cursor, end: cursor }
    setSelection({ start: cursor, end: cursor })
    setMentionType(null)
    composerInputRef.current?.focus()
  }

  const onChangeText = (next: string) => {
    if (next === draftRef.current) return
    // Keep the tracked caret in step with the edit so the controlled selection
    // never yanks the cursor; onSelectionChange refines it right afterwards.
    const delta = next.length - draftRef.current.length
    applyDraft(next)
    const cursor = Math.max(0, Math.min(next.length, selectionRef.current.end + delta))
    selectionRef.current = { start: cursor, end: cursor }
    setSelection({ start: cursor, end: cursor })
    updateMention(next, cursor)
  }

  const onSelectionChange = (event: { nativeEvent: { selection: { start: number; end: number } } }) => {
    const next = event.nativeEvent.selection
    if (next.start === selectionRef.current.start && next.end === selectionRef.current.end) return
    selectionRef.current = next
    setSelection(next)
    if (next.start === next.end) updateMention(draftRef.current, next.end)
  }

  const runSessionExport = () => {
    setMentionType(null)
    const sessionId = session?.sessionId
    if (sessionId === undefined) return
    void Promise.resolve().then(() => requireSessionTools().executeCommand(sessionId, '/export'))
      .then(result => {
        Alert.alert(strings.mention.exportTitle, result.text ?? (result.kind === 'success' ? strings.mention.exportTriggered : strings.mention.exportFailed))
      })
      .catch((error: unknown) => {
        Alert.alert(strings.mention.exportTitle, error instanceof Error && error.message.length > 0 ? error.message : strings.mention.exportFailed)
      })
  }

  // 「/」菜单：添加 / 指令 / 技能 三组，动作按 DeepSeek Harness Web 端绑定。
  const commandAddItems: MentionItem[] = [
    { id: 'file', icon: OfficialMenuIcons.file, title: strings.mention.file, description: strings.mention.fileDescription, onPress: () => insertMentionText('/file ') },
    { id: 'goal', icon: OfficialMenuIcons.goal, title: strings.mention.goal, description: strings.mention.goalDescription, onPress: () => insertMentionText('/goal ') },
    { id: 'plan', icon: OfficialMenuIcons.plan, title: strings.mention.plan, description: strings.mention.planDescription, onPress: () => insertMentionText('/plan ') },
    { id: 'feedback', icon: OfficialMenuIcons.feedback, title: strings.mention.feedback, description: strings.mention.feedbackDescription, onPress: () => insertMentionText('/feedback ') },
  ]
  const commandControlItems: MentionItem[] = [
    { id: 'compact', icon: OfficialMenuIcons.compact, title: strings.mention.compact, description: strings.mention.compactDescription, onPress: () => insertMentionText('/compact') },
    { id: 'permission', icon: OfficialMenuIcons.permission, title: strings.mention.permission, description: strings.mention.permissionDescription, onPress: () => { setMentionType(null); setPermissionPickerOpen(true) } },
    { id: 'model', icon: OfficialMenuIcons.model, title: strings.mention.model, description: strings.mention.modelDescription, onPress: () => { setMentionType(null); setModelPickerOpen(true) } },
    { id: 'export', icon: OfficialMenuIcons.export, title: strings.mention.export, description: strings.mention.exportDescription, onPress: runSessionExport },
  ]
  const mentionTexts = (item: MentionItem) => [item.title, item.description ?? '', item.meta ?? '']
  const buildMentionGroups = (): MentionGroup[] => {
    const matching = (items: MentionItem[], limit = 20) => filterByQuery(items, mentionQuery, mentionTexts).slice(0, limit)
    switch (mentionType) {
      case 'command': return [
        { key: 'add', title: strings.mention.addSection, items: matching(commandAddItems) },
        { key: 'commands', title: strings.mention.commandSection, items: matching(commandControlItems) },
        {
          key: 'skills',
          title: strings.mention.skillSection,
          items: skillCatalog === undefined && skillCatalogFailed
            ? []
            : matching(skillItems),
        },
      ]
      case 'context': return [
        { key: 'sessions', title: strings.mention.sessionSection, items: matching(sessionItems) },
        {
          key: 'files',
          title: strings.mention.fileSection,
          items: fileListFailed ? [] : matching(fileItems, 30),
        },
      ]
      default: return []
    }
  }
  const mentionGroups = buildMentionGroups()
  const resetSelection = () => {
    selectionRef.current = { start: 0, end: 0 }
    setSelection({ start: 0, end: 0 })
  }
  return {
    composerInputRef, draftRef, mentionType, setMentionType, selection, mentionGroups,
    applyDraft, closeMention, onChangeText, onSelectionChange, resetSelection
  }
}

interface WorkspaceFileRef {
  path: string
  kind: 'file' | 'directory'
}

/** Shallow workspace tree for the `@` file menu: root entries plus one directory level. */
async function loadWorkspaceFileRefs(sessionId: string): Promise<WorkspaceFileRef[]> {
  const tools = requireSessionTools()
  const refs: WorkspaceFileRef[] = []
  const root = await tools.listFiles(sessionId, '')
  const directories = root.entries.filter(entry => entry.type === 'directory' && !entry.name.startsWith('.'))
  for (const entry of root.entries) {
    if (entry.name.startsWith('.')) continue
    refs.push({ path: entry.name, kind: entry.type === 'directory' ? 'directory' : 'file' })
  }
  await Promise.all(directories.slice(0, 12).map(async directory => {
    try {
      const listing = await tools.listFiles(sessionId, directory.name)
      for (const entry of listing.entries) {
        if (entry.name.startsWith('.')) continue
        refs.push({ path: `${directory.name}/${entry.name}`, kind: entry.type === 'directory' ? 'directory' : 'file' })
      }
    } catch {
      // Unreadable directories are simply absent from the menu.
    }
  }))
  return refs
}
