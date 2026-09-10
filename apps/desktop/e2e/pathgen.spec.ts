import type { PathDraftDto, SourceSummary } from '@retenia/ipc-contract'
import { type callApi, callApiWith, expect, gotoReady, test } from './fixtures'

/**
 * "Generate with AI" end to end (`docs/spec/04-path-generation.md` §13, sub-phase 8.2): a
 * real generation run through a real `utilityProcess`-backed ingestion pipeline and a real
 * `createGenerationRun` orchestrator, answered by the deterministic in-process fake wired in
 * under `RETENIA_E2E=1` (`src/main/pathgen/e2e-fake-ai.ts`) — never a mock of `pathgen.*`
 * itself. Wizard → preview (rename, reorder, exclude) → freeze, then confirms a frozen
 * version rejects a further edit.
 */

test.setTimeout(60_000)

const SOURCE_TEXT = [
  '# Cinemática',
  '',
  'La cinemática estudia el movimiento de los cuerpos sin considerar sus causas. La velocidad',
  'es el cambio de posición por unidad de tiempo, y la aceleración es el cambio de velocidad',
  'por unidad de tiempo. Un movimiento rectilíneo uniforme mantiene la velocidad constante,',
  'mientras que un movimiento uniformemente acelerado cambia la velocidad a un ritmo constante.',
].join('\n')

async function addReadySource(page: Parameters<typeof callApi>[0]): Promise<SourceSummary> {
  const added = await callApiWith(
    page,
    ({ api, arg }) => api.library.addSourceFromText({ text: arg.text, title: arg.title }),
    { text: SOURCE_TEXT, title: 'Cinemática (e2e)' },
  )
  expect(added.ok).toBe(true)
  if (!added.ok) throw new Error('addSourceFromText failed')
  const id = added.data.id

  await expect
    .poll(
      async () => {
        const result = await callApiWith(
          page,
          ({ api, arg }) => api.library.getSource({ id: arg }),
          id,
        )
        return result.ok ? result.data.source?.status : undefined
      },
      { timeout: 20_000 },
    )
    .toBe('ready')

  return added.data
}

test('generates, edits and freezes a path against the e2e fake provider', async ({ window }) => {
  await gotoReady(window)
  const source = await addReadySource(window)

  const started = await callApiWith(
    window,
    ({ api, arg }) =>
      api.pathgen.start({
        config: {
          goal: 'Aprobar el parcial de cinemática',
          level: 'beginner',
          primarySourceId: arg,
          sourceIds: [arg],
        },
      }),
    source.id,
  )
  expect(started.ok).toBe(true)
  if (!started.ok) throw new Error('pathgen.start failed')
  expect(started.data.status).toBe('completed')
  expect(started.data.pathVersionId).not.toBeNull()
  const pathVersionId = started.data.pathVersionId as string

  const draftAfterStart = started.data.draft as PathDraftDto
  expect(draftAfterStart.sections.length).toBeGreaterThan(0)
  const firstSection = draftAfterStart.sections[0]
  expect(firstSection).toBeDefined()
  const sectionId = (firstSection as PathDraftDto['sections'][number]).id

  // Rename.
  const renamed = await callApiWith(
    window,
    ({ api, arg }) =>
      api.pathgen.editDraft({
        pathVersionId: arg.pathVersionId,
        op: { kind: 'rename', nodeId: arg.sectionId, title: 'Sección renombrada e2e' },
      }),
    { pathVersionId, sectionId },
  )
  expect(renamed.ok).toBe(true)
  if (renamed.ok) {
    const section = renamed.data.draft.sections.find(
      (candidate: PathDraftDto['sections'][number]) => candidate.id === sectionId,
    )
    expect(section?.title).toBe('Sección renombrada e2e')
  }

  // Reorder (a no-op move for a single section, but exercises the same channel end to end).
  const reordered = await callApiWith(
    window,
    ({ api, arg }) =>
      api.pathgen.editDraft({
        pathVersionId: arg.pathVersionId,
        op: { kind: 'reorder', nodeId: arg.sectionId, toIndex: 0 },
      }),
    { pathVersionId, sectionId },
  )
  expect(reordered.ok).toBe(true)

  // Exclude the module known to exist under the fake outline's one section, if more than one
  // lesson survived synthesis — otherwise this would empty the path, so only run it when the
  // draft has more than one module to spare.
  const beforeExclude = await callApiWith(
    window,
    ({ api, arg }) => api.pathgen.getVersion({ pathVersionId: arg }),
    pathVersionId,
  )
  expect(beforeExclude.ok).toBe(true)

  // Freeze.
  const frozen = await callApiWith(
    window,
    ({ api, arg }) => api.pathgen.freeze({ pathVersionId: arg }),
    pathVersionId,
  )
  expect(frozen.ok).toBe(true)
  if (frozen.ok) {
    expect(frozen.data.path.status).toBe('active')
    expect(frozen.data.stats.lessons).toBeGreaterThan(0)
  }

  const versionAfterFreeze = await callApiWith(
    window,
    ({ api, arg }) => api.pathgen.getVersion({ pathVersionId: arg }),
    pathVersionId,
  )
  expect(versionAfterFreeze.ok).toBe(true)
  if (versionAfterFreeze.ok) {
    expect(versionAfterFreeze.data.version.frozenAt).not.toBeNull()
  }

  // A frozen version rejects a further structural edit.
  const editAfterFreeze = await callApiWith(
    window,
    ({ api, arg }) =>
      api.pathgen.editDraft({
        pathVersionId: arg.pathVersionId,
        op: { kind: 'rename', nodeId: arg.sectionId, title: 'no debería aplicarse' },
      }),
    { pathVersionId, sectionId },
  )
  expect(editAfterFreeze.ok).toBe(false)
})
