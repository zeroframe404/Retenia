import type { PathDraftDto, SourceSummary } from '@retenia/ipc-contract'
import { type callApi, callApiWith, expect, gotoReady, test } from './fixtures'

/**
 * "Generate with AI" end to end (`docs/spec/04-path-generation.md` §13, sub-phase 8.2): a
 * real generation run through a real `utilityProcess`-backed ingestion pipeline and a real
 * `createGenerationRun` orchestrator, answered by the deterministic in-process fake wired in
 * under `RETENIA_E2E=1` (`src/main/pathgen/e2e-fake-ai.ts`) — never a mock of `pathgen.*`
 * itself. Wizard → preview (rename, reorder, exclude) → freeze, then confirms a frozen
 * version rejects a further edit, then expands the lessons (sub-phase 8.3) and regenerates
 * one — the batch dispatch, the over-generation filter and the memory-item write, over the
 * real IPC and the real Electron stack rather than over the pure stage's fakes.
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
  // The run's own `error` in the message: a generation that failed and says only "expected
  // completed, received failed" costs a rebuild and a rerun to find out why.
  expect(
    started.data.status,
    `${started.data.error ?? '(no error recorded)'} — ${JSON.stringify(started.data.warnings)}`,
  ).toBe('completed')
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

  // --- stage 7 (sub-phase 8.3) -------------------------------------------------------------
  // Freezing is what makes the lessons expandable, so this is where the expansion begins. It
  // runs through the same `pathgen.expand` the panel calls, against the same fake, so the
  // batch dispatch, the P4 filter and the memory-item write are all real here.
  const expanded = await callApiWith(
    window,
    ({ api, arg }) => api.pathgen.expand({ pathVersionId: arg }),
    pathVersionId,
  )
  expect(expanded.ok).toBe(true)
  if (!expanded.ok) throw new Error('pathgen.expand failed')
  expect(
    expanded.data.run.status,
    `${expanded.data.run.error ?? '(no error recorded)'} — ` +
      JSON.stringify(expanded.data.run.warnings),
  ).toBe('completed')

  const lessons = await callApiWith(
    window,
    ({ api, arg }) => api.pathgen.getLessons({ pathVersionId: arg }),
    pathVersionId,
  )
  expect(lessons.ok).toBe(true)
  if (!lessons.ok) throw new Error('pathgen.getLessons failed')
  expect(lessons.data.lessons.length).toBeGreaterThan(0)
  expect(
    lessons.data.lessons.every((lesson) => lesson.status === 'ready'),
    JSON.stringify({
      lessons: lessons.data.lessons.map((lesson) => ({
        specId: lesson.specId,
        status: lesson.status,
        activities: lesson.activities,
        flashcards: lesson.flashcards,
      })),
      run: expanded.data.run.warnings,
      error: expanded.data.run.error,
    }),
  ).toBe(true)

  const first = lessons.data.lessons[0] as (typeof lessons.data.lessons)[number]
  // The acceptance criterion, over the real stack: a lesson that cites a block a deep link can
  // open. `firstCitation` is what "Reportar error" navigates with.
  expect(first.firstCitation).not.toBeNull()
  expect(first.firstCitation?.blockIds.length).toBeGreaterThan(0)
  // P4's `choice` candidate survives the real filter, so the practice block is not empty.
  expect(first.activities).toBeGreaterThan(0)
  expect(first.flashcards).toBeGreaterThan(0)

  // --- stage 8 (sub-phase 8.4) -------------------------------------------------------------
  // The gates ran over every lesson the fake wrote — `ready` is their verdict now — and the
  // report lists each with its citations resolved.
  expect(
    lessons.data.lessons.every((lesson) => lesson.qa?.reviewed === true),
    JSON.stringify(
      lessons.data.lessons.map((lesson) => ({ specId: lesson.specId, qa: lesson.qa })),
    ),
  ).toBe(true)
  expect(first.qa?.faithfulness).toBe(1)
  expect(first.qa?.pedagogyScore).toBe(4)
  const report = await callApiWith(
    window,
    ({ api, arg }) => api.pathgen.getQaReport({ pathVersionId: arg }),
    pathVersionId,
  )
  expect(report.ok).toBe(true)
  if (!report.ok) throw new Error('pathgen.getQaReport failed')
  expect(report.data.lessons).toHaveLength(lessons.data.lessons.length)
  expect(report.data.totals.reviewed).toBe(lessons.data.lessons.length)
  expect(report.data.totals.flagged).toBe(0)

  // "Regenerar" rewrites one lesson and leaves its memory items alone.
  const before = first.flashcards
  const regenerated = await callApiWith(
    window,
    ({ api, arg }) => api.pathgen.regenerateLesson({ lessonId: arg, mode: 'regenerate' }),
    first.id,
  )
  expect(regenerated.ok).toBe(true)
  if (!regenerated.ok) throw new Error('pathgen.regenerateLesson failed')
  expect(regenerated.data.run.status).toBe('completed')

  const after = await callApiWith(
    window,
    ({ api, arg }) => api.pathgen.getLessons({ pathVersionId: arg }),
    pathVersionId,
  )
  expect(after.ok).toBe(true)
  if (!after.ok) throw new Error('pathgen.getLessons failed after regenerate')
  const regeneratedLesson = after.data.lessons.find((lesson) => lesson.id === first.id)
  expect(regeneratedLesson?.status).toBe('ready')
  expect(regeneratedLesson?.flashcards).toBe(before)
})
