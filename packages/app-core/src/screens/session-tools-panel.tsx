import { useEffect, useRef, useState } from 'react'
import { Modal, StyleSheet, Text, View } from 'react-native'
import { strings as t } from '../locales/i18n'
import type { UiIconComponent } from '../ui/components'
import { KeyboardInset } from '../ui/keyboard-inset'
import { DuotoneIcons, MotionPressable } from '../ui/duotone-icons'
import { radius, spacing, type } from '../ui/theme'
import { useTheme } from '../ui/theme-context'
import { TerminalPanel } from './terminal-panel'
import { WorkspaceChangesPanel } from './workspace-changes-panel'
import { WorkspaceFilesPanel } from './workspace-files-panel'

export type SessionToolsMode = 'files' | 'changes' | 'terminal'

export function SessionToolsPanel({
  mode,
  sessionId,
  initialFile,
  initialPath,
  showTabs = true,
  changesSupported = true,
  onClose,
  onQuoteToComposer,
}: {
  mode: SessionToolsMode
  sessionId: string
  initialFile?: string
  initialPath?: string
  showTabs?: boolean
  changesSupported?: boolean
  onClose: () => void
  onQuoteToComposer?: (reference: string) => void
}) {
  const { colors } = useTheme()
  const [activeMode, setActiveMode] = useState<SessionToolsMode>(mode)
  const filesBackHandlerRef = useRef<(() => boolean) | undefined>(undefined)

  useEffect(() => {
    setActiveMode(mode)
  }, [mode])

  const effectiveMode: SessionToolsMode = activeMode === 'changes' && !changesSupported ? 'files' : activeMode

  const tabs: ReadonlyArray<{ id: SessionToolsMode; label: string; icon: UiIconComponent }> = [
    { id: 'files', label: t.tools.files, icon: DuotoneIcons.Folder },
    ...(changesSupported ? [{ id: 'changes' as const, label: t.tools.changes, icon: DuotoneIcons.GitCompareArrows }] : []),
    { id: 'terminal', label: t.tools.terminal, icon: DuotoneIcons.Terminal },
  ]

  const tabBar = showTabs ? (
    <View style={[styles.tabBarWrap, { backgroundColor: colors.background, borderBottomColor: colors.separator }]}>
      <View accessibilityRole="tablist" style={[styles.tabTrack, { backgroundColor: colors.surfaceStrong }]}>
        {tabs.map(tab => {
          const Icon = tab.icon
          const selected = effectiveMode === tab.id
          return (
            <MotionPressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected }}
              onPress={() => setActiveMode(tab.id)}
              scaleTo={0.97}
              surfaceColor={selected ? colors.surface : colors.surfaceStrong}
              style={({ pressed }) => [
                styles.tabItem,
                selected && [styles.tabItemSelected, { backgroundColor: colors.surface, borderColor: colors.border }],
                pressed && !selected && styles.tabPressed,
              ]}
            >
              <Icon size={15} color={selected ? colors.ink : colors.muted} strokeWidth={selected ? 2.1 : 1.9} />
              <Text
                numberOfLines={1}
                style={[
                  styles.tabLabel,
                  { color: selected ? colors.ink : colors.muted },
                  selected && styles.tabLabelSelected,
                ]}
              >
                {tab.label}
              </Text>
            </MotionPressable>
          )
        })}
      </View>
    </View>
  ) : undefined

  return (
    <Modal
      visible
      onRequestClose={() => {
        if (effectiveMode === 'files' && filesBackHandlerRef.current?.()) return
        onClose()
      }}
      animationType="slide"
      statusBarTranslucent
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <KeyboardInset>
          {effectiveMode === 'files' ? (
            <WorkspaceFilesPanel
              sessionId={sessionId}
              initialFile={initialFile}
              initialPath={initialPath}
              onClose={onClose}
              onRegisterBackHandler={handler => { filesBackHandlerRef.current = handler }}
              headerAccessory={tabBar}
            />
          ) : effectiveMode === 'changes' ? (
            <WorkspaceChangesPanel
              sessionId={sessionId}
              onClose={onClose}
              onQuoteToComposer={onQuoteToComposer}
              headerAccessory={tabBar}
            />
          ) : (
            <TerminalPanel
              sessionId={sessionId}
              onClose={onClose}
              headerAccessory={tabBar}
            />
          )}
        </KeyboardInset>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabBarWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  tabItem: {
    flex: 1,
    minHeight: 34,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.xs,
  },
  tabItemSelected: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  tabPressed: {
    opacity: 0.72,
  },
  tabLabel: {
    ...type.caption,
    fontSize: 13,
    fontWeight: '500',
  },
  tabLabelSelected: {
    fontWeight: '600',
  },
})
