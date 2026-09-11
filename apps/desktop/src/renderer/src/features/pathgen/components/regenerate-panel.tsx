import type { AffectedLessonsDto } from '@retenia/ipc-contract'
import { Button } from '@retenia/ui'
import { useT } from '../../../i18n/use-t'

/**
 * "Regenerar ruta" and "Regenerar afectadas" (`docs/spec/04-path-generation.md` §13 step 6,
 * §14 pitfall 19), as the completion screen shows them. Presentational: the screen owns the
 * queries and the mutations, so the story can show every state without a bridge.
 */

export interface RegeneratePanelProps {
  /** `undefined` while the report loads. */
  affected: AffectedLessonsDto | undefined
  regenerating: boolean
  regeneratingAffected: boolean
  onRegenerate: () => void
  onRegenerateAffected: () => void
  error?: string | null
}

export function RegeneratePanel({
  affected,
  regenerating,
  regeneratingAffected,
  onRegenerate,
  onRegenerateAffected,
  error = null,
}: RegeneratePanelProps) {
  const t = useT('path')
  const lessons = affected?.lessons ?? []

  return (
    <section
      className="border-border flex flex-col gap-4 rounded-md border p-4"
      data-testid="regenerate-panel"
      aria-labelledby="regenerate-title"
    >
      <div className="flex flex-col gap-1">
        <h2 id="regenerate-title" className="font-display text-lg font-semibold">
          {t('regenerate.title')}
        </h2>
        <p className="text-muted text-sm">{t('regenerate.description')}</p>
      </div>
      <div>
        <Button onClick={onRegenerate} disabled={regenerating} data-testid="completion-regenerate">
          {regenerating ? t('regenerate.running') : t('regenerate.action')}
        </Button>
      </div>
      {error !== null && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}

      {affected !== undefined && affected.sources.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="affected-lessons">
          <h3 className="text-sm font-semibold">{t('regenerate.affected.title')}</h3>
          <ul className="text-muted flex flex-col gap-1 text-sm">
            {affected.sources.map((source) => (
              <li key={source.sourceId}>
                {source.title} — {t(`regenerate.affected.reason.${source.reason}`)}
              </li>
            ))}
          </ul>
          {lessons.length === 0 ? (
            <p className="text-muted text-sm">{t('regenerate.affected.none')}</p>
          ) : (
            <>
              <p className="text-sm">
                {t('regenerate.affected.description', { count: lessons.length })}
              </p>
              <ul className="flex flex-col gap-1 text-sm">
                {lessons.map((lesson) => (
                  <li key={lesson.lessonId} data-testid="affected-lesson">
                    {lesson.specId} · {lesson.title}
                  </li>
                ))}
              </ul>
              <div>
                <Button
                  variant="outline"
                  onClick={onRegenerateAffected}
                  disabled={regeneratingAffected}
                  data-testid="regenerate-affected"
                >
                  {regeneratingAffected
                    ? t('regenerate.affected.running')
                    : t('regenerate.affected.action')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
