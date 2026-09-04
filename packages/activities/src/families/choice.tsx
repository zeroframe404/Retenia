import type { ChoiceOption, ChoiceSet, Response } from '@retenia/activity-schema'
import type { ConfidenceLevel } from '@retenia/core'
import { cn } from '@retenia/ui'
import { ConfidencePicker } from '../components/confidence-picker'
import { RichText } from '../components/rich-text'
import { useFamilyActivity } from '../host/activity-context'

/**
 * The `choice` family (§7): `mcq_single`, `mcq_multi`, `true_false`, `statement_set`,
 * `complete_the_chat` in the MVP, and eight more types in phases 2–3 — all of them "one or more
 * sets of options", which is why they share one renderer.
 *
 * Each set is a `<fieldset>` of native radios or checkboxes: the keyboard behaviour, the grouping a
 * screen reader announces and the "1 of 4" position all come for free, and there is nothing to
 * re-implement per type. §2's per-option feedback is shown once a `GradeResult` exists.
 */

function setKey(set: ChoiceSet, index: number): string {
  return set.id ?? `set-${index}`
}

function OptionRow({
  option,
  set,
  index,
  selected,
  onToggle,
}: {
  option: ChoiceOption
  set: ChoiceSet
  index: number
  selected: boolean
  onToggle: () => void
}) {
  const { locked, result, labels } = useFamilyActivity('choice')
  const graded = result !== null
  const revealed = graded && (selected || option.correct)

  return (
    <li>
      <label
        className={cn(
          'border-border flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm',
          'has-[:focus-visible]:ring-brand-500 has-[:focus-visible]:ring-2',
          selected && !graded && 'border-brand-500 bg-brand-50 dark:bg-brand-950/40',
          graded && option.correct && 'border-correct bg-correct/10',
          graded && selected && !option.correct && 'border-incorrect bg-incorrect/10',
          locked && 'cursor-default',
        )}
      >
        <input
          type={set.multiple ? 'checkbox' : 'radio'}
          name={setKey(set, index)}
          value={option.id}
          checked={selected}
          disabled={locked}
          onChange={onToggle}
          data-testid={`option-${option.id}`}
          className="mt-0.5 size-4 shrink-0"
        />
        <span className="flex flex-col gap-1">
          <RichText>{option.text}</RichText>
          {revealed && option.feedback && (
            <span className="text-muted text-xs" data-testid={`option-feedback-${option.id}`}>
              {option.feedback}
            </span>
          )}
          {graded && option.correct && <span className="sr-only">{labels.correct}</span>}
        </span>
      </label>
    </li>
  )
}

export function Renderer() {
  const { activity, response, respond, shuffled } = useFamilyActivity('choice')
  const { sets, askConfidence } = activity.payload
  const answer: Response<'choice'> = response ?? { sets: sets.map(() => ({ selected: [] })) }

  function update(setIndex: number, optionId: string, multiple: boolean) {
    const next = sets.map((_, index) => ({
      selected: [...(answer.sets[index]?.selected ?? [])],
    }))
    const current = next[setIndex]
    if (!current) return
    if (multiple) {
      current.selected = current.selected.includes(optionId)
        ? current.selected.filter((id) => id !== optionId)
        : [...current.selected, optionId]
    } else {
      current.selected = [optionId]
    }
    respond({ sets: next, ...(answer.confidence ? { confidence: answer.confidence } : {}) })
  }

  function setConfidence(confidence: ConfidenceLevel) {
    respond({ sets: answer.sets.map((set) => ({ selected: [...set.selected] })), confidence })
  }

  return (
    <div className="flex flex-col gap-5" data-testid="renderer-choice">
      {sets.map((set, index) => {
        const key = setKey(set, index)
        return (
          <fieldset key={key} className="flex flex-col gap-2" data-testid={`choice-set-${key}`}>
            <legend className="text-sm font-medium">
              {set.stem ? <RichText>{set.stem}</RichText> : <span className="sr-only">{key}</span>}
            </legend>
            <ul className="flex flex-col gap-2">
              {shuffled(set.options, `options:${key}`).map((option) => (
                <OptionRow
                  key={option.id}
                  option={option}
                  set={set}
                  index={index}
                  selected={(answer.sets[index]?.selected ?? []).includes(option.id)}
                  onToggle={() => update(index, option.id, set.multiple)}
                />
              ))}
            </ul>
          </fieldset>
        )
      })}
      {askConfidence && (
        <ConfidencePicker value={answer.confidence ?? null} onChange={setConfidence} />
      )}
    </div>
  )
}
