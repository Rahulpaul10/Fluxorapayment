/**
 * Light-theme readability check, no browser needed.
 *
 * Reads the light-theme colors from src/index.css and measures the WCAG contrast of every text/background pair the
 * Dashboard (and the other pages) use: body text, the secondary text steps, the accent, status colors and their
 * tinted badges, and how clearly a white card stands out from the page. Fails when a pair gets too faint.
 *
 * Run: bun run test:theme
 */
import { readFileSync } from 'node:fs'

const css = readFileSync(process.env.CSS_PATH ?? new URL('../src/index.css', import.meta.url), 'utf8')

type Rgb = [number, number, number]
const hex = (h: string): Rgb => {
  const v = h.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as Rgb
}
const triplet = (s: string): Rgb => s.trim().split(/\s+/).map(Number) as Rgb
const channel = (v: number) => {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const over = (fg: Rgb, bg: Rgb, alpha: number): Rgb => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha))) as Rgb

const block = /html\[data-mode='light'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
const token = (name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1]
const must = <T,>(v: T | undefined, what: string): T => {
  if (v === undefined) throw new Error(`light theme token missing: ${what}`)
  return v
}
const override = (cls: string) => {
  const m = new RegExp(`html\\[data-mode='light'\\] \\.${cls}(?:,[^{]*)?\\s*\\{\\s*color:\\s*(#[0-9a-fA-F]{6})`).exec(css)
  return m ? hex(m[1]) : undefined
}

const page = hex(must(token('bg'), 'bg'))
const card = hex(must(token('card'), 'card'))
const inner = hex(must(token('inner'), 'inner'))
const accent = hex(must(token('a'), 'a'))
const on = hex(must(token('on'), 'on'))
const ink = triplet(must(token('fg'), 'fg'))
const slate = (n: number) => triplet(must(token(`s${n}`), `s${n}`))
const surfaces: [string, Rgb][] = [['card', card], ['page', page], ['inner', inner]]

let pass = 0
let fail = 0
const check = (cond: boolean, name: string, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${extra ? ` (${extra})` : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`) }
}
const atLeast = (name: string, fg: Rgb, bg: Rgb, min: number) => {
  const r = ratio(fg, bg)
  check(r >= min, name, `${r.toFixed(2)}:1, needs ${min}:1`)
}

console.log('Text on every surface (4.5:1 is the readable minimum for small text)')
for (const [sn, bg] of surfaces) {
  atLeast(`body text on ${sn}`, ink, bg, 7)
  for (const n of [200, 300, 400, 500]) atLeast(`slate-${n} on ${sn}`, slate(n), bg, 4.5)
  atLeast(`accent text (links, "View all") on ${sn}`, accent, bg, 4.5)
}
atLeast('placeholder text (slate-600) on card', slate(600), card, 3.5)
atLeast('primary button label on the accent', on, accent, 4.5)

console.log('Status colors used as text')
for (const cls of ['text-neon', 'text-flux-green', 'text-flux-pink', 'text-amber-300', 'text-volt']) {
  const c = must(override(cls), `${cls} override`)
  for (const [sn, bg] of surfaces) atLeast(`${cls} on ${sn}`, c, bg, 4.5)
}

console.log('History badges (colored text on its own tint)')
const badges: [string, string, Rgb, number][] = [
  ['text-flux-pink', 'send', hex('#FF55B8'), 0.15],
  ['text-flux-green', 'receive', hex('#20D6A0'), 0.15],
  ['text-volt', 'bridge', hex('#8257FF'), 0.2],
  ['text-amber-300', 'payment', hex('#FBBF24'), 0.15],
]
for (const [cls, label, tint, a] of badges) atLeast(`${label} badge`, must(override(cls), cls), over(tint, card, a), 4.5)

console.log('Cards stand out from the page')
check(ratio(card, page) >= 1.12, 'a white card is clearly lighter than the page', `${ratio(card, page).toFixed(2)}:1, needs 1.12:1`)
check(/--line:\s*rgba\(15,\s*23,\s*42,\s*0\.(1[2-9]|[2-9]\d*)\)/.test(block), 'card border is at least 12% ink')
check(/html\[data-mode='light'\] \.glass \{[^}]*box-shadow/.test(css), 'cards carry a soft shadow in the light theme')
check(/html\[data-mode='light'\] \.divide-white\\\/5/.test(css), 'list dividers are darker in the light theme')
check(/html\[data-mode='light'\] \.field:not\(:focus\)/.test(css), 'input borders are darker, and the focus ring still wins')

console.log(`\n${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`)
process.exit(fail ? 1 : 0)
