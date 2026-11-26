// Pure-JS damped-spring motion math (24x24 center pivot) and monochrome two-tone
// contrast derivation for crisp linear-duotone icons.

export type LineFxPose = {
  x?: number
  y?: number
  r?: number
  s?: number
  sx?: number
  sy?: number
  gx?: number
  gy?: number
  a?: number
  w?: number
  clip?: number
  clipY?: number
  o?: readonly [number, number]
}

export type LineFxSpec = {
  t:
    | 'bounce'
    | 'beat'
    | 'wiggle'
    | 'shake'
    | 'rotate'
    | 'flip'
    | 'orbit'
    | 'draw'
    | 'variable'
    | 'from'
    | 'keys'
    | 'turn'
    | 'leaf'
    | 'scan'
  on?: string | readonly (string | readonly string[])[]
  by?: boolean
  stagger?: number
  amp?: number
  dir?: 'up' | 'down'
  delay?: number
  hz?: number
  z?: number
  deg?: number
  dip?: number
  turns?: number
  R?: number
  step?: number
  mode?: string
  ms?: number
  ghost?: boolean
  at?: readonly number[]
  edge?: readonly [number, number]
  axis?: 'x' | 'y'
  x0?: number
  x1?: number
  y0?: number
  y1?: number
  hold?: number
  o?: readonly [number, number]
  oBadge?: boolean
  x?: number | readonly number[]
  y?: number | readonly number[]
  r?: number | readonly number[]
  s?: number | readonly number[]
  sx?: number | readonly number[]
  sy?: number | readonly number[]
  gx?: number | readonly number[]
  gy?: number | readonly number[]
  a?: number | readonly number[]
  fill?: Record<string, unknown>
}

const TAU = Math.PI * 2
const round3 = (v: number) => +v.toFixed(3)

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

function clampRange(v: number, min = 0, max = 1): number {
  if (!Number.isFinite(v)) return min
  return Math.min(max, Math.max(min, v))
}

/** Damped spring impulse: peaks at 1 and decays with a natural overshoot. */
export function impulse(t: number, hz = 1.8, z = 0.42): number {
  if (t <= 0) return 0
  const w = TAU * hz
  const wd = w * Math.sqrt(1 - z * z)
  const tp = Math.atan(wd / (z * w)) / wd
  const peak = Math.exp(-z * w * tp) * Math.sin(wd * tp)
  return (Math.exp(-z * w * t) * Math.sin(wd * t)) / peak
}

/** Damped spring settle: from 1 down to 0 with slight overshoot. */
export function settle(t: number, hz = 2.2, z = 0.55): number {
  if (t <= 0) return 1
  const w = TAU * hz
  const wd = w * Math.sqrt(1 - z * z)
  return Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t))
}

