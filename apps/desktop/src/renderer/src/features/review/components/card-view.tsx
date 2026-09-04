import { IconButton, MarkdownView, Tooltip, TooltipContent, TooltipTrigger } from '@retenia/ui'
import { Volume2Icon } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../i18n/use-t'
import {
  activeClozeNumber,
  matchesTypedAnswer,
  parseClozeText,
  toBasicFields,
  toClozeText,
} from '../flashcard-fields'

export interface CardViewProps {
  /** `card.template`: `basic`, `reverse`, `cloze:c<N>`, `type_in`. Anything else falls back
   *  to the `basic` renderer — the review screen should never refuse to show a card. */
  template: string
  /** The knowledge item's `fields`, read defensively (see `flashcard-fields.ts`). */
  fields: unknown
  revealed: boolean
  onReveal: () => void
}

/** The audio/TTS placeholder every template shows next to its prompt — 11.3 wires a real
 *  provider; today it is a disabled affordance so the layout does not shift once it lands. */
function AudioButton() {
  const t = useT('review')
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={t('screen.explainComingSoon')}
            disabled
          />
        }
      >
        <Volume2Icon />
      </TooltipTrigger>
      <TooltipContent>{t('screen.explainComingSoon')}</TooltipContent>
    </Tooltip>
  )
}

function Prompt({ children }: { children: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <MarkdownView>{children || ' '}</MarkdownView>
      </div>
      <AudioButton />
    </div>
  )
}

function BasicCardView({
  fields,
  reverse,
  revealed,
  onReveal,
}: {
  fields: unknown
  reverse: boolean
  revealed: boolean
  onReveal: () => void
}) {
  const t = useT('review')
  const { front, back } = toBasicFields(fields, reverse)

  return (
    <div className="flex flex-col gap-6" data-testid="card-basic">
      <Prompt>{front}</Prompt>
      {revealed ? (
        <div className="border-border flex flex-col gap-2 border-t pt-6" data-testid="card-back">
          <MarkdownView>{back || ' '}</MarkdownView>
        </div>
      ) : (
        <button
          type="button"
          onClick={onReveal}
          data-testid="card-reveal"
          className="text-muted hover:text-text self-start text-sm underline underline-offset-2"
        >
          {t('screen.revealHint')}
        </button>
      )}
    </div>
  )
}

function ClozeCardView({
  template,
  fields,
  revealed,
  onReveal,
}: {
  template: string
  fields: unknown
  revealed: boolean
  onReveal: () => void
}) {
  const t = useT('review')
  const text = toClozeText(fields)
  const active = activeClozeNumber(template)
  const segments = parseClozeText(text, active)
  const activeHint = segments.find((s) => s.kind === 'cloze' && s.active)
  const hint = activeHint?.kind === 'cloze' ? activeHint.hint : null

  return (
    <div className="flex flex-col gap-6" data-testid="card-cloze">
      <div className="flex items-start justify-between gap-3">
        <p className="text-text min-w-0 flex-1 text-base leading-relaxed">
          {segments.map((segment) => {
            if (segment.kind === 'text') {
              return <span key={segment.start}>{segment.text}</span>
            }
            if (!segment.active) {
              return <span key={segment.start}>{segment.answer}</span>
            }
            return (
              <span
                key={segment.start}
                data-testid="cloze-blank"
                className="border-brand-400 bg-brand-50 dark:bg-brand-900/40 mx-0.5 rounded border-b-2 px-1.5 font-medium"
              >
                {revealed ? segment.answer : '…'}
              </span>
            )
          })}
        </p>
        <AudioButton />
      </div>
      {!revealed && hint && <p className="text-muted text-sm">{t('screen.clozeHint', { hint })}</p>}
      {!revealed && (
        <button
          type="button"
          onClick={onReveal}
          data-testid="card-reveal"
          className="text-muted hover:text-text self-start text-sm underline underline-offset-2"
        >
          {t('screen.revealHint')}
        </button>
      )}
    </div>
  )
}

function TypeInCardView({
  fields,
  revealed,
  onReveal,
}: {
  fields: unknown
  revealed: boolean
  onReveal: () => void
}) {
  const t = useT('review')
  const { front, back } = toBasicFields(fields, false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // A fresh type-in card should be ready to type into immediately (`docs/spec/08-ux.md`
  // §1 "keyboard first") — focused imperatively on mount rather than via the `autoFocus`
  // attribute, which a11y lint flags because it can steal focus from elsewhere on the page;
  // here it can't, since this component only ever mounts as the one card on screen.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || revealed) return
    event.preventDefault()
    onReveal()
    event.currentTarget.blur()
  }

  const correct = revealed ? matchesTypedAnswer(value, back) : null

  return (
    <div className="flex flex-col gap-6" data-testid="card-type-in">
      <Prompt>{front}</Prompt>
      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          disabled={revealed}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('screen.typeAnswerPlaceholder')}
          data-testid="type-in-input"
          autoComplete="off"
          spellCheck={false}
          className="border-border bg-surface text-text placeholder:text-muted focus-visible:outline-brand-500 h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-70"
        />
        {!revealed && (
          <button
            type="button"
            onClick={() => {
              onReveal()
            }}
            data-testid="card-reveal"
            className="text-muted hover:text-text self-start text-sm underline underline-offset-2"
          >
            {t('screen.check')}
          </button>
        )}
        {revealed && (
          <div
            className={
              correct ? 'text-correct text-sm font-medium' : 'text-incorrect text-sm font-medium'
            }
            data-testid="type-in-result"
          >
            {correct ? t('screen.correct') : t('screen.incorrect')}
          </div>
        )}
      </div>
      {revealed && !correct && (
        <div className="border-border flex flex-col gap-2 border-t pt-4" data-testid="card-back">
          <p className="text-text text-sm">{t('screen.correctAnswer', { answer: back })}</p>
        </div>
      )}
    </div>
  )
}

/** Dispatches on `card.template` to the right v1 renderer. Unrecognized templates fall back
 *  to `basic` rather than showing nothing. */
export function CardView({ template, fields, revealed, onReveal }: CardViewProps) {
  if (template === 'reverse') {
    return <BasicCardView fields={fields} reverse revealed={revealed} onReveal={onReveal} />
  }
  if (template === 'type_in') {
    return <TypeInCardView fields={fields} revealed={revealed} onReveal={onReveal} />
  }
  if (template.startsWith('cloze')) {
    return (
      <ClozeCardView template={template} fields={fields} revealed={revealed} onReveal={onReveal} />
    )
  }
  return <BasicCardView fields={fields} reverse={false} revealed={revealed} onReveal={onReveal} />
}
