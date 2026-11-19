import { memo, useMemo } from 'react'
import { ScrollView, Text, useWindowDimensions } from 'react-native'
import { SvgXml } from 'react-native-svg'
import { renderMathSvg } from './math-svg'
import { useTheme } from './theme-context'
import { resolveChatMetrics, spacing } from './theme'

export const MathFormula = memo(function MathFormula({ source, display = false }: { source: string; display?: boolean }) {
  const { colors, appearance } = useTheme()
  const { fontScale, width: screenWidth } = useWindowDimensions()
  const result = useMemo(() => renderMathSvg(source, display), [source, display])
  if (!result) return <Text selectable style={{ color: colors.ink }}>{display ? `\\[${source}\\]` : `\\(${source}\\)`}</Text>
  const metrics = resolveChatMetrics(appearance)
  const bodySize = metrics.bodyFontSize
  const size = display ? bodySize * fontScale : Math.min(bodySize * fontScale, Math.max(80, screenWidth - 96) / result.width)
  const formula = <SvgXml xml={result.xml} width={result.width * size} height={result.height * size} color={colors.ink} accessible accessibilityLabel={source} />
  return display
    ? <ScrollView horizontal showsHorizontalScrollIndicator style={{ marginVertical: Math.max(4, Math.round(metrics.paragraphGap / 2)) }} contentContainerStyle={{ paddingVertical: spacing.xxs }}>{formula}</ScrollView>
    : formula
})
