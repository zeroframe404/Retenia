import { useEffect } from 'react'
import { useThemeStore } from './theme-store'

/**
 * Stamps the resolved theme onto `<html data-theme>` — the selector
 * `packages/ui/src/theme.css`'s `@custom-variant dark` matches — whenever the store's
 * `resolved` value changes. Mount this once near the app root (or once per Storybook
 * decorator render).
 */
export function useApplyTheme(root: HTMLElement | null = globalThis.document?.documentElement) {
  const resolved = useThemeStore((state) => state.resolved)

  useEffect(() => {
    if (!root) return
    root.dataset.theme = resolved
  }, [resolved, root])
}
