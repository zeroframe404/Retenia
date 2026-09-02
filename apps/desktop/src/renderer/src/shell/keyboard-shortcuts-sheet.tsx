import { SHORTCUTS, ShortcutsSheet } from '@retenia/ui'
import { useT } from '../i18n/use-t'

export interface KeyboardShortcutsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Thin wrapper feeding the central `SHORTCUTS` registry and this app's `shell` namespace
 * translations into `@retenia/ui`'s `ShortcutsSheet` (Shift+?). */
export function KeyboardShortcutsSheet({ open, onOpenChange }: KeyboardShortcutsSheetProps) {
  const t = useT('shell')
  return (
    <ShortcutsSheet open={open} onOpenChange={onOpenChange} shortcuts={SHORTCUTS} translate={t} />
  )
}
