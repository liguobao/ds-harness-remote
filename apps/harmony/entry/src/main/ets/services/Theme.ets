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
