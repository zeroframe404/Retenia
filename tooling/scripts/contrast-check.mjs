#!/usr/bin/env node

/**
 * WCAG 2.2 AA contrast check for the semantic design tokens in `packages/ui/src/theme.css`.
 *
 * Usage: node tooling/scripts/contrast-check.mjs
 *
 * Parses the token values straight out of `theme.css` (rather than duplicating them here,
 * which would silently drift the moment someone tunes a palette curve), resolves the light
 * and dark cascades the same way the browser does (`@theme static` values, overridden by
 * `:root[data-theme='dark']`), computes the WCAG relative-luminance contrast ratio for a
 * fixed list of foreground/background pairs actually used together across `packages/ui`'s
 * components and the app shell, and fails if any pair is under the WCAG 2.2 AA threshold:
 * 4.5:1 for normal text, 3:1 for large text (18pt+/14pt+bold) and non-text UI components
 * (borders, focus indicators, icon-only control boundaries).
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const themeCssPath = path.join(projectRoot, 'packages/ui/src/theme.css')

const TEXT_THRESHOLD = 4.5
const LARGE_TEXT_THRESHOLD = 3
const UI_THRESHOLD = 3

// ---------------------------------------------------------------------------------------
// Color parsing: oklch()/var()/literal CSS colors → linear-sRGB → WCAG relative luminance.
// ---------------------------------------------------------------------------------------

/** OKLCH → linear sRGB, per the CSS Color 4 conversion matrices (same ones browsers use). */
function oklchToLinearSrgb(l, c, hDeg) {
  const h = (hDeg * Math.PI) / 180
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b

  const l3 = l_ ** 3
  const m3 = m_ ** 3
  const s3 = s_ ** 3

  return {
    r: +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  }
}

const NAMED_LINEAR_RGB = {
  white: { r: 1, g: 1, b: 1 },
  black: { r: 0, g: 0, b: 0 },
}

/** Parses a resolved CSS color value (`oklch(...)`, `white`/`black`, or `#rrggbb`) into
 * linear-sRGB. Anything else (a `var()` that never resolved, a gradient, …) is a bug in the
 * token table below, not a color this script can grade — it throws rather than silently
 * skipping a pair. */
