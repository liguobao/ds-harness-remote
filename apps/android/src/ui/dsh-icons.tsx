import React, { memo } from 'react'
import Svg, { Path, G, Rect } from 'react-native-svg'
import {
  type DshLinkIconKind,
  type DshFileCategory,
  type DshCategoryTheme,
  classifyDshFileType,
  classifyDshLinkPath,
  getDshCategoryTheme,
} from './file-glyph'

export {
  type DshLinkIconKind,
  type DshFileCategory,
  type DshCategoryTheme,
  classifyDshFileType,
  classifyDshLinkPath,
  getDshCategoryTheme,
}

export interface DshLinkIconProps {
  kind: DshLinkIconKind
  size?: number
  color?: string
  strokeWidth?: number
}

/**
 * 1:1 Official DeepSeek Harness link icon SVG glyphs from LinkIcon.tsx:
 * - PhotoGlyph (image)
 * - CodeBracketsArtwork (code)
 * - PaperDocGlyph (document)
 * - PaperGlyph (other / general files)
 */
export const DshLinkIcon = memo(function DshLinkIcon({
  kind,
  size = 14,
  color = '#1a73e8',
  strokeWidth = 1.3,
}: DshLinkIconProps) {
  if (kind === 'image') {
    return (
      <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <Path
          d="M12.4326 2.38086H3.56763C2.46306 2.38086 1.56763 3.27629 1.56763 4.38086V11.6192C1.56763 12.7237 2.46306 13.6192 3.56763 13.6192H12.4326C13.5372 13.6192 14.4326 12.7237 14.4326 11.6192V4.38086C14.4326 3.27629 13.5372 2.38086 12.4326 2.38086Z"
          stroke={color}
          strokeWidth={strokeWidth}
        />
        <Path
          d="M10.536 7.03286C11.1948 7.03286 11.7288 6.49884 11.7288 5.8401C11.7288 5.18136 11.1948 4.64734 10.536 4.64734C9.87728 4.64734 9.34326 5.18136 9.34326 5.8401C9.34326 6.49884 9.87728 7.03286 10.536 7.03286Z"
          stroke={color}
          strokeWidth={strokeWidth}
        />
        <Path
          d="M1.5979 9.28409L4.17738 7.37514C4.57462 7.08117 5.12701 7.12145 5.47741 7.46992L8.3322 10.309C8.6572 10.6323 9.1605 10.6931 9.5532 10.4566L10.8859 9.65399C11.2531 9.43289 11.7205 9.47039 12.0477 9.74729L14.2823 11.6379"
          stroke={color}
          strokeWidth={strokeWidth}
        />
      </Svg>
    )
  }

  if (kind === 'code') {
    return (
      <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <Path
          d="M4.67398 4.25061L1.36094 7.86484C1.29085 7.9413 1.29085 8.05866 1.36094 8.13513L4.67398 11.7494"
          stroke={color}
          strokeWidth={strokeWidth}
        />
        <Path
          d="M11.3262 4.25061L14.6392 7.86484C14.7093 7.9413 14.7093 8.05866 14.6392 8.13513L11.3262 11.7494"
          stroke={color}
          strokeWidth={strokeWidth}
        />
        <Path d="M9.56222 3.62573L6.43774 12.3743" stroke={color} strokeWidth={strokeWidth} />
      </Svg>
    )
  }

  if (kind === 'document') {
    return (
      <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <Path
          d="M3.51919 14.5069H12.4807C13.0679 14.5069 13.5438 14.031 13.5438 13.4438V5.97499C13.5438 5.68818 13.428 5.41352 13.2226 5.21341L9.71251 1.79459C9.51402 1.60124 9.24781 1.49304 8.97075 1.49304H3.51919C2.93204 1.49304 2.45605 1.96902 2.45605 2.55618V13.4438C2.45605 14.031 2.93203 14.5069 3.51919 14.5069Z"
          stroke={color}
          strokeWidth={strokeWidth}
        />
        <Path d="M8.90454 1.6095V4.87091C8.90454 5.45806 9.38051 5.93405 9.96768 5.93405H13.4953" stroke={color} strokeWidth={strokeWidth} />
        <Path d="M4.31152 8.7561H7.83046" stroke={color} strokeWidth={strokeWidth} />
        <Path d="M4.31152 11.3651H9.36598" stroke={color} strokeWidth={strokeWidth} />
      </Svg>
    )
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M3.75275 14.271H12.2473C12.7749 14.271 13.2027 13.8433 13.2027 13.3156V5.91732C13.2027 5.65958 13.0985 5.41276 12.9139 5.23293L9.59477 2.00011C9.4164 1.82636 9.17717 1.72913 8.9282 1.72913H3.75275C3.22511 1.72913 2.79736 2.15686 2.79736 2.68451V13.3156C2.79736 13.8433 3.22511 14.271 3.75275 14.271Z"
        stroke={color}
        strokeWidth={strokeWidth}
      />
      <Path d="M8.84888 1.83838V4.94133C8.84888 5.46896 9.2766 5.89671 9.80426 5.89671H13.157" stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  )
})

