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
  primary: string = '';
  primarySoft: string = '';
  inverse: string = '';
  onInverse: string = '';
  success: string = '';
  danger: string = '';
  userBubble: string = '';
  text3: string = '';
}

export function darkPalette(): Palette {
  const p: Palette = new Palette();
  p.bg = '#0B0D11';
  p.panel = '#161A21';
  p.backdrop = 'rgba(0, 0, 0, 0.58)';
  p.card = 'rgba(255, 255, 255, 0.05)';
  p.chip = '#232832';
  p.inputBg = '#161A21';
  p.border = '#2B313C';
  p.borderStrong = '#2B313C';
  p.text = '#F2F4F7';
  p.text2 = '#A2A9B6';
  p.text3 = '#A2A9B6';
  p.primary = '#6F89FF';
  p.primarySoft = '#19213F';
  p.inverse = '#F2F4F7';
  p.onInverse = '#0B0D11';
  p.success = '#4CC07D';
  p.danger = '#F2736C';
  p.userBubble = '#1E2430';
  return p;
}

/**
 * 主题着色：在深/浅底色的基础上换一套「氛围色」（背景/面板/表面/分隔线），
 * 强调色保持 Android 的品牌蓝，避免把整界面配色拆成两套维护。
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
  out.chip = p.chip;
  out.inputBg = p.inputBg;
  out.border = p.border;
  out.borderStrong = p.borderStrong;
  out.text = p.text;
  out.text2 = p.text2;
  out.text3 = p.text3;
  out.primary = p.primary;
  out.primarySoft = p.primarySoft;
  out.inverse = p.inverse;
  out.onInverse = p.onInverse;
  out.success = p.success;
  out.danger = p.danger;
  out.userBubble = p.userBubble;
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
  p.backdrop = 'rgba(15, 15, 15, 0.40)';
  p.card = '#FFFFFF';
  p.chip = '#ECEFF4';
  p.inputBg = '#FFFFFF';
  p.border = '#EDEDED';
  p.borderStrong = '#EDEDED';
  p.text = '#0F0F0F';
  p.text2 = '#59606D';
  p.text3 = '#59606D';
  p.primary = '#4D6BFE';
  p.primarySoft = '#EBEFFF';
  p.inverse = '#0F0F0F';
  p.onInverse = '#FFFFFF';
  p.success = '#1E8449';
  p.danger = '#C2362F';
  p.userBubble = '#ECEFF5';
  return p;
}