function parseColorToLinearSrgb(value) {
  const trimmed = value.trim()

  if (trimmed in NAMED_LINEAR_RGB) return NAMED_LINEAR_RGB[trimmed]

  const oklchMatch = trimmed.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/)
  if (oklchMatch) {
    const [, l, c, h] = oklchMatch
    return oklchToLinearSrgb(Number.parseFloat(l), Number.parseFloat(c), Number.parseFloat(h))
  }

  const hexMatch = trimmed.match(/^#([0-9a-f]{6})$/i)
  if (hexMatch) {
    const int = Number.parseInt(hexMatch[1], 16)
    const srgbToLinear = (channel) => {
      const v = channel / 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return {
      r: srgbToLinear((int >> 16) & 0xff),
      g: srgbToLinear((int >> 8) & 0xff),
      b: srgbToLinear(int & 0xff),
    }
  }

  throw new Error(`contrast-check: don't know how to parse color "${value}"`)
}

/** WCAG relative luminance — the linear-sRGB coefficients apply directly to the
 * already-linear values this script works with (no separate sRGB gamma step needed, unlike
 * gamma-encoded sRGB literals). */
function relativeLuminance(linearRgb) {
  const clamp01 = (v) => Math.min(1, Math.max(0, v))
  return (
    0.2126 * clamp01(linearRgb.r) + 0.7152 * clamp01(linearRgb.g) + 0.0722 * clamp01(linearRgb.b)
  )
}

function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(parseColorToLinearSrgb(fg))
  const l2 = relativeLuminance(parseColorToLinearSrgb(bg))
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

// ---------------------------------------------------------------------------------------
// Token extraction from theme.css.
// ---------------------------------------------------------------------------------------

/** Pulls every `--name: value;` custom property declaration out of one `{ ... }` block. */
function parseDeclarations(blockBody) {
  const tokens = {}
  const declRegex = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi
  let match = declRegex.exec(blockBody)
  while (match !== null) {
    tokens[match[1]] = match[2].trim()
    match = declRegex.exec(blockBody)
  }
  return tokens
}

/** Extracts the body of the first `{ ... }` block that follows `selector` in the source
 * (brace-balanced, so nested `oklch(...)` parens inside don't confuse a naive regex). */
function extractBlock(source, selector) {
  const startOfSelector = source.indexOf(selector)
  if (startOfSelector === -1) throw new Error(`contrast-check: selector "${selector}" not found`)
  const openBrace = source.indexOf('{', startOfSelector)
  let depth = 0
  let i = openBrace
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return source.slice(openBrace + 1, i)
}

/** Resolves `var(--x)` references against an already-parsed token table (single pass — every
 * token in `theme.css` only ever references one already defined earlier, never itself). */
function resolveVar(value, tokens) {
  const varMatch = value.match(/^var\(--([a-z0-9-]+)\)$/i)
  if (!varMatch) return value
  const referenced = tokens[varMatch[1]]
  if (referenced === undefined) {
    throw new Error(`contrast-check: unresolved var(--${varMatch[1]})`)
  }
  return resolveVar(referenced, tokens)
}

function loadTokens() {
  const css = readFileSync(themeCssPath, 'utf-8')

  const baseTokens = parseDeclarations(extractBlock(css, '@theme static'))
  const darkOverrides = parseDeclarations(extractBlock(css, ':root[data-theme="dark"]'))

  const resolve = (raw, tokens) => {
    const resolved = {}
    for (const [name, value] of Object.entries(raw)) {
      resolved[name] = resolveVar(value, tokens)
    }
    return resolved
  }

  // Two passes: `--color-bg` etc. reference palette steps defined earlier in the same block,
  // so the raw table has to be complete before any `var()` in it can resolve.
  const light = resolve(baseTokens, baseTokens)
  const dark = resolve({ ...baseTokens, ...darkOverrides }, { ...baseTokens, ...darkOverrides })

  return { light, dark }
}

// ---------------------------------------------------------------------------------------
// The pairs actually used together in `packages/ui` (docs/spec/08-ux.md, component source).
// ---------------------------------------------------------------------------------------

/** `fg`/`bg` are token names (without the `--color-` prefix) or a literal CSS color.
 * `level`: 'text' → 4.5:1, 'large' or 'ui' → 3:1. */
const PAIRS = [
  { label: 'body text on page background', fg: 'text', bg: 'bg', level: 'text' },
  { label: 'body text on surface (cards, dialogs)', fg: 'text', bg: 'surface', level: 'text' },
  { label: 'muted text on page background', fg: 'muted', bg: 'bg', level: 'text' },
  { label: 'muted text on surface', fg: 'muted', bg: 'surface', level: 'text' },
  {
    label: 'primary button text (white) on brand-600',
    fg: 'white',
    bg: 'brand-600',
    level: 'text',
  },
  {
    label: 'destructive button text (white) on red-600',
    fg: 'white',
    bg: 'red-600',
    level: 'text',
  },
  {
    label: 'secondary button text on neutral-100',
    fg: 'neutral-900',
    bg: 'neutral-100',
    level: 'text',
  },
  {
    label: 'secondary button text on neutral-800 (dark)',
    fg: 'neutral-50',
    bg: 'neutral-800',
    level: 'text',
  },
  {
    label: 'sidebar active item text on brand-100',
    fg: 'brand-800',
    bg: 'brand-100',
    level: 'text',
  },
  {
    label: 'sidebar active item text on brand-900 (dark)',
    fg: 'brand-100',
    bg: 'brand-900',
    level: 'text',
  },
  {
    label: 'correct/streak feedback text on page background',
    fg: 'correct',
    bg: 'bg',
    level: 'text',
  },
  { label: 'incorrect feedback text on page background', fg: 'incorrect', bg: 'bg', level: 'text' },
  { label: 'xp badge text on page background', fg: 'xp', bg: 'bg', level: 'text' },
  { label: 'border vs page background (non-text UI)', fg: 'border', bg: 'bg', level: 'ui' },
  { label: 'border vs surface (non-text UI)', fg: 'border', bg: 'surface', level: 'ui' },
  { label: 'focus outline (brand-500) vs surface', fg: 'brand-500', bg: 'surface', level: 'ui' },
  { label: 'focus outline (brand-500) vs page background', fg: 'brand-500', bg: 'bg', level: 'ui' },
]

const THRESHOLDS = { text: TEXT_THRESHOLD, large: LARGE_TEXT_THRESHOLD, ui: UI_THRESHOLD }

function resolveToken(name, tokens) {
  if (name === 'white' || name === 'black') return name
  const value = tokens[`color-${name}`]
  if (value === undefined) throw new Error(`contrast-check: unknown token "--color-${name}"`)
  return value
}

function checkTheme(themeName, tokens) {
  console.log(`\n${themeName} theme:`)
  const failures = []

  for (const pair of PAIRS) {
    const fg = resolveToken(pair.fg, tokens)
    const bg = resolveToken(pair.bg, tokens)
    const ratio = contrastRatio(fg, bg)
    const threshold = THRESHOLDS[pair.level]
    const pass = ratio >= threshold

    const line = `  ${pass ? '✓' : '✘'} ${pair.label}: ${ratio.toFixed(2)}:1 (needs ${threshold}:1)`
    if (pass) {
      console.log(line)
    } else {
      console.error(line)
      failures.push({ ...pair, ratio, threshold })
    }
  }

  return failures
}

function main() {
  console.log('Checking WCAG 2.2 AA contrast for semantic design tokens...')

  const { light, dark } = loadTokens()
  const failures = [...checkTheme('Light', light), ...checkTheme('Dark', dark)]

  console.log()
  if (failures.length > 0) {
    console.error(`❌ ${failures.length} contrast failure(s) found.\n`)
    process.exit(1)
  }

  console.log('✓ All token pairs meet WCAG 2.2 AA contrast')
  process.exit(0)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}

export { contrastRatio, parseColorToLinearSrgb, relativeLuminance }
