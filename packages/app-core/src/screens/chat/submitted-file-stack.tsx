import { memo, useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { sessionFileStatCache } from '../../services/file-stat-cache'
import { getConnectionGeneration, requireSessionTools, useAppStore } from '../../state/store'
import type { ChatFile } from '../../types'
import { SubmittedFileCard } from '../../ui/file-card'
import { useWorkspaceStatReady } from '../../ui/markdown'

export const SubmittedFileStack = memo(function SubmittedFileStack({
  files,
  sessionId,
  onFilePress,
}: {
  files: readonly ChatFile[]
  sessionId: string
  onFilePress?: (path: string) => void
}) {
  const connectionReady = useAppStore(state => state.connection.phase === 'connected')
  const statReady = useWorkspaceStatReady()
  const connected = connectionReady && statReady
  const [resolvedBytes, setResolvedBytes] = useState<Record<string, number>>({})

  useEffect(() => {
    setResolvedBytes({})
  }, [sessionId, connected])

  useEffect(() => {
    if (!connected || files.length === 0) return
    let active = true
    const generation = getConnectionGeneration()
    for (const file of files) {
      if (file.bytes !== undefined) continue
      const cached = sessionFileStatCache.get(generation, sessionId, file.path)
      if (cached !== undefined) {
        if (cached.status === 'ok' && cached.bytes !== undefined) {
          setResolvedBytes(prev => (prev[file.path] === cached.bytes ? prev : { ...prev, [file.path]: cached.bytes! }))
        }
        continue
      }
      void sessionFileStatCache
        .lookup(generation, sessionId, file.path, (sid, path, signal) => requireSessionTools(sid).statFile(sid, path, signal))
        .then(outcome => {
          if (!active || outcome.status !== 'ok' || outcome.bytes === undefined) return
          setResolvedBytes(prev => (prev[file.path] === outcome.bytes ? prev : { ...prev, [file.path]: outcome.bytes! }))
        })
    }
    return () => {
      active = false
    }
  }, [connected, files, sessionId])

  if (files.length === 0) return null

  return (
    <View style={styles.stack}>
      {files.map(file => (
        <SubmittedFileCard
          key={file.path}
          file={file}
          resolvedBytes={file.bytes ?? resolvedBytes[file.path]}
          onPress={onFilePress}
        />
      ))}
    </View>
  )
})

const styles = StyleSheet.create({
  stack: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    gap: 6,
    maxWidth: '100%',
  },
})
