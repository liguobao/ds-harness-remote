import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useTheme } from './theme-context'
import { resolveChatMetrics } from './theme'
import { monoFontFamily } from './platform-style'
import { DARK_CODE_PALETTE, highlightCode, LIGHT_CODE_PALETTE, partitionHighlightedCodeTokens, type SyntaxPalette, type SyntaxToken, type SyntaxTokenKind } from './syntax-highlight'
import { IconWrapFill, IconNowrapFill, IconCopyOutline, IconCheckOutline } from './dsh-icons'
import { findMatchRanges, type TextMatchRange } from '../screens/chat/chat-search'

export interface CodeBlockSearchHighlight {
  query: string
  activeLocalIndex: number | null
  baseIndex: number
}

export interface CodeBlockProps {
  code: string
  language?: string
  style?: StyleProp<ViewStyle>
  searchHighlight?: CodeBlockSearchHighlight
}

const COPY_RESET_MS = 2000
export const MAX_HIGHLIGHT_CACHE_ENTRIES = 256
export const MAX_HIGHLIGHT_CACHE_CODE_LEN = 16_384

const highlightCache = new Map<string, SyntaxToken[]>()

export function highlightCodeCached(cleanCode: string, language?: string): SyntaxToken[] {
  if (cleanCode.length > MAX_HIGHLIGHT_CACHE_CODE_LEN) {
    return highlightCode(cleanCode, language)
  }
  const key = `${language ?? ''}\0${cleanCode}`
  const cached = highlightCache.get(key)
  if (cached !== undefined) {
    highlightCache.delete(key)
    highlightCache.set(key, cached)
    return cached
  }
  const tokens = highlightCode(cleanCode, language)
  if (highlightCache.size >= MAX_HIGHLIGHT_CACHE_ENTRIES) {
    const oldestKey = highlightCache.keys().next().value
    if (oldestKey !== undefined) highlightCache.delete(oldestKey)
  }
  highlightCache.set(key, tokens)
  return tokens
}

const paletteStylesCache = new WeakMap<SyntaxPalette, Record<SyntaxTokenKind, StyleProp<TextStyle>>>()

function getPaletteTokenStyles(palette: SyntaxPalette): Record<SyntaxTokenKind, StyleProp<TextStyle>> {
  const cached = paletteStylesCache.get(palette)
  if (cached !== undefined) return cached
  const map: Record<SyntaxTokenKind, StyleProp<TextStyle>> = {
    plain: undefined,
    comment: [{ color: palette.comment }, styles.commentToken],
    string: { color: palette.string },
    keyword: [{ color: palette.keyword }, styles.keywordToken],
    number: { color: palette.number },
    type: { color: palette.type },
    function: { color: palette.function },
    property: { color: palette.property },
    operator: { color: palette.operator },
  }
  paletteStylesCache.set(palette, map)
  return map
}

function renderCoalescedCodeTokens(tokens: readonly SyntaxToken[], palette: SyntaxPalette) {
  const tokenStyles = getPaletteTokenStyles(palette)
  const out: React.ReactNode[] = []
  let plainBuffer = ''
  const flushPlain = () => {
    if (plainBuffer.length > 0) {
      out.push(plainBuffer)
      plainBuffer = ''
    }
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!
    if (token.kind === 'plain' || token.text.trim().length === 0) {
      plainBuffer += token.text
      continue
    }
    flushPlain()
    out.push(
      <Text key={i} style={tokenStyles[token.kind]}>
        {token.text}
      </Text>,
    )
  }
  flushPlain()
  return out
}

