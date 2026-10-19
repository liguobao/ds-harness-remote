import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

/**
 * Contains a render crash to one row instead of the whole screen.
 *
 * ## Why
 *
 * React unmounts the entire tree when a render throws and no boundary catches
 * it. This app had no boundary at all, so a single malformed message (a table
 * that explodes into thousands of native views, a markup edge case, anything
 * that throws during render) took the whole conversation down: the window kept
 * its last frame, the process stayed alive, and nothing recovered until the app
 * was killed. On the device that looked like a freeze that survived repeated
 * task switches — 119 s with one frame painted, `seqId` never advancing.
 *
 * ## Placement
 *
 * The boundary wraps the message list, not the whole screen, so the header,
 * composer and navigation keep working while the transcript shows a
 * recoverable error for the row group that failed.
 *
 * `resetKey` clears the error when the user navigates to another session, so a
 * crash does not follow them into a healthy conversation.
 */

interface Props {
  children: ReactNode
  /** Change this to clear a caught error (e.g. the session id). */
  resetKey?: string
  /** Optional retry handler; the button is hidden when omitted. */
  onRetry?: () => void
}

interface State {
  message?: string
}

export class ChatErrorBoundary extends Component<Props, State> {
  state: State = {}

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Render crashes used to be invisible: the tree unmounted and the screen
    // simply stopped updating. Log once so the cause is discoverable later.
    console.error('[dsh-remote] chat render crashed:', error, info.componentStack)
  }

  componentDidUpdate(previous: Props): void {
    if (previous.resetKey !== this.props.resetKey && this.state.message !== undefined) {
      this.setState({ message: undefined })
    }
  }

  render(): ReactNode {
    if (this.state.message === undefined) return this.props.children
    return <View style={styles.container}>
      <Text style={styles.title}>这段内容渲染失败</Text>
      <Text style={styles.detail} numberOfLines={4}>{this.state.message}</Text>
      <Text style={styles.hint}>其余对话和输入框不受影响，可以正常继续。</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => this.setState({ message: undefined })}>
          <Text style={styles.buttonText}>重试</Text>
        </Pressable>
        {this.props.onRetry === undefined ? null : (
          <Pressable accessibilityRole="button" style={styles.button} onPress={this.props.onRetry}>
            <Text style={styles.buttonText}>重新加载会话</Text>
          </Pressable>
        )}
      </View>
    </View>
  }
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 8 },
  title: { fontSize: 15, fontWeight: '600', color: '#d9534f' },
  detail: { fontSize: 12, color: '#888' },
  hint: { fontSize: 12, color: '#888' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  button: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#2f6fed' },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
})
