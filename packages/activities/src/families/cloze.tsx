import type { ClozeGap, Response } from '@retenia/activity-schema'
import { cn } from '@retenia/ui'
import { useMemo, useState } from 'react'
import { DragLayer, DropZone } from '../components/drag-layer'
import { type BankToken, TokenBank } from '../components/token-bank'
import { useFamilyActivity } from '../host/activity-context'
import { formatLabel } from '../labels'

/**
 * The `cloze` family (§7): a passage of text and gap segments, in three modes — `typed` (the
 * learner writes), `dropdown` (per-gap options) and `wordbank` (words dragged from a shared bank).
 * `listening_cloze`, `code_fill_blanks`, `c_test` and `table_completion` join later.
 *
 * The word bank is the family's drag-and-drop, so it is also where §9's keyboard rule bites: every
 * word is a `<button>` that picks itself up, and every gap grows a "place here" button while
 * something is picked up. Nothing here needs a pointer.
 */

type Assignment = Record<string, string>

export function Renderer() {
  const { activity, response, respond, locked, shuffled, labels } = useFamilyActivity('cloze')
  const { mode, segments, bankDistractors, singleUseDraggables } = activity.payload
  const gaps = useMemo(
    () => segments.filter((segment): segment is ClozeGap => segment.kind === 'gap'),
    [segments],
  )
  const answer: Response<'cloze'> = response ?? { gaps: {} }

  // The bank is built from every gap's canonical answer plus the distractors, so a token id is
  // stable across renders while the *text* it carries may legitimately repeat.
  const bank = useMemo<BankToken[]>(() => {
    const words = [...gaps.map((gap) => gap.answers[0] ?? ''), ...(bankDistractors ?? [])].filter(
      (word) => word.length > 0,
    )
    return words.map((text, index) => ({ id: `w${index}`, text }))
  }, [bankDistractors, gaps])
  const shuffledBank = shuffled(bank, 'wordbank')

  /** gap id → bank token id, so a repeated word can be told apart from its twin. */
  const [assigned, setAssigned] = useState<Assignment>({})

  function write(gapId: string, value: string) {
    respond({ gaps: { ...answer.gaps, [gapId]: value } })
  }

  function place(tokenId: string, gapId: string) {
    const token = bank.find((candidate) => candidate.id === tokenId)
    if (!token) return
    const next: Assignment = { ...assigned }
    if (singleUseDraggables) {
      for (const [gap, id] of Object.entries(next)) {
        if (id === tokenId) delete next[gap]
      }
    }
    next[gapId] = tokenId
    setAssigned(next)
    write(gapId, token.text)
  }

  function clear(gapId: string) {
    const next = { ...assigned }
    delete next[gapId]
    setAssigned(next)
    const gapsAnswer = { ...answer.gaps }
    delete gapsAnswer[gapId]
    respond({ gaps: gapsAnswer })
  }

  // A `<div>`, not a `<p>`: the word-bank gaps are block-level drop regions, and a block element
  // inside a paragraph is invalid HTML that browsers silently unnest.
  const body = (
    <div className="flex flex-wrap items-center gap-1 text-sm leading-loose">
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          // biome-ignore lint/suspicious/noArrayIndexKey: text segments have no id and never reorder.
          return <span key={`t${index}`}>{segment.text}</span>
        }
        const position = gaps.findIndex((gap) => gap.id === segment.id)
        const label = formatLabel(labels.gapLabel, { n: position + 1 })
        const value = answer.gaps[segment.id] ?? ''

        if (mode === 'dropdown') {
          return (
            <select
              key={segment.id}
              value={value}
              disabled={locked}
              aria-label={label}
              data-testid={`gap-${segment.id}`}
              onChange={(event) => write(segment.id, event.target.value)}
              className="border-border bg-surface rounded-md border px-2 py-1 text-sm"
            >
              <option value="">—</option>
              {shuffled(segment.options ?? [], `gap:${segment.id}`).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )
        }

        if (mode === 'wordbank') {
          return (
            <span key={segment.id} className="inline-flex items-center gap-1">
              <DropZone id={segment.id} label={label} className="inline-block min-w-24 py-1">
                <span data-testid={`gap-${segment.id}`}>{value || ' '}</span>
              </DropZone>
              {value && !locked && (
                <button
                  type="button"
                  onClick={() => clear(segment.id)}
                  data-testid={`clear-${segment.id}`}
                  className="text-muted text-xs underline"
                >
                  {labels.removePlacement}
                </button>
              )}
            </span>
          )
        }

        return (
          <span key={segment.id} className="inline-flex items-baseline">
            {segment.visiblePrefix && <span className="text-muted">{segment.visiblePrefix}</span>}
            <input
              type="text"
              value={value}
              disabled={locked}
              autoComplete="off"
              spellCheck={false}
              aria-label={label}
              data-testid={`gap-${segment.id}`}
              onChange={(event) => write(segment.id, event.target.value)}
              className={cn(
                'border-border bg-surface w-32 rounded-md border px-2 py-1 text-sm',
                'focus-visible:ring-brand-500 focus-visible:outline-none focus-visible:ring-2',
              )}
            />
          </span>
        )
      })}
    </div>
  )

  if (mode !== 'wordbank') {
    return (
      <div className="flex flex-col gap-4" data-testid="renderer-cloze">
        {body}
      </div>
    )
  }

  return (
    <DragLayer onPlace={place}>
      <div className="flex flex-col gap-4" data-testid="renderer-cloze">
        {body}
        <TokenBank
          tokens={shuffledBank}
          usedIds={Object.values(assigned)}
          singleUse={singleUseDraggables ?? false}
        />
      </div>
    </DragLayer>
  )
}
