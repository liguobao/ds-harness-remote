import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { strings } from '../locales/i18n'
import type { ChatImage } from '../types'
import type { ChatImageLoader } from '../services/chat-image-loader'
import { validatedImageDataUri } from '../services/chat-image-loader'
import { useTheme } from './theme-context'

const imageLoaderContext = createContext<ChatImageLoader | undefined>(undefined)
export const ChatImageProvider = imageLoaderContext.Provider

/** Host-backed images are memory-only. A new scope immediately hides old pixels and aborts reads. */
export function ChatImageView({ image, remoteSource = false }: { image: ChatImage; remoteSource?: boolean }) {
  const load = useContext(imageLoaderContext)
  const { colors } = useTheme()
  const [attempt, setAttempt] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const source = useMemo(() => image, [image.sessionId, image.attachmentId, image.uri, image.name])
  const [result, setResult] = useState<{ source: ChatImage; load: typeof load; uri?: string; failed?: boolean }>()
  const current = result?.source === source && result.load === load ? result : undefined
  const label = image.name || strings.chat.unnamedImage
  useEffect(() => {
    const controller = new AbortController()
    setResult(undefined)
    setExpanded(false)
    const resolve = async () => {
      // Only optimistic picker images can use a device-local URI. Markdown never can.
      if (!remoteSource && /^(?:file|content):/u.test(image.uri ?? '')) return image.uri!
      if (load !== undefined) return load(image, controller.signal)
      if (image.uri?.startsWith('data:')) return validatedImageDataUri(image.uri)
      throw new Error('Image unavailable')
    }
    void resolve().then(uri => {
      if (!controller.signal.aborted) setResult({ source, load, uri })
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ source, load, failed: true })
    })
    return () => controller.abort()
  }, [source, load, attempt, remoteSource])
  const fail = () => setResult({ source, load, failed: true })
  return <View style={[styles.frame, { backgroundColor: colors.surface }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={current?.failed ? `${label} · ${strings.common.retry}` : label}
      onPress={() => current?.uri ? setExpanded(true) : current?.failed && setAttempt(value => value + 1)} style={styles.frame}>
      {current?.uri
        ? <Image source={{ uri: current.uri }} style={styles.frame} resizeMode="contain" onError={fail} />
        : <View style={styles.placeholder}>
            {current?.failed ? <Text style={{ color: colors.muted }}>{strings.common.unavailable} · {strings.common.retry}</Text>
              : <ActivityIndicator color={colors.primary} />}
            <Text numberOfLines={2} style={{ color: colors.muted }}>{label}</Text>
          </View>}
    </Pressable>
    <Modal visible={expanded && current?.uri !== undefined} transparent onRequestClose={() => setExpanded(false)}>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel={strings.common.close} onPress={() => setExpanded(false)} style={styles.close}>
          <Text style={styles.closeText}>{strings.common.close}</Text>
        </Pressable>
        {current?.uri && <Image accessibilityLabel={label} source={{ uri: current.uri }} resizeMode="contain" style={styles.full} onError={fail} />}
      </View>
    </Modal>
  </View>
}

const styles = StyleSheet.create({
  frame: { width: 220, height: 160, borderRadius: 8, overflow: 'hidden' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12, gap: 8 },
  backdrop: { flex: 1, backgroundColor: '#000', paddingTop: 52, paddingBottom: 24 },
  close: { alignSelf: 'flex-end', padding: 16 },
  closeText: { color: '#fff', fontSize: 16 },
  full: { flex: 1, width: '100%' },
})
