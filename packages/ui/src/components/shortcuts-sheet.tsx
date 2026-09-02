import type { ShortcutDef, ShortcutScope } from '../shortcuts'
import { Kbd } from './kbd'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './sheet'

export interface ShortcutsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  shortcuts: ShortcutDef[]
  /** Resolves an i18n key from the `shell` namespace's `shortcuts.*` block (see
   * `packages/ui/src/shortcuts.ts`) — kept as a prop so this package stays i18n-agnostic. */
  translate: (key: string) => string
}

const SCOPE_ORDER: ShortcutScope[] = ['global', 'review']
const SCOPE_LABEL_KEY: Record<ShortcutScope, string> = {
  global: 'shortcuts.scopeGlobal',
  review: 'shortcuts.scopeReview',
}

/** The "Keyboard shortcuts" sheet (Shift+?) — lists the central `SHORTCUTS` registry
 * grouped by scope, so it can never drift from what's actually registered. */
export function ShortcutsSheet({ open, onOpenChange, shortcuts, translate }: ShortcutsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-label={translate('shortcuts.title')}
        data-testid="shortcuts-sheet"
      >
        <SheetHeader>
          <SheetTitle>{translate('shortcuts.title')}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-6">
          {SCOPE_ORDER.map((scope) => {
            const items = shortcuts.filter((s) => s.scope === scope)
            if (items.length === 0) return null
            return (
              <section key={scope}>
                <h3 className="text-muted mb-2 text-xs font-semibold uppercase tracking-wide">
                  {translate(SCOPE_LABEL_KEY[scope])}
                </h3>
                <ul className="flex flex-col gap-2">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-4 text-sm">
                      <span className="text-text">{translate(item.description)}</span>
                      <span className="flex gap-1">
                        {item.keys.split('+').map((key) => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}
