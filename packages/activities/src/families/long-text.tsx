import { cn, Textarea } from '@retenia/ui'
import { RichText } from '../components/rich-text'
import { useFamilyActivity } from '../host/activity-context'
import { formatLabel } from '../labels'

/**
 * The `long_text` family (§7): `free_recall` and `essay_rubric` in the MVP, `structure_strip`,
 * `list_recall` and `self_check_statement` later.
 *
 * A textarea, a word counter and — once a grade exists — the two things §10's **AI** row makes
 * non-negotiable: *"always showing the model answer"*, and the key points the answer was
 * measured against, marked covered or not. The rubric breakdown, the evidence quotes and the
 * rating chip belong to the whole panel rather than to this family, so they live in
 * `<FeedbackPanel/>`; what is here is what only a long answer has.
 *
 * The renderer still knows nothing about *how* the text will be scored. The deterministic
 * key-point matcher, the AI rubric grader and the offline estimate are three implementations of
 * one `grade` port, and the only difference visible from here is what the resulting
 * `GradeResult` happens to carry.
 */
export function Renderer() {
  const { activity, response, respond, locked, result, labels } = useFamilyActivity('long_text')
  const { minWords, maxWords, sections, modelAnswer, keyPoints } = activity.payload
  const text = response?.text ?? ''
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length
  const hasRange = minWords !== undefined || maxWords !== undefined
  // Only a range the activity actually set is enforced on screen; an answer outside it is
  // flagged, never blocked — "never punish the error" (`docs/spec/01-decisions.md` §7 rule 5),
  // and a short answer is the pre-grader's business, not the submit button's.
  const outOfRange =
    words > 0 &&
    ((minWords !== undefined && words < minWords) || (maxWords !== undefined && words > maxWords))
  const covered = new Set(
    result?.perItem?.filter((item) => item.correct).map((item) => item.id) ?? [],
  )

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

      <p className="text-muted flex flex-wrap items-baseline gap-2 text-xs">
        <span
          className={cn('tabular-nums', outOfRange && 'text-streak')}
          data-testid="word-count"
          data-out-of-range={outOfRange}
        >
          {hasRange
            ? formatLabel(labels.wordsRangeLabel, {
                words,
                min: minWords ?? 0,
                max: maxWords ?? '∞',
              })
            : formatLabel(labels.wordsLabel, { words })}
        </span>
        <span>{labels.markdownAllowed}</span>
      </p>

      {result !== null && keyPoints && keyPoints.length > 0 && (
        <section data-testid="key-points" className="border-border rounded-md border p-3">
          <h3 className="text-muted text-xs font-semibold uppercase tracking-wide">
            {labels.keyPointsHeading}
          </h3>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {keyPoints.map((point) => (
              <li
                key={point.id}
                data-testid={`key-point-${point.id}`}
                data-covered={covered.has(point.id)}
                className="flex items-baseline gap-2"
              >
                <span className={cn(covered.has(point.id) ? 'text-correct' : 'text-muted')}>
                  {covered.has(point.id) ? '✓' : '○'}
                </span>
                <span>{point.text}</span>
                <span className="sr-only">
                  {covered.has(point.id) ? labels.keyPointCovered : labels.keyPointMissed}
                </span>
              </li>
            ))}
          </ul>
        </section>
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
