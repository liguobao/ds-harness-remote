import React, { memo } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
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
  const actionLabel = file.action === 'created' ? 'Created' : file.action === 'deleted' ? 'Deleted' : 'Edited'
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
          {actionLabel} <Text style={styles.filename}>{filename}</Text>
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
