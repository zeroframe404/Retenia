import { Textarea } from '@retenia/ui'
import { RichText } from '../components/rich-text'
import { useFamilyActivity } from '../host/activity-context'

/**
 * The `long_text` family (§7): `free_recall` and `essay_rubric` in the MVP, `structure_strip`,
 * `list_recall` and `self_check_statement` later.
 *
 * The MVP grader is the deterministic key-point matcher of `@retenia/activity-graders`; the AI
 * rubric of §10 arrives in sub-phase 5.5 as a different `grade` port over the same renderer, which
 * is why nothing here knows how the text will be scored. §10 also requires the model answer to be
 * shown *whatever* the score, so it appears as soon as a result exists.
 */
export function Renderer() {
  const { activity, response, respond, locked, result, labels } = useFamilyActivity('long_text')
  const { minWords, maxWords, sections, modelAnswer } = activity.payload
  const text = response?.text ?? ''
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length

  return (
    <div className="flex flex-col gap-3" data-testid="renderer-long_text">
      {sections && sections.length > 0 && (
        <ol className="text-muted flex flex-col gap-1 text-xs" data-testid="long-text-sections">
          {sections.map((section) => (
            <li key={section.id}>
              <span className="font-medium">{section.title}</span>
              {section.hint && <span> — {section.hint}</span>}
            </li>
          ))}
        </ol>
      )}

      <Textarea
        value={text}
        rows={8}
        disabled={locked}
        aria-label={activity.instructions ?? activity.prompt}
        data-testid="long-text-input"
        onChange={(event) => respond({ text: event.target.value })}
      />

      {(minWords !== undefined || maxWords !== undefined) && (
        <p className="text-muted text-xs tabular-nums" data-testid="word-count">
          {words}
          {minWords !== undefined && ` / ${minWords}`}
          {maxWords !== undefined && `–${maxWords}`}
        </p>
      )}

      {result !== null && modelAnswer && (
        <section data-testid="model-answer" className="border-border rounded-md border p-3">
          <h3 className="text-muted text-xs font-semibold uppercase tracking-wide">
            {labels.modelAnswer}
          </h3>
          <RichText className="text-sm">{modelAnswer}</RichText>
        </section>
      )}
    </div>
  )
}
