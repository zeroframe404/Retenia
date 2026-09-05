/// <reference path="../css.d.ts" />
import type { ComponentProps } from 'react'
import { Toaster as SonnerToaster, toast } from 'sonner'
// Sonner ships its stylesheet twice: as this file, and as a `<style>` element it injects into
// `document.head` at import time. The injected one is an inline style element, which the
// renderer's `style-src 'self'` blocks (`apps/desktop/src/main/security/csp.ts`) — so in the
// packaged app every toast rendered unstyled while every test stayed green. Importing the file
// puts the same CSS through the bundler into the app's own stylesheet, where the policy allows
// it. The injection still happens and is still blocked; it is now redundant rather than load
// bearing.
import 'sonner/dist/styles.css'
import { useThemeStore } from '../theme/theme-store'

export { toast }

/** Mount once near the app root. Sonner has its own light/dark handling — wired to the
 * same `useThemeStore` every other themed surface reads from, rather than its default
 * `prefers-color-scheme` detection, so a toast always matches the rest of the app
 * (docs/spec/08-ux.md: "streak saver", "Done for today" celebrations, error toasts). */
export function Toaster(props: ComponentProps<typeof SonnerToaster>) {
  const resolved = useThemeStore((state) => state.resolved)

  return (
    <SonnerToaster
      theme={resolved}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: 'group toast bg-surface text-text border-border shadow-soft rounded-md',
          description: 'text-muted',
          actionButton: 'bg-brand-600 text-white',
          cancelButton: 'bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50',
        },
      }}
      {...props}
    />
  )
}
