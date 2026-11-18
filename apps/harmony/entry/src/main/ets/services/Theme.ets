import { common2D, drawing } from '@kit.ArkGraphics2D';

const TINT_FILTER_CACHE: Map<string, drawing.ColorFilter> = new Map();

/**
 * Tint an SVG vector icon via SRC_IN blend mode so stroked outlines remain crisp and hollow
 * instead of having HarmonyOS Image.fillColor() fill interior transparent regions.
 */
export function iconTintFilter(hex: string): drawing.ColorFilter {
  const cached: drawing.ColorFilter | undefined = TINT_FILTER_CACHE.get(hex);
  if (cached !== undefined) {
    return cached;
  }
  const clean: string = hex.startsWith('#') ? hex.slice(1) : hex;
  let alpha: number = 255;
  let rgbStart: number = 0;
  if (clean.length === 8) {
    alpha = parseInt(clean.slice(0, 2), 16);
    rgbStart = 2;
  }
  const red: number = clean.length >= rgbStart + 6 ? parseInt(clean.slice(rgbStart, rgbStart + 2), 16) : 15;
  const green: number = clean.length >= rgbStart + 6 ? parseInt(clean.slice(rgbStart + 2, rgbStart + 4), 16) : 15;
  const blue: number = clean.length >= rgbStart + 6 ? parseInt(clean.slice(rgbStart + 4, rgbStart + 6), 16) : 15;
  const color: common2D.Color = { alpha, red, green, blue };
  const filter: drawing.ColorFilter = drawing.ColorFilter.createBlendModeColorFilter(
    color,
    drawing.BlendMode.SRC_IN
  );
  TINT_FILTER_CACHE.set(hex, filter);
  return filter;
}

/**
 * Semantic color palette swapped by theme (dark / light / follow-system).
 * Accents, gradients and status colors stay constant across themes.
 */
export class Palette {
  /** Window / screen background. */
  bg: string = '';
  /** Overlay panel background (sessions drawer). */
  panel: string = '';
  /** Scrim behind overlays. */
  backdrop: string = '';
  /** Card / row / bubble surfaces. */
  card: string = '';
  /** User-sent message bubble surface (matching Android theme.userBubble). */
  userBubble: string = '';
  /** Ghost chips and quiet buttons. */
  chip: string = '';
  /** Text input background. */
  inputBg: string = '';
  /** Hairline dividers and regular borders. */
  border: string = '';
  /** Emphasized borders. */
  borderStrong: string = '';
  /** Primary text. */
  text: string = '';
  /** Secondary text. */
  text2: string = '';
  /** Tertiary / hint text. */
  text3: string = '';
}

export function darkPalette(): Palette {
  const p: Palette = new Palette();
  p.bg = '#0B0D11';
  p.panel = '#161A21';
  p.backdrop = 'rgba(0,0,0,0.62)';
  p.card = 'rgba(255,255,255,0.05)';
  p.userBubble = '#1E2430';
  p.chip = '#232832';
  p.inputBg = '#1D222B';
  p.border = '#2B313C';
  p.borderStrong = '#394150';
  p.text = '#F2F4F7';
  p.text2 = '#A2A9B6';
  p.text3 = '#7A8291';
  return p;
}

/**
 * 主题着色：在深/浅底色的基础上换一套「氛围色」（背景/面板/表面/分隔线），
 * 强调色保持品牌蓝青，避免把整界面配色拆成两套维护。
 * tint: 0 默认 · 1 深海 · 2 森林 · 3 暖沙 · 4 玫紫
 */
export function applyTint(p: Palette, tint: number, dark: boolean): Palette {
  if (tint === 0) {
    return p;
  }
  const out: Palette = new Palette();
  out.bg = p.bg;
  out.panel = p.panel;
  out.backdrop = p.backdrop;
  out.card = p.card;
  out.userBubble = p.userBubble;
  out.chip = p.chip;
  out.inputBg = p.inputBg;
  out.border = p.border;
  out.borderStrong = p.borderStrong;
  out.text = p.text;
  out.text2 = p.text2;
  out.text3 = p.text3;
  if (tint === 1) {
    out.bg = dark ? '#05101F' : '#EDF4FB';
    out.panel = dark ? '#081A2E' : '#F7FBFF';
    out.card = dark ? 'rgba(88,166,255,0.07)' : '#FFFFFF';
    out.chip = dark ? 'rgba(88,166,255,0.10)' : 'rgba(30,90,160,0.06)';
  } else if (tint === 2) {
    out.bg = dark ? '#06140F' : '#EEF7F0';
    out.panel = dark ? '#0A1C15' : '#F7FCF8';
    out.card = dark ? 'rgba(52,211,153,0.07)' : '#FFFFFF';
    out.chip = dark ? 'rgba(52,211,153,0.10)' : 'rgba(20,120,80,0.06)';
  } else if (tint === 3) {
    out.bg = dark ? '#17110A' : '#FBF4E9';
    out.panel = dark ? '#1F1810' : '#FFFBF3';
    out.card = dark ? 'rgba(240,180,90,0.08)' : '#FFFFFF';
    out.chip = dark ? 'rgba(240,180,90,0.10)' : 'rgba(150,100,20,0.06)';
  } else if (tint === 4) {
    out.bg = dark ? '#140A16' : '#FAEFF7';
    out.panel = dark ? '#1D0F1F' : '#FFFAFD';
    out.card = dark ? 'rgba(217,120,220,0.08)' : '#FFFFFF';
    out.chip = dark ? 'rgba(217,120,220,0.10)' : 'rgba(120,20,110,0.06)';
  }
  return out;
}

export function lightPalette(): Palette {
  const p: Palette = new Palette();
  p.bg = '#F8F8F8';
  p.panel = '#FFFFFF';
  p.backdrop = 'rgba(15,15,15,0.42)';
  p.card = '#FFFFFF';
  p.userBubble = '#ECEFF5';
  p.chip = '#ECEFF4';
  p.inputBg = '#FFFFFF';
  p.border = '#EDEDED';
  p.borderStrong = '#DCE1EA';
  p.text = '#0F0F0F';
  p.text2 = '#59606D';
  p.text3 = '#8E96A4';
  return p;
}
