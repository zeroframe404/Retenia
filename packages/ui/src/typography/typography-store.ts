import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Clamp bounds from the WCAG 2.2 AA accessibility pass (`docs/spec/08-ux.md` §1
 * accessibility): resizable text down to 14px never breaks the shell's compact layout,
 * up to 20px stays legible without overflowing fixed-width chrome (sidebar, top bar). */
export const TYPOGRAPHY_FONT_SIZE_MIN = 14
export const TYPOGRAPHY_FONT_SIZE_MAX = 20
export const TYPOGRAPHY_LINE_HEIGHT_MIN = 1.2
export const TYPOGRAPHY_LINE_HEIGHT_MAX = 2

interface TypographySettingsState {
  /** Root font size in px; every `rem`-based size in the app scales off this. */
  fontSize: number
  /** Body line-height (unitless multiplier). */
  lineHeight: number
  /** Swaps `--font-sans` for the bundled Atkinson Hyperlegible (Braille Institute,
   * OFL-1.1) — designed for readability for low-vision and dyslexic readers. */
  dyslexiaFont: boolean
  setFontSize: (fontSize: number) => void
  setLineHeight: (lineHeight: number) => void
  setDyslexiaFont: (dyslexiaFont: boolean) => void
  reset: () => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const defaults = {
  fontSize: 16,
  lineHeight: 1.5,
  dyslexiaFont: false,
} as const

/**
 * Font settings (WCAG 2.2 AA accessibility pass: base size, line height, a dyslexia-friendly
 * font option). Unlike `useThemeStore`/`useSoundSettingsStore`, this is a purely local
 * display preference with no main-process counterpart to sync with, so it persists itself
 * to `localStorage` — `useApplyTypography` (`./use-apply-typography.ts`) is what actually
 * turns the stored values into the CSS custom properties `theme.css` reads.
 */
export const useTypographySettingsStore = create<TypographySettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      setFontSize: (fontSize) =>
        set({ fontSize: clamp(fontSize, TYPOGRAPHY_FONT_SIZE_MIN, TYPOGRAPHY_FONT_SIZE_MAX) }),
      setLineHeight: (lineHeight) =>
        set({
          lineHeight: clamp(lineHeight, TYPOGRAPHY_LINE_HEIGHT_MIN, TYPOGRAPHY_LINE_HEIGHT_MAX),
        }),
      setDyslexiaFont: (dyslexiaFont) => set({ dyslexiaFont }),
      reset: () => set(defaults),
    }),
    { name: 'retenia.typography-settings' },
  ),
)