/** Official DSH IconWrapFillRegular from CodeToolbar.tsx */
export const IconWrapFill = memo(function IconWrapFill({ size = 14, color = '#6E7681' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M10.9999 8C10.9999 6.89543 10.1046 6 9 6H4.5V5H9C10.6568 5 11.9999 6.34315 11.9999 8C11.9999 9.65685 10.6568 11 9 11H6.20703L6.85351 11.6465L6.14648 12.3535L4.64652 10.8536C4.45126 10.6583 4.45126 10.3417 4.64652 10.1464L6.14648 8.64648L6.85351 9.35352L6.20703 10H9C10.1046 10 10.9999 9.10457 10.9999 8Z"
        fill={color}
      />
      <Path d="M2 15H1V1H2V15Z" fill={color} />
      <Path d="M15 15H14V1H15V15Z" fill={color} />
    </Svg>
  )
})

/** Official DSH IconNowrapFillRegular from CodeToolbar.tsx */
export const IconNowrapFill = memo(function IconNowrapFill({ size = 14, color = '#6E7681' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path d="M2 15H1V1H2V15Z" fill={color} />
      <Path
        d="M12.3535 7.64645C12.5487 7.84171 12.5487 8.15829 12.3535 8.35355L9.85352 10.8535L9.14648 10.1465L10.793 8.5H3.5V7.5H10.793L9.14648 5.85352L9.85352 5.14648L12.3535 7.64645Z"
        fill={color}
      />
      <Path d="M15 15H14V1H15V15Z" fill={color} />
    </Svg>
  )
})

/** Official DSH IconCopyOutlineRegular from CodeToolbar.tsx */
export const IconCopyOutline = memo(function IconCopyOutline({ size = 14, color = '#6E7681' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Rect x="1.52075" y="4.07373" width="10.3932" height="10.3932" rx="2" stroke={color} strokeWidth={1.2} />
      <Path
        d="M11.9792 1.53296C13.36 1.53296 14.4792 2.65225 14.4792 4.03296V9.42847C14.4792 10.3756 13.9521 11.1987 13.1755 11.6228V10.3298C13.3652 10.0787 13.4792 9.7674 13.4792 9.42847V4.03296C13.4792 3.20453 12.8077 2.53296 11.9792 2.53296H6.58374C6.27966 2.53301 5.99684 2.6235 5.7605 2.77905H4.42358C4.85652 2.03463 5.66056 1.53304 6.58374 1.53296H11.9792Z"
        fill={color}
      />
    </Svg>
  )
})

/** Official DSH IconCheckOutlineRegular from CodeToolbar.tsx */
export const IconCheckOutline = memo(function IconCheckOutline({ size = 14, color = '#10B981' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4"
        stroke={color}
        strokeWidth={1.4}
      />
    </Svg>
  )
})

const FILE_BODY =
  'M8.48924 28H19.5108C21.6479 28 22.7165 28 23.5594 27.6509C24.6833 27.1853 25.5762 26.2924 26.0417 25.1685C26.3909 24.3256 26.3909 23.257 26.3909 21.1199V8.79443C26.3909 8.32877 26.3909 8.09593 26.3471 7.87507C26.2887 7.58058 26.173 7.30042 26.0067 7.05048C25.882 6.86303 25.7177 6.69799 25.3893 6.36792L20.0611 1.01354C19.7304 0.681235 19.5651 0.515081 19.3769 0.38885C19.126 0.220541 18.8443 0.103463 18.5481 0.0443412C18.3259 0 18.0915 0 17.6226 0H8.48924C6.35209 0 5.28351 0 4.4406 0.349145C3.31672 0.814671 2.4238 1.70759 1.95828 2.83147C1.60913 3.67438 1.60913 4.74296 1.60913 6.88011V21.1199C1.60913 23.257 1.60913 24.3256 1.95828 25.1685C2.4238 26.2924 3.31672 27.1853 4.4406 27.6509C5.28351 28 6.35209 28 8.48924 28Z'

