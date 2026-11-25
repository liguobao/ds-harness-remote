import { useEffect, useMemo, useRef, useState } from 'react'
import { TextInput } from 'react-native'
import { Alert } from '../../ui/alert'
import { isAcpManagedBackend } from '../../lib/workspace-key'
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
    if (session?.backend === 'codex' || connectionPhase !== 'connected') return
    if (mentionType === 'command' && skillCatalog === undefined && skillRequestedRef.current !== sessionId) {
      skillRequestedRef.current = sessionId
      void Promise.resolve().then(() => requireSessionTools(sessionId).listSkills(sessionId))
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
  // 「@」菜单：对话 / 文件 两组，均支持模糊检索。仅在打开 `@` 菜单时计算，避免切会话空跑全量扫描。
  const sessionItems: MentionItem[] = useMemo(() => {
    if (mentionType !== 'context') return []
    return sessions.filter(item => item.sessionId !== session?.sessionId && item.backend !== 'codex')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(item => {
        const title = resolveSessionDisplayTitle(item) ?? item.sessionId
        const owner = workspaces.find(workspace => workspace.sessionIds.includes(item.sessionId))
        return {
          id: item.sessionId,
          icon: OfficialMenuIcons.referenceSession,
          title,
          description: owner === undefined ? strings.chat.workspaceNone : `${owner.title} · ${maskPersonalPath(owner.path)}`,
          meta: relativeTime(item.updatedAt),
          onPress: () => insertMentionText(sessionMentionText(item.sessionId, title)),
        }
      })
  }, [mentionType, session?.sessionId, sessions, workspaces, strings])
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
    void Promise.resolve().then(() => requireSessionTools(sessionId).executeCommand(sessionId, '/export'))
      .then(result => {
        Alert.alert(strings.mention.exportTitle, result.text ?? (result.kind === 'success' ? strings.mention.exportTriggered : strings.mention.exportFailed))
      })
      .catch((error: unknown) => {
        Alert.alert(strings.mention.exportTitle, error instanceof Error && error.message.length > 0 ? error.message : strings.mention.exportFailed)
      })
  }

  const isAcpSession = isAcpManagedBackend(session?.backend)
  const isHarnessSession = session?.backend === undefined || session.backend === 'harness'
  // 「/」菜单：Harness 保留原生三组；ACP（含 AGY）优先展示上游 availableCommands + 会话控制。
  const commandAddItems: MentionItem[] = isHarnessSession
    ? [
        { id: 'file', icon: OfficialMenuIcons.file, title: strings.mention.file, description: strings.mention.fileDescription, onPress: () => insertMentionText('/file ') },
        { id: 'goal', icon: OfficialMenuIcons.goal, title: strings.mention.goal, description: strings.mention.goalDescription, onPress: () => insertMentionText('/goal ') },
        { id: 'plan', icon: OfficialMenuIcons.plan, title: strings.mention.plan, description: strings.mention.planDescription, onPress: () => insertMentionText('/plan ') },
        { id: 'feedback', icon: OfficialMenuIcons.feedback, title: strings.mention.feedback, description: strings.mention.feedbackDescription, onPress: () => insertMentionText('/feedback ') },
      ]
    : []
  const acpCommandItems: MentionItem[] = useMemo(() => {
    if (!isAcpSession) return []
    return (session?.availableCommands ?? []).map(cmd => ({
      id: `acp-cmd:${cmd.name}`,
      icon: OfficialMenuIcons.skill,
      title: `/${cmd.name}`,
      ...(cmd.description !== undefined && cmd.description.length > 0
        ? { description: cmd.description }
        : cmd.input?.hint !== undefined && cmd.input.hint.length > 0
          ? { description: cmd.input.hint }
          : {}),
      onPress: () => insertMentionText(`/${cmd.name} `),
    }))
  }, [isAcpSession, session?.availableCommands])
  const commandControlItems: MentionItem[] = isHarnessSession
    ? [
        { id: 'compact', icon: OfficialMenuIcons.compact, title: strings.mention.compact, description: strings.mention.compactDescription, onPress: () => insertMentionText('/compact') },
        { id: 'permission', icon: OfficialMenuIcons.permission, title: strings.mention.permission, description: strings.mention.permissionDescription, onPress: () => { setMentionType(null); setPermissionPickerOpen(true) } },
        { id: 'model', icon: OfficialMenuIcons.model, title: strings.mention.model, description: strings.mention.modelDescription, onPress: () => { setMentionType(null); setModelPickerOpen(true) } },
        { id: 'export', icon: OfficialMenuIcons.export, title: strings.mention.export, description: strings.mention.exportDescription, onPress: runSessionExport },
      ]
    : [
        { id: 'permission', icon: OfficialMenuIcons.permission, title: strings.mention.permission, description: strings.mention.permissionDescription, onPress: () => { setMentionType(null); setPermissionPickerOpen(true) } },
        { id: 'model', icon: OfficialMenuIcons.model, title: strings.mention.model, description: strings.mention.modelDescription, onPress: () => { setMentionType(null); setModelPickerOpen(true) } },
        ...acpCommandItems,
      ]
  const mentionTexts = (item: MentionItem) => [item.title, item.description ?? '', item.meta ?? '']
  const buildMentionGroups = (): MentionGroup[] => {
    const matching = (items: MentionItem[], limit = 20) => filterByQuery(items, mentionQuery, mentionTexts).slice(0, limit)
    switch (mentionType) {
      case 'command': return [
        ...(commandAddItems.length > 0 ? [{ key: 'add', title: strings.mention.addSection, items: matching(commandAddItems) }] : []),
        { key: 'commands', title: strings.mention.commandSection, items: matching(commandControlItems) },
        ...(isHarnessSession
          ? [{
              key: 'skills',
              title: strings.mention.skillSection,
              items: skillCatalog === undefined && skillCatalogFailed
                ? []
                : matching(skillItems),
            }]
          : []),
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
  /** Insert a reference token at the current cursor/selection, adding a leading space if needed. */
  const insertAtSelection = (text: string) => {
    const start = Math.max(0, Math.min(draftRef.current.length, selectionRef.current.start))
    const end = Math.max(start, Math.min(draftRef.current.length, selectionRef.current.end))
    const before = draftRef.current.slice(0, start)
    const after = draftRef.current.slice(end)
    const prefix = before.length > 0 && !/\s$/u.test(before) ? ' ' : ''
    const inserted = `${prefix}${text}`
    const next = `${before}${inserted}${after}`
    const cursor = before.length + inserted.length
    applyDraft(next)
    selectionRef.current = { start: cursor, end: cursor }
    setSelection({ start: cursor, end: cursor })
    setMentionType(null)
    composerInputRef.current?.focus()
  }

  const resetSelection = () => {
    selectionRef.current = { start: 0, end: 0 }
    setSelection({ start: 0, end: 0 })
  }
  const setCursor = (cursor: number) => {
    const clamped = Math.max(0, Math.min(draftRef.current.length, cursor))
    selectionRef.current = { start: clamped, end: clamped }
    setSelection({ start: clamped, end: clamped })
  }
  return {
    composerInputRef, draftRef, mentionType, setMentionType, selection, mentionGroups,
    applyDraft, closeMention, onChangeText, onSelectionChange, resetSelection, setCursor, insertAtSelection
  }
}

interface WorkspaceFileRef {
  path: string
  kind: 'file' | 'directory'
}

/** Shallow workspace tree for the `@` file menu: root entries plus one directory level. */
async function loadWorkspaceFileRefs(sessionId: string): Promise<WorkspaceFileRef[]> {
  const tools = requireSessionTools(sessionId)
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
