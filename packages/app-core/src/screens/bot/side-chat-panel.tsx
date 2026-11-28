import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Plus, Send, Trash2, X } from 'lucide-react-native'
import { strings as s } from '../../locales/i18n'
import { objects, text, type BotObject } from '../../services/bot-catalog'
import { Button, IconButton } from '../../ui/components'
import { NativeMarkdown } from '../../ui/markdown'
import { useResponsiveLayout } from '../../ui/responsive'
import { radius, spacing, type } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { ModalSurface } from '../chat/modal'
import type { BotPerform } from './editor'
import { createBotStyles } from './styles'

export function BotSideChatSheet({
  visible,
  botId,
  botName,
  sideChats,
  busy,
  onClose,
  perform,
}: {
  visible: boolean
  botId: string
  botName: string
  sideChats: unknown
  busy: boolean
  onClose: () => void
  perform: BotPerform
}) {
  const styles = useThemedStyles(createBotStyles)
  const localStyles = useThemedStyles(createSideStyles)
  const { colors } = useTheme()
  const { sheetMaxHeight } = useResponsiveLayout()
  const chats = objects(sideChats)
  const [selectedChatId, setSelectedChatId] = useState<string | undefined>(undefined)
  const [questionDraft, setQuestionDraft] = useState('')

  useEffect(() => {
    if (!visible) return
    if (chats.length > 0 && (!selectedChatId || !chats.some(c => text(c.id) === selectedChatId))) {
      setSelectedChatId(text(chats[chats.length - 1]?.id))
    }
  }, [visible, chats, selectedChatId])

  const activeChat = chats.find(c => text(c.id) === selectedChatId) ?? chats[chats.length - 1]
  const activeChatId = activeChat ? text(activeChat.id) : undefined
  const entries = activeChat ? objects(activeChat.entries) : []
  const answering = entries.some(entry => text(entry.status) === 'answering')

  const handleCreateChat = async () => {
    if (busy) return
    const result = await perform('side-new', { sessionId: botId })
    if (result.ok && typeof result.value === 'object' && result.value !== null && 'chatId' in result.value) {
      const chatId = text((result.value as { chatId?: unknown }).chatId)
      if (chatId) setSelectedChatId(chatId)
    }
  }

  const handleCloseChat = async (chatId: string) => {
    if (busy || !chatId) return
    await perform('side-close', { chatId })
    if (selectedChatId === chatId) setSelectedChatId(undefined)
  }

  const handleAsk = async () => {
    const trimmed = questionDraft.trim()
    if (!trimmed || busy || answering) return
    const payload: BotObject = activeChatId
      ? { sessionId: botId, chatId: activeChatId, text: trimmed }
      : { sessionId: botId, text: trimmed }
    const result = await perform('side-ask', payload)
    if (result.ok) {
      setQuestionDraft('')
      if (typeof result.value === 'object' && result.value !== null && 'chatId' in result.value) {
        const chatId = text((result.value as { chatId?: unknown }).chatId)
        if (chatId) setSelectedChatId(chatId)
      }
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <ModalSurface onClose={onClose}>
        <View style={localStyles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{s.bots.sideChat}</Text>
            <Text style={styles.muted}>{botName} · {s.bots.btwNote}</Text>
          </View>
          <IconButton label={s.bots.newSideChat} icon={Plus} disabled={busy} onPress={() => void handleCreateChat()} />
          <IconButton label={s.common.close} icon={X} onPress={onClose} />
        </View>

        {chats.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={localStyles.tabs}>
            {chats.map((chat, idx) => {
              const cid = text(chat.id)
              const selected = cid === activeChatId
              const title = text(objects(chat.entries)[0]?.question) || `${s.bots.sideChat} ${idx + 1}`
              return (
                <View key={cid || idx} style={[localStyles.tabChip, selected && localStyles.tabChipActive]}>
                  <Pressable onPress={() => setSelectedChatId(cid)} style={{ maxWidth: 160 }}>
                    <Text numberOfLines={1} style={[localStyles.tabLabel, selected && localStyles.tabLabelActive]}>{title}</Text>
                  </Pressable>
                  <Pressable
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={s.bots.delete}
                    disabled={busy}
                    onPress={() => void handleCloseChat(cid)}
                  >
                    <Trash2 size={13} color={selected ? colors.primary : colors.muted} />
                  </Pressable>
                </View>
              )
            })}
          </ScrollView>
        )}

        <ScrollView style={{ maxHeight: Math.max(220, sheetMaxHeight - 210) }} contentContainerStyle={localStyles.body}>
          {entries.length === 0 ? (
            <Text style={styles.muted}>{s.bots.none}</Text>
          ) : (
            entries.map((entry, index) => {
              const entryId = text(entry.id)
              const status = text(entry.status)
              const isAnswering = status === 'answering'
              return (
                <View key={entryId || index} style={styles.card}>
                  <Text selectable style={styles.heading}>{text(entry.question)}</Text>
                  {text(entry.answer) !== '' && <NativeMarkdown text={text(entry.answer)} />}
                  {isAnswering && (
                    <View style={styles.row}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={[styles.muted, styles.grow]}>{s.bots.btwAnswering}</Text>
                      <Button
                        variant="quiet"
                        label={s.bots.cancel}
                        disabled={busy || !activeChatId || !entryId}
                        onPress={() => void perform('side-cancel', { chatId: activeChatId, entryId })}
                      />
                    </View>
                  )}
                  {status === 'cancelled' && <Text style={styles.muted}>{s.bots.btwCancelled}</Text>}
                  {status === 'failed' && <Text style={styles.error}>{text(entry.error) || s.bots.btwFailed}</Text>}
                </View>
              )
            })
          )}
        </ScrollView>

        <View style={localStyles.inputRow}>
          <TextInput
            value={questionDraft}
            onChangeText={setQuestionDraft}
            placeholder={s.bots.askBot(botName)}
            placeholderTextColor={colors.muted}
            style={[styles.input, { flex: 1 }]}
            editable={!busy && !answering}
            onSubmitEditing={() => void handleAsk()}
          />
          <IconButton
            label={s.bots.send}
            icon={Send}
            disabled={busy || answering || questionDraft.trim().length === 0}
            onPress={() => void handleAsk()}
          />
        </View>
      </ModalSurface>
    </Modal>
  )
}

const createSideStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    tabs: {
      flexDirection: 'row',
      gap: spacing.xs,
      paddingBottom: spacing.sm,
    },
    tabChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    tabChipActive: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    tabLabel: {
      ...type.caption,
      color: colors.muted,
    },
    tabLabelActive: {
      color: colors.primary,
      fontWeight: '600',
    },
    body: {
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingTop: spacing.sm,
    },
  })
