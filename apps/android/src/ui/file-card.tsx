import React, { memo, useState } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { ChevronDown, ChevronRight, Files } from 'lucide-react-native'
import { strings } from '../locales/i18n'
import { useTheme } from './theme-context'
import { DshFileTypeIcon, classifyDshFileType, getDshCategoryTheme } from './dsh-icons'

export interface PresentedFileItem {
  path: string
  name?: string
  description?: string
  binary?: boolean
  action?: 'created' | 'edited' | 'deleted' | 'presented'
  size?: number | string
}

export interface PresentedFileCardProps {
  file: PresentedFileItem
  onFilePress?: (path: string) => void
  style?: StyleProp<ViewStyle>
}

export const PresentedFileCard = memo(function PresentedFileCard({ file, onFilePress, style }: PresentedFileCardProps) {
  const { colors } = useTheme()
  const category = classifyDshFileType(file.path)
  const theme = getDshCategoryTheme(category)
  const filename = file.name || file.path.split(/[/\\]/u).pop() || file.path
  const actionLabel = file.action === 'created' ? 'Created' : file.action === 'deleted' ? 'Deleted' : file.action === 'edited' ? 'Edited' : ''
  const isImageOrBinary =
    file.binary || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(filename.split('.').pop()?.toLowerCase() || '')

  let metaText = file.description || (isImageOrBinary ? 'binary' : theme.label)
  if (file.size) {
    metaText = typeof file.size === 'number' ? `${(file.size / 1024).toFixed(1)} KB` : file.size
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${actionLabel} ${filename} · ${metaText}`}
      onPress={() => onFilePress?.(file.path)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      <View style={[styles.tile, { backgroundColor: theme.bgTint, borderColor: colors.border }]}>
        <DshFileTypeIcon path={file.path} size={22} />
      </View>
      <View style={styles.info}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.ink }]}>
          {actionLabel ? `${actionLabel} ` : ''}<Text style={styles.filename}>{filename}</Text>
        </Text>
        <Text numberOfLines={1} style={[styles.subtitle, { color: colors.muted }]}>
          {metaText}
        </Text>
      </View>
      <ChevronRight size={16} color={colors.muted} />
    </Pressable>
  )
})

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 58,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginVertical: 4,
    alignSelf: 'stretch',
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  info: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  filename: {
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
})

/** File references and real tool edits remain available without repeating a card stack in every reply. */
export const PresentedFileGroup = memo(function PresentedFileGroup({ files, onFilePress }: {
  files: PresentedFileItem[]
  onFilePress?: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { colors } = useTheme()
  if (files.length === 0) return null
  const label = `${strings.sessionActivity.relatedFiles} · ${files.length}`
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded }}
      onPress={() => setExpanded(value => !value)} style={({ pressed }) => ({
        minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 6, borderRadius: 8, backgroundColor: pressed ? colors.surfaceStrong : 'transparent',
      })}>
      <Files size={17} color={colors.muted} />
      <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: colors.muted }} numberOfLines={1}>{label}</Text>
      {expanded ? <ChevronDown size={16} color={colors.muted} /> : <ChevronRight size={16} color={colors.muted} />}
    </Pressable>
    {expanded && files.map(file => <PresentedFileCard key={file.path} file={file} onFilePress={onFilePress} />)}
  </View>
})
