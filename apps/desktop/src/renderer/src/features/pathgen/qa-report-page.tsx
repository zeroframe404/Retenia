import type { QaFindingDto, QaReportLessonDto } from '@retenia/ipc-contract'
import { Badge, Button, EmptyState, ErrorState, QaBadges } from '@retenia/ui'
import { useNavigate } from '@tanstack/react-router'
import { useT } from '../../i18n/use-t'
import { useQaReport } from './use-pathgen'

/**
 * Stage 8's report for one path (sub-phase 8.4, `docs/spec/04-path-generation.md` §13 step 5's
 * "QA indicators" and "Report an error (opens the citation)", as a screen): every lesson
 * with its verdict, and under it the sentences the gates flagged — each with the citation it
 * carried and a one-click "abrir fuente" that lands on the cited page, the same reader route
 * "Reportar error" uses.
 *
 * Built like the settings sections — `<section>` per lesson, a small table of findings —
 * because it is a document to read, not a form to fill.
 */

export interface QaReportPageProps {
  pathVersionId: string
  onBack: () => void
}

function CitationButtons({ finding }: { finding: QaFindingDto }) {
  const t = useT('path')
  const navigate = useNavigate()
  if (finding.citations.length === 0) return null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {finding.citations.map((citation) => (
        <Button
          key={citation.id}
          size="sm"
          variant="ghost"
          onClick={() =>
            navigate({
              to: '/library',
              search: {
                sourceId: citation.sourceId,
                ...(citation.page === null ? {} : { page: citation.page }),
              },
            })
          }
        >
          {t('qa.openSource', { id: citation.id, locator: citation.locator })}
        </Button>
      ))}
    </span>
  )
}

function LessonSection({ lesson }: { lesson: QaReportLessonDto }) {
  const t = useT('path')
  return (
    <section
      className="border-border flex flex-col gap-3 rounded-lg border p-4"
      data-testid={`qa-report-${lesson.specId}`}
    >
      <header className="flex flex-wrap items-center gap-3">
        <span className="text-muted text-xs">{lesson.specId}</span>
        <h3 className="grow text-sm font-semibold">{lesson.title}</h3>
        {lesson.qa === null ? (
          <Badge variant="neutral">{t('qa.unreviewed')}</Badge>
        ) : (
          <QaBadges
            faithfulness={lesson.qa.faithfulness}
            sourcesCount={lesson.qa.sourcesCount}
            verdict={lesson.qa.verdict}
            reviewed={lesson.qa.reviewed}
            labels={{
              fidelity: (percent) => t('qa.fidelity', { percent }),
              sources: (count) => t('qa.sources', { count }),
              reviewed: t('qa.reviewed'),
              review: t('qa.review'),
              unreviewed: t('qa.unreviewed'),
            }}
          />
        )}
      </header>

      {lesson.qa !== null && (
        <p className="text-muted text-xs">
          {t(`qa.verdict.${lesson.qa.verdict}`)}
          {lesson.qa.pedagogyScore === null
            ? ''
            : ` · ${t('qa.pedagogy', { score: lesson.qa.pedagogyScore })}`}
          {' · '}
          {lesson.gates
            .filter((gate) => gate.outcome !== 'pass')
            .map((gate) => `${t(`qa.gate.${gate.gate}`)}: ${t(`qa.outcome.${gate.outcome}`)}`)
            .join(' · ')}
        </p>
      )}

      {lesson.findings.length === 0 ? (
        <p className="text-muted text-xs">{t('qa.noFindings')}</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted">
              <th className="pr-2 font-medium">{t('qa.column.gate')}</th>
              <th className="pr-2 font-medium">{t('qa.column.sentence')}</th>
              <th className="pr-2 font-medium">{t('qa.column.detail')}</th>
              <th className="font-medium">{t('qa.column.source')}</th>
            </tr>
          </thead>
          <tbody>
            {lesson.findings.map((finding, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: findings have no id of their own and the list is static per render
              <tr key={index} className="border-border border-t align-top">
                <td className="py-1 pr-2 whitespace-nowrap">{t(`qa.kind.${finding.kind}`)}</td>
                <td className="py-1 pr-2">{finding.sentence}</td>
                <td className="text-muted py-1 pr-2">{finding.detail}</td>
                <td className="py-1">
                  <CitationButtons finding={finding} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

export function QaReportPage({ pathVersionId, onBack }: QaReportPageProps) {
  const t = useT('path')
  const report = useQaReport(pathVersionId)

  if (report.isLoading) return null
  if (report.error || !report.data) return <ErrorState title={t('preview.loadError')} />

  const { totals, lessons } = report.data
  return (
    <div className="flex h-full flex-col gap-6 p-6" data-testid="pathgen-qa-report">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold">{t('qa.reportTitle')}</h1>
        <Button variant="outline" onClick={onBack} data-testid="qa-report-back">
          {t('qa.back')}
        </Button>
      </header>
      <p className="text-muted text-sm" data-testid="qa-report-totals">
        {t('qa.totals', {
          reviewed: totals.reviewed,
          lessons: totals.lessons,
          flagged: totals.flagged,
        })}
        {totals.meanFaithfulness === null
          ? ''
          : ` · ${t('qa.meanFidelity', { percent: Math.round(totals.meanFaithfulness * 100) })}`}
      </p>
      {lessons.length === 0 ? (
        <EmptyState title={t('qa.reportEmpty')} />
      ) : (
        <div className="flex flex-col gap-3">
          {lessons.map((lesson) => (
            <LessonSection key={lesson.lessonId} lesson={lesson} />
          ))}
        </div>
      )}
    </div>
  )
}
