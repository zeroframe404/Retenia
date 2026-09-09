import { Eye, EyeOff } from 'lucide-react'
import type { ComponentProps } from 'react'
import { useState } from 'react'
import { cn } from '../lib/cn'
import { Input } from './input'

export interface SecretInputProps extends Omit<ComponentProps<'input'>, 'type'> {
  /**
   * The masked preview `secrets.get` answers with (`••••wxyz`), or `null` when nothing is
   * stored for this provider yet. Shown as the placeholder while the field is empty, so it
   * disappears the moment the user starts typing a new key — there is no separate "editing"
   * state to track, because the stored value never reaches this component at all.
   */
  preview: string | null
  /** Localized labels for the reveal toggle; default to English. */
  revealLabel?: string
  hideLabel?: string
}

/**
 * A masked API-key field (`docs/spec/08-ux.md` §1: provider cards). Defaults to
 * `type="password"`, with a toggle that reveals only what is *currently being typed* — never
 * the stored value, since that value never crosses into the renderer in the first place
 * (CLAUDE.md: secrets only via `safeStorage` in main).
 */
export function SecretInput({
  preview,
  revealLabel = 'Show key',
  hideLabel = 'Hide key',
  className,
  placeholder,
  value,
  ...props
}: SecretInputProps) {
  const [revealed, setRevealed] = useState(false)
  const isEmpty = value === '' || value === undefined
  const effectivePlaceholder = isEmpty && preview !== null ? preview : placeholder

  return (
    <div className="relative">
      <Input
        type={revealed ? 'text' : 'password'}
        value={value}
        placeholder={effectivePlaceholder}
        className={cn('pr-10', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setRevealed((current) => !current)}
        aria-label={revealed ? hideLabel : revealLabel}
        className="text-muted hover:text-text absolute inset-y-0 right-0 flex w-10 items-center justify-center"
      >
        {revealed ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  )
}
