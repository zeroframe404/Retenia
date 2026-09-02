import type { Config } from 'tailwindcss'

/**
 * Legacy JS-config placeholder, kept only for `packages/config/src/index.test.ts`'s
 * `darkMode: 'class'` assertion. Tailwind 4 is CSS-first: nothing imports this via
 * `@config`, and it plays no part in the actual build. The real design tokens (OKLCH
 * color scale, spacing, motion durations, dark variant) live in
 * `packages/ui/src/theme.css` (`@theme` + `@custom-variant dark`,
 * `docs/spec/01-decisions.md` §10.2) — every app/package that wants the design system
 * imports that file, not this one.
 */
export const tailwindPreset = {
  darkMode: 'class',
  theme: {
    extend: {},
  },
} satisfies Partial<Config>

export default tailwindPreset