function renderHighlightedLineTokens(
  lineTokens: readonly SyntaxToken[],
  ranges: readonly TextMatchRange[],
  baseIndex: number,
  activeLocalIndex: number | null,
  palette: SyntaxPalette,
  scheme: 'light' | 'dark',
): React.ReactNode[] {
  const tokenStyles = getPaletteTokenStyles(palette)
  if (ranges.length === 0) {
    return lineTokens.map((token, i) =>
      token.kind === 'plain' ? token.text : <Text key={i} style={tokenStyles[token.kind]}>{token.text}</Text>,
    )
  }
  const activeBg = '#F59E0B'
  const inactiveBg = scheme === 'dark' ? 'rgba(250, 204, 21, 0.34)' : 'rgba(253, 224, 71, 0.52)'
  const out: React.ReactNode[] = []
  let pos = 0
  let rangeIdx = 0
  let keyCounter = 0
  for (let i = 0; i < lineTokens.length; i += 1) {
    const token = lineTokens[i]!
    const tokenEnd = pos + token.text.length
    let cursor = pos
    while (rangeIdx < ranges.length && ranges[rangeIdx]!.end <= cursor) {
      rangeIdx += 1
    }
    while (cursor < tokenEnd) {
      const range = rangeIdx < ranges.length ? ranges[rangeIdx] : undefined
      if (range === undefined || range.start >= tokenEnd) {
        const chunk = token.text.slice(cursor - pos)
        if (chunk.length > 0) {
          out.push(token.kind === 'plain' ? chunk : <Text key={keyCounter++} style={tokenStyles[token.kind]}>{chunk}</Text>)
        }
        cursor = tokenEnd
      } else if (cursor < range.start) {
        const end = Math.min(tokenEnd, range.start)
        const chunk = token.text.slice(cursor - pos, end - pos)
        if (chunk.length > 0) {
          out.push(token.kind === 'plain' ? chunk : <Text key={keyCounter++} style={tokenStyles[token.kind]}>{chunk}</Text>)
        }
        cursor = end
      } else {
        const end = Math.min(tokenEnd, range.end)
        const chunk = token.text.slice(cursor - pos, end - pos)
        const isActive = activeLocalIndex === baseIndex + rangeIdx
        if (chunk.length > 0) {
          out.push(
            <Text
              key={keyCounter++}
              style={[
                tokenStyles[token.kind],
                {
                  backgroundColor: isActive ? activeBg : inactiveBg,
                  color: isActive ? '#0F0F0F' : (token.kind === 'plain' ? palette.plain : palette[token.kind]),
                  fontWeight: isActive ? '700' : undefined,
                },
              ]}
            >
              {chunk}
            </Text>,
          )
        }
        cursor = end
        if (cursor >= range.end) rangeIdx += 1
      }
    }
    pos = tokenEnd
  }
  return out
}

function splitHighlightedLines(
  tokens: readonly SyntaxToken[],
  palette: SyntaxPalette,
  searchHighlight?: CodeBlockSearchHighlight,
  scheme: 'light' | 'dark' = 'light',
): React.ReactNode[][] {
  const tokenStyles = getPaletteTokenStyles(palette)
  const tokenChunks = partitionHighlightedCodeTokens(tokens)
  let lineBase = searchHighlight?.baseIndex ?? 0
  return tokenChunks.map(chunkTokens => {
    if (chunkTokens.length === 0) return [' ']
    if (searchHighlight !== undefined) {
      const lineText = chunkTokens.map(t => t.text).join('')
      const ranges = findMatchRanges(lineText, searchHighlight.query)
      const nodes = renderHighlightedLineTokens(
        chunkTokens,
        ranges,
        lineBase,
        searchHighlight.activeLocalIndex,
        palette,
        scheme,
      )
      lineBase += ranges.length
      return nodes
    }
    const nodes: React.ReactNode[] = []
    for (let i = 0; i < chunkTokens.length; i += 1) {
      const token = chunkTokens[i]!
      if (token.kind === 'plain') {
        nodes.push(token.text)
      } else {
        nodes.push(
          <Text key={i} style={tokenStyles[token.kind]}>
            {token.text}
          </Text>,
        )
      }
    }
    return nodes
  })
}

const ANDROID_SPLIT_LINE_TOKEN_THRESHOLD = 24

