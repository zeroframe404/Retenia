import { Button, EmptyState } from '@retenia/ui'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { CompletionPage, PreviewPage, WizardPage } from '../features/pathgen'
import { useT } from '../i18n/use-t'

/**
 * "Generate with AI" (`docs/spec/04-path-generation.md` §13, sub-phase 8.2): one route with a
 * `view` search param rather than nested dynamic routes — a path has at most one unfrozen
 * version in flight at a time in this UI, so the wizard/preview/completion progression is a
 * `view` transition plus the `pathVersionId`/`runId` the previous step handed forward, the
 * same pattern `library.tsx` already uses for its own multi-view search params.
 */

const pathSearchSchema = z.object({
  view: z.enum(['generate', 'preview', 'summary']).optional(),
  pathVersionId: z.uuid().optional(),
  runId: z.uuid().optional(),
})

function PathScreen() {
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

  if (view === 'summary') {
    return <CompletionPage pathVersionId={pathVersionId} />
  }

  return (
    <PreviewPage
      pathVersionId={pathVersionId}
      onFrozen={(frozenVersionId) =>
        navigate({ search: { view: 'summary', pathVersionId: frozenVersionId } })
      }
    />
  )
}

export const Route = createFileRoute('/path')({
  validateSearch: pathSearchSchema,
  component: PathScreen,
})