const easeOutCubic = (u: number) => 1 - Math.pow(1 - clampRange(u), 3)
const easeInOutCubic = (u: number) => {
  const x = clampRange(u)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/**
 * Reshapes SVG path coordinates by `(kx, ky)` around `(ox, oy)` without distorting
 * stroke width (used for 3D meridian globe turns and turning pages).
 */
export function scalePath(d: string, kx = 1, ky = 1, ox = 12, oy = 12): string {
  const tok = d.match(/[a-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []
  const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }
  const X = (v: number, rel: boolean) => round3(rel ? v * kx : ox + (v - ox) * kx)
  const Y = (v: number, rel: boolean) => round3(rel ? v * ky : oy + (v - oy) * ky)
  let out = ''
  let cmd = ''
  let i = 0
  while (i < tok.length) {
    if (/[a-z]/i.test(tok[i]!)) {
      cmd = tok[i++]!
      out += cmd
      if (!ARGS[cmd.toLowerCase()]) continue
    }
    const c = cmd.toLowerCase()
    const rel = cmd !== cmd.toUpperCase()
    const count = ARGS[c] ?? 0
    const a = tok.slice(i, i + count).map(Number)
    i += count
    let v: number[]
    if (c === 'h') v = [X(a[0]!, rel)]
    else if (c === 'v') v = [Y(a[0]!, rel)]
    else if (c === 'a') {
      v = [
        round3(Math.abs(a[0]! * kx)),
        round3(Math.abs(a[1]! * ky)),
        a[2]!,
        a[3]!,
        kx * ky < 0 ? 1 - a[4]! : a[4]!,
        X(a[5]!, rel),
        Y(a[6]!, rel),
      ]
    } else {
      v = a.map((q, j) => (j % 2 ? Y(q, rel) : X(q, rel)))
    }
    out += (/[a-z]$/i.test(out) ? '' : ' ') + v.join(' ')
  }
  return out
}

const REST: Required<Omit<LineFxPose, 'clip' | 'clipY' | 'o'>> = {
  x: 0,
  y: 0,
  r: 0,
  s: 1,
  sx: 1,
  sy: 1,
  gx: 1,
  gy: 1,
  a: 1,
  w: 1,
}
const SEG_MS = 150
const HOME_SEC = 0.42

interface EffectDriver {
  loop?: boolean
  len: (p: LineFxSpec, n: number) => number
  pose: (p: LineFxSpec, t: number, i: number, n: number) => LineFxPose
}

const toArr = (v: number | readonly number[] | undefined): number[] =>
  v === undefined ? [] : Array.isArray(v) ? [...v] : [v as number]

export const LINE_EFFECTS: Record<LineFxSpec['t'], EffectDriver> = {
  bounce: {
    len: (p, n) => 720 + (p.by ? (n - 1) * (p.stagger ?? 90) : 0),
    pose(p, t, i) {
      const u = (t - (p.by ? i * (p.stagger ?? 90) : 0)) / 1000
      const amp = p.amp ?? 1.6
      const lift = impulse(u - 0.07, 1.9, 0.45)
      const pre = u > 0 && u < 0.07 ? Math.sin((Math.PI * u) / 0.07) : 0
      const land = impulse(u - 0.07, 3.8, 0.5)
      return {
        y: p.dir === 'down' ? amp * lift : -amp * Math.max(lift, -0.35),
        sy: 1 - 0.07 * pre + 0.03 * Math.max(land, -0.6),
        sx: 1 + 0.04 * pre,
      }
    },
  },
  beat: {
    len: () => 760,
    pose(p, t) {
      const b = (c: number) => {
        const u = (t - c) / 200
        return u > 0 && u < 1 ? Math.sin(Math.PI * u) ** 2 : 0
      }
      const tail = impulse((t - 420) / 1000, 3, 0.5)
      const amp = p.amp ?? 0.12
      return { s: 1 + amp * b(0) + amp * 0.7 * b(240) + 0.015 * Math.max(0, tail) }
    },
  },
  wiggle: {
    len: (p) => 1000 + (p.delay ?? 0),
    pose(p, t) {
      const u = (t - (p.delay ?? 0)) / 1000
      if (u <= 0) return {}
      const hz = p.hz ?? 3
      const env = Math.exp(-u * 3.6) * clampRange(u / 0.05)
      return { r: (p.deg ?? 10) * env * Math.sin(TAU * hz * u) }
    },
  },
  shake: {
    len: (p) => p.ms ?? 520,
    pose(p, t) {
      const L = p.ms ?? 520
      const u = t / L
      const amp = typeof p.x === 'number' ? p.x : 0.7
      return { x: amp * Math.sin(TAU * 7 * u) * Math.sin(Math.PI * clampRange(u)) }
    },
  },
  rotate: {
    len: (p) => (p.delay ?? 0) + (Math.abs(p.deg ?? 360) >= 180 ? 1050 : 820),
    pose(p, t) {
      const dt = t - (p.delay ?? 0)
      if (dt <= 0) return {}
      const u = dt / 1000
      const deg = p.deg ?? 360
      const big = Math.abs(deg) >= 180
      const L = big ? 1050 : 820
      const out: LineFxPose = { r: deg * (1 - settle(u, big ? 1.25 : 1.9, big ? 0.62 : 0.5)) }
      if (p.dip) out.s = 1 - p.dip * clampRange(dt / 50) * clampRange((L - dt) / 260)
      return out
    },
  },
  flip: {
    len: (p) => 820 * (p.turns ?? 1),
    pose(p, t) {
      const turns = p.turns ?? 1
      const L = 820 * turns
      return { sx: Math.cos(TAU * turns * easeInOutCubic(t / L)) }
    },
  },
  orbit: {
    len: (p) => 700 * (p.turns ?? 1),
    pose(p, t) {
      const turns = p.turns ?? 1
      const L = 700 * turns
      const q = TAU * turns * easeInOutCubic(t / L)
      const R = p.R ?? 0.9
      return { x: R * Math.sin(q), y: R * (Math.cos(q) - 1) * 0.9 }
    },
  },
  draw: {
    len: (p, n) => 380 + (n - 1) * (p.stagger ?? 150) + 40,
    pose(p, t, i) {
      const u = (t - i * (p.stagger ?? 150)) / 380
      return { w: easeOutCubic(u) }
    },
  },
  variable: {
    loop: true,
    len: (p, n) => 120 + n * (p.step ?? 160) + 460,
    pose(p, t, i, n) {
      const step = p.step ?? 160
      const P = 120 + n * step + 460
      const q = t % P
      const DIM = 0.25
      const fade = (v: number) => clampRange(v / 120)
      if (q < 120) return { a: 1 - (1 - DIM) * fade(q) }
      const on = q - 120 - i * step
      if (p.mode !== 'iterative') return { a: on < 0 ? DIM : DIM + (1 - DIM) * fade(on) }
      const lit = on < 0 ? 0 : on < step * 1.5 ? fade(on) : 1 - fade(on - step * 1.5)
      const end = P - 140
      return { a: DIM + (1 - DIM) * Math.max(lit, q > end ? fade(q - end) : 0) }
    },
  },
  from: {
    len: (p, n) => 760 + (p.delay ?? 0) + (p.by ? (n - 1) * (p.stagger ?? 80) : 0),
    pose(p, t, i) {
      const u = (t - (p.delay ?? 0) - (p.by ? i * (p.stagger ?? 80) : 0)) / 1000
      const k = settle(Math.max(u, 0), p.hz ?? 2.2, p.z ?? 0.55)
      const out: LineFxPose = {}
      const keys = ['x', 'y', 'r', 's', 'sx', 'sy', 'gx', 'gy'] as const
      for (const key of keys) {
        const val = p[key]
        if (typeof val === 'number') out[key] = REST[key] + (val - REST[key]) * k
      }
      if (typeof p.a === 'number') out.a = p.a + (1 - p.a) * easeOutCubic(u / 0.18)
      return out
    },
  },
  keys: {
    len(p, n) {
      const keys = ['x', 'y', 'r', 's', 'sx', 'sy', 'gx', 'gy', 'a'] as const
      const maxLen = Math.max(1, ...keys.map((k) => toArr(p[k]).length))
      const go = p.ms ?? 190 + (maxLen - 1) * SEG_MS
      const staggerWait = p.by ? Math.max(0, n - 1) * (p.stagger ?? 70) : 0
      return (p.delay ?? 0) + go + HOME_SEC * 1000 + staggerWait
    },
    pose(p, t, i) {
      const keys = (['x', 'y', 'r', 's', 'sx', 'sy', 'gx', 'gy', 'a'] as const).filter((k) => p[k] !== undefined)
      const maxLen = Math.max(1, ...keys.map((k) => toArr(p[k]).length))
      const time = t - (p.delay ?? 0) - (p.by ? i * (p.stagger ?? 70) : 0)
      const out: LineFxPose = {}
      const go = p.ms ?? 190 + (maxLen - 1) * SEG_MS
      for (const key of keys) {
        const v = toArr(p[key])
        if (v.length === 0) continue
        const rest = REST[key]
        const home = key === 'a' && p.ghost ? 0 : rest
        const pts = [home, ...v]
        const last = v[v.length - 1]!
        if (time <= 0) {
          out[key] = home
          continue
        }
        if (time < go) {
          const seg = go / v.length
          const j = Math.min(v.length - 1, Math.floor(time / seg))
          const u = (time - j * seg) / seg
          out[key] = pts[j]! + (pts[j + 1]! - pts[j]!) * (j === 0 ? easeOutCubic(u) : easeInOutCubic(u))
        } else {
          out[key] =
            key === 'a'
              ? last + (home - last) * easeOutCubic((time - go) / (HOME_SEC * 600))
              : rest + (last - rest) * settle((time - go) / 1000)
        }
      }
      return out
    },
  },
  turn: {
    loop: true,
    len: (p) => p.ms ?? 1100,
    pose(p, t, i) {
      const L = p.ms ?? 1100
      const rad = Math.PI / 180
      const at = p.at?.[i] ?? 0
      const q = at + (p.step ?? 90) * ((t % L) / L)
      const [e0, e1] = p.edge ?? [70, 90]
      const off = Math.abs(((q + 540) % 360) - 180)
      const denom = Math.sin(at * rad)
      return {
        gx: Math.abs(denom) > 1e-4 ? Math.sin(q * rad) / denom : 1,
        a: 1 - clampRange((off - e0) / (e1 - e0)),
      }
    },
  },
  leaf: {
    len: (p, n) => (p.ms ?? 560) + (n - 1) * (p.stagger ?? 200),
    pose(p, t, i) {
      const u = (t - i * (p.stagger ?? 200)) / (p.ms ?? 560)
      if (u <= 0 || u >= 1) return { a: 0 }
      return { [p.axis === 'y' ? 'gy' : 'gx']: Math.cos(Math.PI * easeInOutCubic(u)), a: 1 }
    },
  },
  scan: {
    len: (p) => 2 * (p.ms ?? 460) + (p.hold ?? 200) + 120,
    pose(p, t, i) {
      const S = p.ms ?? 460
      const H = p.hold ?? 200
      const F = 90
      const Y = p.axis === 'y'
      const p0 = (Y ? p.y0 : p.x0) ?? 3
      const p1 = (Y ? p.y1 : p.x1) ?? 21
      const back = t >= S + H
      const u = back ? (t - S - H) / S : t / S
      const pos = t < S ? p1 + (p0 - p1) * easeInOutCubic(u) : back ? p0 + (p1 - p0) * easeInOutCubic(u) : p0
      if (i > 0) return Y ? { clipY: pos } : { clip: pos }
      const a = back
        ? clampRange((t - S - H) / F) * (1 - clampRange((t - 2 * S - H) / 120))
        : clampRange(t / 60) * (1 - clampRange((t - S + F) / F))
      return { [Y ? 'y' : 'x']: pos - 12, a }
    },
  },
}

function groupsOf(spec: LineFxSpec): string[][] {
  if (spec.on === 'all' || !spec.on) return [['all']]
  if (typeof spec.on === 'string') return [[spec.on]]
  const list = spec.on.map((g) => (Array.isArray(g) ? [...g] : [g as string]))
  return spec.by || ['draw', 'variable', 'turn', 'leaf', 'scan'].includes(spec.t) ? list : [list.flat()]
}

function mergeLinePose(a: LineFxPose, b: LineFxPose): LineFxPose {
  return {
    x: (a.x ?? 0) + (b.x ?? 0),
    y: (a.y ?? 0) + (b.y ?? 0),
    r: (a.r ?? 0) + (b.r ?? 0),
    s: (a.s ?? 1) * (b.s ?? 1),
    sx: (a.sx ?? 1) * (b.sx ?? 1),
    sy: (a.sy ?? 1) * (b.sy ?? 1),
    gx: a.gx === undefined ? b.gx : b.gx === undefined ? a.gx : a.gx * b.gx,
    gy: a.gy === undefined ? b.gy : b.gy === undefined ? a.gy : a.gy * b.gy,
    a: a.a === undefined ? b.a : b.a === undefined ? a.a : a.a * b.a,
    w: a.w === undefined ? b.w : b.w === undefined ? a.w : Math.min(a.w, b.w),
    clip: a.clip === undefined ? b.clip : b.clip === undefined ? a.clip : Math.min(a.clip, b.clip),
    clipY: a.clipY === undefined ? b.clipY : b.clipY === undefined ? a.clipY : Math.min(a.clipY, b.clipY),
    o: b.o ?? a.o,
  }
}

export function getLineFxSpecs(fx: LineFxSpec | readonly LineFxSpec[] | undefined): LineFxSpec[] {
  if (!fx) return []
  return Array.isArray(fx) ? [...fx] : [fx as LineFxSpec]
}

export function computeLineFxMeta(fx: LineFxSpec | readonly LineFxSpec[] | undefined): {
  span: number
  loops: boolean
} {
  const specs = getLineFxSpecs(fx)
  if (specs.length === 0) return { span: 0, loops: false }
  let span = 0
  let loops = false
  for (const spec of specs) {
    const driver = LINE_EFFECTS[spec.t]
    const gs = groupsOf(spec)
    span = Math.max(span, driver.len(spec, gs.length))
    if (driver.loop) loops = true
  }
  return { span, loops }
}

export function evaluateLineFxAt(
  fx: LineFxSpec | readonly LineFxSpec[] | undefined,
  tMs: number,
  done = false,
): Record<string, LineFxPose> {
  const specs = getLineFxSpecs(fx)
  const out: Record<string, LineFxPose> = {}
  for (const spec of specs) {
    const driver = LINE_EFFECTS[spec.t]
    const gs = groupsOf(spec)
    gs.forEach((grp, i) => {
      const pose = done ? {} : driver.pose(spec, tMs, i, gs.length)
      for (const name of grp) {
        out[name] = mergeLinePose(out[name] ?? {}, { ...pose, o: spec.o })
      }
    })
  }
  return out
}

export function computeLineTransform(pose: LineFxPose): string | undefined {
  const x = pose.x ?? 0
  const y = pose.y ?? 0
  const r = pose.r ?? 0
  const s = pose.s ?? 1
  const sx = round3(s * (pose.sx ?? 1))
  const sy = round3(s * (pose.sy ?? 1))
  if (
    Math.abs(x) < 1e-4 &&
    Math.abs(y) < 1e-4 &&
    Math.abs(r) < 1e-4 &&
    Math.abs(sx - 1) < 1e-4 &&
    Math.abs(sy - 1) < 1e-4
  ) {
    return undefined
  }
  const [ox, oy] = pose.o ?? [12, 12]
  return `translate(${round3(x + ox)} ${round3(y + oy)}) rotate(${round3(r)}) scale(${sx} ${sy}) translate(${-ox} ${-oy})`
}

function compositeOverBackdrop(
  rgb: [number, number, number],
  alpha: number,
  backdropRgb: [number, number, number],
): [number, number, number] {
  const a = clamp01(alpha)
  return [
    backdropRgb[0] + (rgb[0] - backdropRgb[0]) * a,
    backdropRgb[1] + (rgb[1] - backdropRgb[1]) * a,
    backdropRgb[2] + (rgb[2] - backdropRgb[2]) * a,
  ]
}

function parseColorRgb(
  color: string,
  backdropRgb: [number, number, number] = [255, 255, 255],
): [number, number, number] | undefined {
  const trimmed = color.trim()
  const clean = trimmed.replace(/^#/, '')
  if (/^[0-9a-fA-F]{8}$/.test(clean)) {
    const r = parseInt(clean.slice(0, 2), 16)
    const g = parseInt(clean.slice(2, 4), 16)
    const b = parseInt(clean.slice(4, 6), 16)
    const a = parseInt(clean.slice(6, 8), 16) / 255
    return a >= 1 ? [r, g, b] : compositeOverBackdrop([r, g, b], a, backdropRgb)
  }
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ]
  }
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    return [
      parseInt(clean[0]! + clean[0]!, 16),
      parseInt(clean[1]! + clean[1]!, 16),
      parseInt(clean[2]! + clean[2]!, 16),
    ]
  }
  const rgbaMatch = trimmed.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i)
  if (rgbaMatch) {
    const r = Number(rgbaMatch[1])
    const g = Number(rgbaMatch[2])
    const b = Number(rgbaMatch[3])
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return undefined
    const rawAlpha = rgbaMatch[4]
    if (rawAlpha === undefined) return [r, g, b]
    const a = rawAlpha.endsWith('%') ? Number(rawAlpha.slice(0, -1)) / 100 : Number(rawAlpha)
    if (!Number.isFinite(a)) return undefined
    return a >= 1 ? [r, g, b] : compositeOverBackdrop([r, g, b], a, backdropRgb)
  }
  return undefined
}