export const CodeBlockView = memo(function CodeBlockView({ code, language, style, searchHighlight }: CodeBlockProps) {
  const { colors, scheme, appearance } = useTheme()
  const metrics = resolveChatMetrics(appearance)
  const useDarkCode = appearance.codeTheme === 'dark' || (appearance.codeTheme === 'auto' && scheme === 'dark')
  const codeScheme: 'light' | 'dark' = useDarkCode ? 'dark' : 'light'
  const palette = useDarkCode ? DARK_CODE_PALETTE : LIGHT_CODE_PALETTE
  const [wrap, setWrap] = useState<boolean>(false)
  const [copied, setCopied] = useState<boolean>(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cleanCode = (code || '').replace(/\n+$/u, '')
  const label = (language || 'code').toLowerCase()
  const tokens = React.useMemo(() => highlightCodeCached(cleanCode, language), [cleanCode, language])
  const splitByLine = Platform.OS === 'android' && tokens.length > ANDROID_SPLIT_LINE_TOKEN_THRESHOLD
  const tokenChildren = React.useMemo(() => {
    if (splitByLine) return null
    if (searchHighlight === undefined) return renderCoalescedCodeTokens(tokens, palette)
    const ranges = findMatchRanges(cleanCode, searchHighlight.query)
    return renderHighlightedLineTokens(
      tokens,
      ranges,
      searchHighlight.baseIndex,
      searchHighlight.activeLocalIndex,
      palette,
      codeScheme,
    )
  }, [splitByLine, tokens, palette, searchHighlight, cleanCode, codeScheme])
  const highlightedLines = React.useMemo(
    () => (splitByLine ? splitHighlightedLines(tokens, palette, searchHighlight, codeScheme) : null),
    [splitByLine, tokens, palette, searchHighlight, codeScheme],
  )

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const handleToggleWrap = useCallback(() => {
    setWrap(prev => !prev)
  }, [])

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(cleanCode)
      setCopied(true)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => setCopied(false), COPY_RESET_MS)
    } catch {
      // Ignore clipboard error on devices without permission
    }
  }, [cleanCode])

  const codeTextStyle: StyleProp<TextStyle> = [
    styles.codeText,
    {
      color: palette.plain,
      fontSize: metrics.codeFontSize,
      lineHeight: metrics.codeLineHeight,
      flexShrink: wrap ? 1 : 0,
    },
  ]

  const renderedTokens = highlightedLines !== null ? (
    <View style={wrap ? styles.codeLinesWrap : styles.codeLinesScroll}>
      {highlightedLines.map((lineNodes, lineIdx) => (
        <Text key={lineIdx} selectable style={codeTextStyle}>
          {lineNodes}
        </Text>
      ))}
    </View>
  ) : (
    <Text selectable style={codeTextStyle}>
      {tokenChildren}
    </Text>
  )

  return (
    <View style={[styles.container, { backgroundColor: palette.background, borderColor: palette.border }, style]}>
      <View style={[styles.header, { borderBottomColor: palette.border, backgroundColor: palette.headerBackground }]}>
        <Text numberOfLines={1} style={[styles.language, { color: palette.headerText }]}>
          {label}
        </Text>
        <View style={styles.actions}>
          <Pressable
            onPress={handleToggleWrap}
            accessibilityRole="button"
            accessibilityLabel={wrap ? 'Switch to scroll mode' : 'Switch to wrap mode'}
            hitSlop={8}
            style={({ pressed }) => [
              styles.actionButton,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            {wrap ? (
              <IconNowrapFill size={14} color={palette.plain} />
            ) : (
              <IconWrapFill size={14} color={palette.headerText} />
            )}
          </Pressable>
          <Pressable
            onPress={handleCopy}
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Copied' : 'Copy code'}
            hitSlop={8}
            style={({ pressed }) => [
              styles.actionButton,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            {copied ? (
              <IconCheckOutline size={14} color={colors.success} />
            ) : (
              <IconCopyOutline size={14} color={palette.headerText} />
            )}
          </Pressable>
        </View>
      </View>

      {wrap ? (
        <View style={[styles.wrapBody, { padding: 10 }]}>
          {renderedTokens}
        </View>
      ) : (
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator
          contentContainerStyle={[styles.scrollContent, { padding: 10 }]}
          keyboardShouldPersistTaps="handled"
        >
          {renderedTokens}
        </ScrollView>
      )}
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginVertical: 6,
    alignSelf: 'stretch',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  language: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionButton: {
    width: 26,
    height: 26,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    minWidth: '100%',
  },
  wrapBody: {},
  codeLinesScroll: {
    alignItems: 'flex-start',
  },
  codeLinesWrap: {
    alignSelf: 'stretch',
  },
  codeText: {
    fontFamily: monoFontFamily,
    includeFontPadding: false,
  },
  commentToken: {
    fontStyle: 'italic',
  },
  keywordToken: {
    fontWeight: '600',
  },
})