const FILE_FOLD =
  'M26.3909 7.37445L19.0525 0V3.77445C19.0525 4.89271 19.0525 5.45184 19.2352 5.89289C19.4788 6.48096 19.946 6.94818 20.5341 7.19176C20.9751 7.37445 21.5342 7.37445 22.6525 7.37445H26.3909Z'

export interface DshFileTypeIconProps {
  path?: string
  category?: DshFileCategory
  size?: number
}

/**
 * 1:1 Official DeepSeek Harness FileTypeIcon from FileTypeIcon.tsx:
 * Renders 28x28 file silhouette + white folded flap + category SVG mark.
 */
export const DshFileTypeIcon = memo(function DshFileTypeIcon({
  path,
  category: explicitCategory,
  size = 24,
}: DshFileTypeIconProps) {
  const category = explicitCategory ?? (path ? classifyDshFileType(path) : 'other')
  const theme = getDshCategoryTheme(category)

  return (
    <Svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <Path d={FILE_BODY} fill={theme.color} />
      <Path d={FILE_FOLD} fill="#FFFFFF" fillOpacity={0.7} />
      {category === 'image' && (
        <G transform="translate(14 16) scale(1.12) translate(-14 -16)">
          <Path
            d="M10.4212 15.9204C10.5756 15.6558 10.9579 15.6558 11.1123 15.9204L13.6493 20.2696C13.8048 20.5362 13.6125 20.8711 13.3037 20.8711H8.22974C7.92102 20.8711 7.72868 20.5362 7.88423 20.2696L10.4212 15.9204Z"
            fill="#FFFFFF"
          />
          <Path
            d="M15.4981 13.186C15.6505 12.9117 16.0451 12.9117 16.1975 13.186L20.1368 20.2769C20.2849 20.5435 20.0922 20.8711 19.7872 20.8711H11.9084C11.6034 20.8711 11.4107 20.5435 11.5588 20.2769L15.4981 13.186Z"
            fill="#FFFFFF"
          />
          <Path
            d="M11.8603 11.3997C11.8603 12.286 11.1418 13.0045 10.2555 13.0045C9.36924 13.0045 8.65076 12.286 8.65076 11.3997C8.65076 10.5134 9.36924 9.79492 10.2555 9.79492C11.1418 9.79492 11.8603 10.5134 11.8603 11.3997Z"
            fill="#FFFFFF"
          />
        </G>
      )}
      {category === 'code' && (
        <G>
          <Path d="M10.0053 13.126L7.0236 16.3788C6.96052 16.4476 6.96052 16.5532 7.0236 16.622L10.0053 19.8748" stroke="#FFFFFF" strokeWidth={1.35} />
          <Path d="M17.9941 13.126L20.9759 16.3788C21.039 16.4476 21.039 16.5532 20.9759 16.622L17.9941 19.8748" stroke="#FFFFFF" strokeWidth={1.35} />
          <Path d="M15.2652 12.957L12.7344 20.0433" stroke="#FFFFFF" strokeWidth={1.35} />
        </G>
      )}
      {category === 'excel' && (
        <Path
          d="M14 11.5H11.4C10.5599 11.5 10.1399 11.5 9.81901 11.6635C9.53677 11.8073 9.3073 12.0368 9.16349 12.319C9 12.6399 9 13.0599 9 13.9V16.5M14 11.5H16.6C17.4401 11.5 17.8601 11.5 18.181 11.6635C18.4632 11.8073 18.6927 12.0368 18.8365 12.319C19 12.6399 19 13.0599 19 13.9V16.5M14 11.5V21.5M14 21.5H16.6C17.4401 21.5 17.8601 21.5 18.181 21.3365C18.4632 21.1927 18.6927 20.9632 18.8365 20.681C19 20.3601 19 19.9401 19 19.1V16.5M14 21.5H11.4C10.5599 21.5 10.1399 21.5 9.81901 21.3365C9.53677 21.1927 9.3073 20.9632 9.16349 20.681C9 20.3601 9 19.9401 9 19.1V16.5M19 16.5H9"
          stroke="#FFFFFF"
          strokeWidth={1.2}
        />
      )}
      {category === 'markdown' && (
        <G transform="translate(14 16) scale(1.22) translate(-14 -16)">
          <Path
            d="M8.7588 19.5V14.6H9.8998L11.9298 17.932H11.3278L13.3018 14.6H14.4428L14.4568 19.5H13.1828L13.1688 16.539H13.3858L11.9088 19.017H11.2928L9.7738 16.539H10.0398V19.5H8.7588ZM15.4375 19.5V14.6H17.7545C18.2958 14.6 18.7718 14.7003 19.1825 14.901C19.5932 15.1017 19.9128 15.384 20.1415 15.748C20.3748 16.112 20.4915 16.546 20.4915 17.05C20.4915 17.5493 20.3748 17.9833 20.1415 18.352C19.9128 18.716 19.5932 18.9983 19.1825 19.199C18.7718 19.3997 18.2958 19.5 17.7545 19.5H15.4375ZM16.8235 18.394H17.6985C17.9785 18.394 18.2212 18.3427 18.4265 18.24C18.6365 18.1327 18.7998 17.9787 18.9165 17.778C19.0332 17.5727 19.0915 17.33 19.0915 17.05C19.0915 16.7653 19.0332 16.5227 18.9165 16.322C18.7998 16.1213 18.6365 15.9697 18.4265 15.867C18.2212 15.7597 17.9785 15.706 17.6985 15.706H16.8235V18.394Z"
            fill="#FFFFFF"
          />
        </G>
      )}
      {category === 'pdf' && (
        <G transform="translate(14 16) scale(1.22) translate(-14 -16)">
          <Path
            d="M6.80616 19.5V14.6H9.04616C9.49416 14.6 9.87916 14.6723 10.2012 14.817C10.5278 14.9617 10.7798 15.1717 10.9572 15.447C11.1345 15.7177 11.2232 16.0397 11.2232 16.413C11.2232 16.7817 11.1345 17.1013 10.9572 17.372C10.7798 17.6427 10.5278 17.8527 10.2012 18.002C9.87916 18.1467 9.49416 18.219 9.04616 18.219H7.57616L8.19216 17.617V19.5H6.80616ZM8.19216 17.764L7.57616 17.127H8.96216C9.2515 17.127 9.46616 17.064 9.60616 16.938C9.75083 16.812 9.82316 16.637 9.82316 16.413C9.82316 16.1843 9.75083 16.007 9.60616 15.881C9.46616 15.755 9.2515 15.692 8.96216 15.692H7.57616L8.19216 15.055V17.764ZM11.8989 19.5V14.6H14.2159C14.7573 14.6 15.2333 14.7003 15.6439 14.901C16.0546 15.1017 16.3743 15.384 16.6029 15.748C16.8363 16.112 16.9529 16.546 16.9529 17.05C16.9529 17.5493 16.8363 17.9833 16.6029 18.352C16.3743 18.716 16.0546 18.9983 15.6439 19.199C15.2333 19.3997 14.7573 19.5 14.2159 19.5H11.8989ZM13.2849 18.394H14.1599C14.4399 18.394 14.6826 18.3427 14.8879 18.24C15.0979 18.1327 15.2613 17.9787 15.3779 17.778C15.4946 17.5727 15.5529 17.33 15.5529 17.05C15.5529 16.7653 15.4946 16.5227 15.3779 16.322C15.2613 16.1213 15.0979 15.9697 14.8879 15.867C14.6826 15.7597 14.4399 15.706 14.1599 15.706H13.2849V18.394ZM17.6821 19.5V14.6H21.5251V15.671H19.0681V19.5H17.6821ZM18.9701 17.82V16.749H21.2311V17.82H18.9701Z"
            fill="#FFFFFF"
          />
        </G>
      )}
    </Svg>
  )
})
