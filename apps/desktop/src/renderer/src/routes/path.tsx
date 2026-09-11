import { Button, EmptyState } from '@retenia/ui'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  CompletionPage,
  DiagnosticPage,
  DiagnosticResultPage,
  PreviewPage,
  QaReportPage,
  WizardPage,
} from '../features/pathgen'
import { useT } from '../i18n/use-t'

/**
 * "Generate with AI" (`docs/spec/04-path-generation.md` §13, sub-phase 8.2): one route with a
 * `view` search param rather than nested dynamic routes — a path has at most one unfrozen
 * version in flight at a time in this UI, so the wizard/preview/completion progression is a
 * `view` transition plus the `pathVersionId`/`runId` the previous step handed forward, the
 * same pattern `library.tsx` already uses for its own multi-view search params.
 */

const pathSearchSchema = z.object({
  /**
   * `qa` is stage 8's report for the frozen version (sub-phase 8.4); `diagnostic` and
   * `diagnosticResult` are §13 step 4's prior-knowledge diagnostic and its summary (8.5),
   * between freezing the path and expanding it.
   */
  view: z
    .enum(['generate', 'preview', 'diagnostic', 'diagnosticResult', 'summary', 'qa'])
    .optional(),
  pathVersionId: z.uuid().optional(),
  runId: z.uuid().optional(),
})

/**
 * The screen wrapper `e2e/shell.spec.ts` asserts on: every section renders `screen-<id>`, and
 * the accessibility sweep scopes its axe run to it.
 *
 * A wrapper rather than a `data-testid` on each of the three views, because what the shell
 * test is checking is that the *route* rendered — which view it settled on is the business of
 * `pathgen.spec.ts`.
 */
function PathScreen() {
  return (
    <div data-testid="screen-path" className="flex h-full flex-col">
      <PathView />
    </div>
  )
}

function PathView() {
  const t = useT('path')
  const { view, pathVersionId } = Route.useSearch()
  const navigate = Route.useNavigate()

  if (view === 'generate' || (view === undefined && pathVersionId === undefined)) {
    return (
      <WizardPage
        onGenerated={(result) =>
          navigate({
            search: { view: 'preview', pathVersionId: result.pathVersionId, runId: result.runId },
          })
        }
      />
    )
  }

  if (pathVersionId === undefined) {
    return (
      <EmptyState
        title={t('title')}
        description={t('comingSoon')}
        action={
          <Button onClick={() => navigate({ search: { view: 'generate' } })}>
            {t('wizard.generate')}
          </Button>
        }
      />
    )
  }

  if (view === 'qa') {
    return (
      <QaReportPage
        pathVersionId={pathVersionId}
        onBack={() => navigate({ search: { view: 'summary', pathVersionId } })}
      />
    )
  }

  if (view === 'diagnostic') {
    return (
      <DiagnosticPage
        pathVersionId={pathVersionId}
        onDone={() => navigate({ search: { view: 'summary', pathVersionId } })}
        onResult={() => navigate({ search: { view: 'diagnosticResult', pathVersionId } })}
      />
    )
  }

  if (view === 'diagnosticResult') {
    return (
      <DiagnosticResultPage
        pathVersionId={pathVersionId}
        onContinue={() => navigate({ search: { view: 'summary', pathVersionId } })}
      />
    )
  }

  if (view === 'summary') {
    return (
      <CompletionPage
        pathVersionId={pathVersionId}
        onOpenQaReport={() => navigate({ search: { view: 'qa', pathVersionId } })}
      />
    )
  }

  // §13 step 3's "Do I start from scratch or take the diagnostic?": freezing leads to the
  // diagnostic, which then hands over to the completion screen that starts the expansion.
  return (
    <PreviewPage
      pathVersionId={pathVersionId}
      onFrozen={(frozenVersionId) =>
        navigate({ search: { view: 'diagnostic', pathVersionId: frozenVersionId } })
      }
    />
  )
}

export const Route = createFileRoute('/path')({
  validateSearch: pathSearchSchema,
  component: PathScreen,
})
