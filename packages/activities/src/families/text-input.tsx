import { Input } from '@retenia/ui'
import { MathField } from '../components/math-field'
import { useFamilyActivity } from '../host/activity-context'

/**
 * The `text_input` family (§7): a single short answer — `short_answer`, `numeric_answer` in the
 * MVP, plus `spell_the_word`, `dictation`, `predict_output`, `expression_input` and `regex_task`
 * later.
 *
 * `inputKind` picks the control: a number field for `number` (so the numeric keypad and the
 * spinner behave), MathLive for `math`, and a plain text field for the rest. The *grading* of all
 * of them is the family grader's business (fuzzy match, tolerance, CAS sampling), not this
 * component's.
 */
export function Renderer() {
  const { activity, response, respond, locked, result, labels } = useFamilyActivity('text_input')
  const { inputKind, answers, numeric } = activity.payload
  const value = response?.value ?? ''

  return (
    <div className="flex flex-col gap-3" data-testid="renderer-text_input">
      {inputKind === 'math' ? (
        <MathField
          value={value}
          onChange={(latex) => respond({ value: latex })}
          disabled={locked}
          aria-label={activity.instructions ?? activity.prompt}
        />
      ) : (
        <Input
          type={inputKind === 'number' ? 'number' : 'text'}
          inputMode={inputKind === 'number' ? 'decimal' : undefined}
          value={value}
          disabled={locked}
          autoComplete="off"
          spellCheck={false}
          aria-label={activity.instructions ?? activity.prompt}
          data-testid="text-input"
          onChange={(event) => respond({ value: event.target.value })}
        />
      )}

      {numeric?.unit && (
        <p className="text-muted text-xs" data-testid="numeric-unit">
          {numeric.unit}
        </p>
      )}

      {result !== null && !result.correct && (
        <p className="text-sm" data-testid="model-answer">
          <span className="text-muted">{labels.modelAnswer}: </span>
          {answers[0]?.value ?? ''}
        </p>
      )}
    </div>
  )
}
