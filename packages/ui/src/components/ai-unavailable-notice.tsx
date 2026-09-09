import { InfoIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface AiUnavailableNoticeProps extends Omit<ComponentProps<'p'>, 'children'> {
  /** Why the AI-backed control is disabled — a translated string, not a code. */
  reason: ReactNode
}

/**
 * "Probar sin IA" (`docs/spec/08-ux.md` §2): the app works without any provider key, and an
 * AI-backed control explains what it needs rather than failing silently or vanishing. A
 * small, inline note — pairs with a disabled control right next to it, not a whole-screen
 * `EmptyState`.
 */
export function AiUnavailableNotice({ reason, className, ...props }: AiUnavailableNoticeProps) {
  return (
    <p className={cn('text-muted flex items-center gap-1.5 text-xs', className)} {...props}>
      <InfoIcon size={14} aria-hidden="true" className="shrink-0" />
      <span>{reason}</span>
    </p>
  )
}
