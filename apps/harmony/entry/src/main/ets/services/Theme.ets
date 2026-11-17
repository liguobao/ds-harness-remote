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
  text3: string = '';
}

export function darkPalette(): Palette {
  const p: Palette = new Palette();
  p.bg = '#070B16';
  p.panel = '#0B101E';
  p.backdrop = 'rgba(2,5,12,0.55)';
  p.card = 'rgba(255,255,255,0.045)';
  p.chip = 'rgba(255,255,255,0.06)';
  p.inputBg = 'rgba(255,255,255,0.07)';
  p.border = 'rgba(255,255,255,0.08)';
  p.borderStrong = 'rgba(255,255,255,0.12)';
  p.text = '#EAF0FB';
  p.text2 = '#9AA5B8';
  p.text3 = '#6B7280';
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
  p.bg = '#F2F5FA';
  p.panel = '#FFFFFF';
  p.backdrop = 'rgba(15,23,42,0.35)';
  p.card = '#FFFFFF';
  p.chip = 'rgba(15,23,42,0.05)';
  p.inputBg = '#FFFFFF';
  p.border = 'rgba(15,23,42,0.08)';
  p.borderStrong = 'rgba(15,23,42,0.14)';
  p.text = '#1B2437';
  p.text2 = '#5B6478';
  p.text3 = '#98A1B3';
  return p;
}