function toHexRgb(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase()
}

/**
 * Monochrome linear-duotone secondary tone derivation (`TONE.light = 0.42`),
 * generalized across light, dark, inverse, and translucent `rgba(...)` surfaces.
 */
export function deriveDuotoneSecondaryColor(
  primaryColor: string,
  surfaceColor = '#FFFFFF',
  alpha = 0.42,
  backdropHex = '#FFFFFF',
): string {
  const backdropRgb = parseColorRgb(backdropHex) ?? [255, 255, 255]
  const bg = parseColorRgb(surfaceColor, backdropRgb)
  const fg = parseColorRgb(primaryColor, bg ?? backdropRgb)
  if (!fg || !bg) return primaryColor
  return toHexRgb([
    bg[0] + (fg[0] - bg[0]) * alpha,
    bg[1] + (fg[1] - bg[1]) * alpha,
    bg[2] + (fg[2] - bg[2]) * alpha,
  ])
}

export function resolveMonochromeDuotoneTones({
  scheme,
  primaryColor,
  surfaceColor,
  inverse = false,
}: {
  scheme: 'light' | 'dark'
  primaryColor?: string
  surfaceColor?: string
  inverse?: boolean
}): { primary: string; secondary: string } {
  const defaultSurface = inverse
    ? scheme === 'dark'
      ? '#F2F4F7'
      : '#0F0F0F'
    : scheme === 'dark'
      ? '#161A21'
      : '#FFFFFF'
  const backdrop = scheme === 'dark' ? '#121214' : '#FFFFFF'
  const defaultPrimary = inverse
    ? scheme === 'dark'
      ? '#0B0D11'
      : '#FFFFFF'
    : scheme === 'dark'
      ? '#F2F4F7'
      : '#0F0F0F'
  const primary = primaryColor && primaryColor !== 'currentColor' ? primaryColor : defaultPrimary
  const surface = surfaceColor ?? defaultSurface
  return {
    primary,
    secondary: deriveDuotoneSecondaryColor(primary, surface, 0.42, backdrop),
  }
}
