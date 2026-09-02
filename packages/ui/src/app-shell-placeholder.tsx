import type { Clock } from '@retenia/core'

export interface AppShellPlaceholderProps {
  title: string
  clock?: Clock
}

/**
 * Stand-in for the real app shell built in sub-phase 2.2. Exists now so `ui` has a
 * real component (proving the `core` type import + React + Tailwind wiring) instead
 * of an empty placeholder.
 */
export function AppShellPlaceholder({ title }: AppShellPlaceholderProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-50">
      <h1 className="text-2xl font-semibold">{title}</h1>
    </div>
  )
}
