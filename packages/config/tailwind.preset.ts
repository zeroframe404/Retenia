import type { Config } from 'tailwindcss'

/**
 * Shared Tailwind 4 preset. Real design tokens (OKLCH color scale, spacing, motion
 * durations) land in sub-phase 2.1 (`docs/spec/01-decisions.md` §10.2) — this is the
 * seed every app/package theme extends so the token source stays single.
 */
export const tailwindPreset = {
  darkMode: 'class',
  theme: {
    extend: {},
  },
} satisfies Partial<Config>

export default tailwindPreset
