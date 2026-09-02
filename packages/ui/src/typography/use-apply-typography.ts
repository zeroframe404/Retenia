import { useEffect } from 'react'
import { useTypographySettingsStore } from './typography-store'

/**
 * Stamps the typography settings onto `<html>` as the CSS custom properties and data
 * attribute `theme.css` reads (`--user-font-size`, `--user-line-height`,
 * `data-dyslexia-font`). Mount this once near the app root, alongside `useApplyTheme`.
 */
export function useApplyTypography(
  root: HTMLElement | null = globalThis.document?.documentElement,
) {
  const fontSize = useTypographySettingsStore((state) => state.fontSize)
  const lineHeight = useTypographySettingsStore((state) => state.lineHeight)
  const dyslexiaFont = useTypographySettingsStore((state) => state.dyslexiaFont)

  useEffect(() => {
    if (!root) return
    root.style.setProperty('--user-font-size', `${fontSize}px`)
    root.style.setProperty('--user-line-height', `${lineHeight}`)
    root.dataset.dyslexiaFont = dyslexiaFont ? 'true' : 'false'
  }, [root, fontSize, lineHeight, dyslexiaFont])
}
