import { util } from '@kit.ArkTS';
import { BotEntry } from '../net/BotClient';
import { asArray, asNum, asRecord, asStr } from '../protocol/Types';
import { CHARACTER_DATA, AGENT_LOGO_DATA } from './bot-assets/AvatarData';

const SHAPES: string[] = ['star', 'moon', 'gumdrop', 'peanut', 'bunny', 'kitty', 'acorn'];
const INKS: string[] = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet', 'magenta'];
const BADGES: Record<string, string[]> = {
  'devin-cli': ['DV', 'violet'], 'claude-code': ['CC', 'tangerine'], 'codex-cli': ['CX', 'green'],
  'opencode': ['OC', 'blue'], 'cursor-cli': ['CU', 'magenta'], 'gemini-cli': ['GM', 'yellow'],
  'grok-cli': ['GX', 'graphite'], 'cline': ['CL', 'cyan'], 'qwen-code': ['QW', 'cobalt'], 'goose': ['GS', 'brown']
};
const DATA: Record<string, Object> = JSON.parse(CHARACTER_DATA) as Record<string, Object>;
const LOGOS: Record<string, Object> = JSON.parse(AGENT_LOGO_DATA) as Record<string, Object>;

function inkColor(name: string, dark: boolean): string {
  const inks = asRecord(DATA['inks']);
  const colors = inks !== undefined ? asArray(inks[name]) : undefined;
  return (colors !== undefined ? asStr(colors[dark ? 1 : 0]) : undefined) ?? '#4D6BFE';
}

function seedFor(id: string): number {
  let value = 2166136261;
  for (let i = 0; i < id.length; i++) value = Math.imul(value ^ id.charCodeAt(i), 16777619);
  return value >>> 0;
}

function svgUri(svg: string): string {
  return 'data:image/svg+xml;base64,' + new util.Base64Helper().encodeToStringSync(new util.TextEncoder().encodeInto(svg));
}

function engineFor(bot: BotEntry): string {
  if (bot.engine.length > 0) return bot.engine;
  const provider = (bot.model || bot.appliedModel).split('/')[0];
  return BADGES[provider] !== undefined || provider.startsWith('acp-') ? provider : '';
}

function agentSvg(engine: string): string {
  const logo = asRecord(LOGOS[engine]);
  let body: string;
  if (logo !== undefined) {
    body = '<rect width="64" height="64" rx="16" fill="#fff" stroke="#E5E7EB" stroke-width="1.5"/>' +
      '<path transform="translate(14 14) scale(1.5)" d="' + asStr(logo['d']) + '" fill="#' + asStr(logo['hex']) + '"/>';
  } else {
    const badge = BADGES[engine] ?? ['AC', 'rose'];
    body = '<rect width="64" height="64" rx="16" fill="' + inkColor(badge[1], false) + '"/>' +
      '<text x="32" y="41" text-anchor="middle" font-size="24" font-weight="700" fill="white">' + badge[0] + '</text>';
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' + body + '</svg>';
}

function characterSvg(bot: BotEntry, dark: boolean): string {
  const seed = seedFor(bot.id);
  let sh = Math.imul(seed ^ (seed >>> 16), 73244475);
  sh = Math.imul(sh ^ (sh >>> 13), 3266489909);
  const shape = bot.avatarShape || SHAPES[((sh ^ (sh >>> 16)) >>> 0) % SHAPES.length];
  const chars = asRecord(DATA['characters']);
  const character = chars !== undefined ? (asRecord(chars[shape]) ?? asRecord(chars['gumdrop'])) : undefined;
  if (character === undefined) return '';
  const t = (seed + 1831565813) | 0;
  let n = Math.imul(t ^ (t >>> 15), 1 | t);
  n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
  const color = bot.color || INKS[Math.floor(((n ^ (n >>> 14)) >>> 0) / 4294967296 * INKS.length)];
  const fill = /^#[0-9a-f]{6}$/i.test(color) ? color : inkColor(color, dark);
  let eyes = '';
  for (const item of asArray(character['eyes']) ?? []) {
    const e = asArray(item);
    if (e === undefined || e.length < 5) continue;
    const x = asNum(e[0]) ?? 0; const y = asNum(e[1]) ?? 0;
    const w = asNum(e[2]) ?? 0; const h = asNum(e[3]) ?? 0; const tilt = asNum(e[4]) ?? 0;
    eyes += '<rect x="' + (x - w / 2) + '" y="' + (y - h / 2) + '" width="' + w + '" height="' + h +
      '" rx="' + (w / 2) + '" fill="black" transform="rotate(' + tilt + ' ' + x + ' ' + y + ')"/>';
  }
  let paints = '';
  for (const item of asArray(character['paints']) ?? []) {
    const p = asArray(item);
    if (p !== undefined && p.length >= 3) paints += '<path d="' + asStr(p[0]) + '" fill="' + asStr(p[1]) + '" opacity="' + asNum(p[2]) + '"/>';
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>' +
    '<linearGradient id="paint" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#A4FFB0"/><stop offset=".42" stop-color="#00F0E4"/><stop offset="1" stop-color="#2E9EF7"/></linearGradient>' +
    '<mask id="eyes" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="white"/>' + eyes + '</mask></defs>' +
    '<g mask="url(#eyes)"><path d="' + asStr(character['body']) + '" fill="' + (color === 'aurora' ? 'url(#paint)' : fill) + '"/>' + paints +
    '<path d="' + asStr(character['shade']) + '" fill="#000" opacity=".14"/><path d="' + asStr(character['light']) + '" fill="#fff" opacity=".16"/></g></svg>';
}

/** DS-Bot avatar. Supply the BotEntry and optionally avatarSize and dark theme. */
@Component
export struct BotAvatar {
  @Prop bot: BotEntry = new BotEntry();
  @Prop avatarSize: number = 40;
  @Prop dark: boolean = false;
  @State private brokenImage: string = '';

  private source(): string {
    const image = this.bot.avatarImage;
    const engine = engineFor(this.bot);
    if (image.startsWith('data:image/svg+xml') && (BADGES[engine] !== undefined || engine.startsWith('acp-'))) {
      return svgUri(agentSvg(engine));
    }
    if (image !== this.brokenImage && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(image)) return image;
    return svgUri(characterSvg(this.bot, this.dark));
  }

  build() {
    Image(this.source()).width(this.avatarSize).height(this.avatarSize).objectFit(ImageFit.Contain)
      .borderRadius(this.bot.avatarImage.length > 0 ? Math.round(this.avatarSize * 0.28) : 0)
      .onError(() => { this.brokenImage = this.bot.avatarImage; })
      .accessibilityLevel('no');
  }
}
