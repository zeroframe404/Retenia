import path from 'node:path'
import type { DiagnosticStateDto, PathDraftDto, SourceSummary } from '@retenia/ipc-contract'
import Database from 'better-sqlite3'
import { type callApi, callApiWith, expect, gotoReady, test } from './fixtures'

/**
 * Stage 9 and the prior-knowledge diagnostic end to end (`docs/spec/04-path-generation.md`
 * §3 stage 9, §10; sub-phase 8.5), over the real IPC, the real main-process services and the
 * real SQLite file, answered by the deterministic fake of `src/main/pathgen/e2e-fake-ai.ts`.
 *
 * The acceptance lines this proves on the real stack:
 * - the item bank is built from the frozen version and serves the diagnostic;
 * - the diagnostic never asks more than 30 items;
 * - a module marked known has its cards seeded with **exactly one** review log whose
 *   `context` is `diagnostic`, and the one-click undo takes those logs back.
 *
 * The seeding is driven through the preview's "ya lo sé" — the same `seed_memory` path the
 * diagnostic's own known modules take — because it is deterministic: which modules a
 * synthetic run classifies known depends on the fake's items, and a test that passes only
 * when a classifier happens to agree would prove nothing.
 */

test.setTimeout(120_000)

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
    { text: SOURCE_TEXT, title: 'Cinemática (e2e diagnóstico)' },
  )
  expect(added.ok).toBe(true)
  if (!added.ok) throw new Error('addSourceFromText failed')
  await expect
    .poll(
      async () => {
        const result = await callApiWith(
          page,
          ({ api, arg }) => api.library.getSource({ id: arg }),
          added.data.id,
        )
        return result.ok ? result.data.source?.status : undefined
      },
      { timeout: 20_000 },
    )
    .toBe('ready')
  return added.data
}

interface DiagnosticLogRow {
  readonly cardId: string
  readonly logs: number
  readonly state: number
}

test('builds the item bank, runs the diagnostic and seeds known modules once', async ({
  window,
  electronApp,
}) => {
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
  expect(started.data.status, started.data.error ?? '').toBe('completed')
  const pathVersionId = started.data.pathVersionId as string
  const draft = started.data.draft as PathDraftDto
  const firstModule = draft.sections[0]?.modules[0]
  expect(firstModule).toBeDefined()

  // "Ya lo sé" on the first module, in the preview: freezing completes its lessons and 8.5
  // seeds its cards once they exist.
  const marked = await callApiWith(
    window,
    ({ api, arg }) =>
      api.pathgen.editDraft({
        pathVersionId: arg.pathVersionId,
        op: { kind: 'markKnown', nodeId: arg.moduleId },
      }),
    { pathVersionId, moduleId: (firstModule as { id: string }).id },
  )
  expect(marked.ok).toBe(true)

  const frozen = await callApiWith(
    window,
    ({ api, arg }) => api.pathgen.freeze({ pathVersionId: arg }),
    pathVersionId,
  )
  expect(frozen.ok).toBe(true)

  const expanded = await callApiWith(
    window,
    ({ api, arg }) => api.pathgen.expand({ pathVersionId: arg }),
    pathVersionId,
  )
  expect(expanded.ok).toBe(true)
  if (!expanded.ok) throw new Error('pathgen.expand failed')
  expect(expanded.data.run.status, expanded.data.run.error ?? '').toBe('completed')

  // --- the item bank (stage 9) --------------------------------------------------------------
  await expect
    .poll(
      async () => {
        const bank = await callApiWith(
          window,
          ({ api, arg }) => api.pathgen.getItemBank({ pathVersionId: arg }),
          pathVersionId,
        )
        return bank.ok && bank.data.diagnosticItems > 0 ? bank.data.state : 'waiting'
      },
      { timeout: 30_000 },
    )
    .toMatch(/^(ready|partial)$/)

  // --- the seeding of the known module, checked in the database ------------------------------
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const readDiagnosticLogs = (): DiagnosticLogRow[] => {
    const db = new Database(path.join(userDataDir, 'retenia.db'), { readonly: true })
    try {
      return db
        .prepare(
          `SELECT l.card_id AS cardId, COUNT(*) AS logs, c.state AS state
             FROM review_logs l JOIN cards c ON c.id = l.card_id
            WHERE l.context = 'diagnostic' AND l.deleted_at IS NULL
            GROUP BY l.card_id, c.state`,
        )
        .all() as DiagnosticLogRow[]
    } finally {
      db.close()
    }
  }
  // Seeded when the module's lessons land (a fire-and-forget hook), so it is polled for.
  await expect.poll(() => readDiagnosticLogs().length, { timeout: 20_000 }).toBeGreaterThan(0)
  const seeded = readDiagnosticLogs()
  // The acceptance line: exactly one `diagnostic` log per seeded card, and the card graduated
  // straight to Review (state 2) rather than parked in a learning step.
  expect(seeded.every((row) => row.logs === 1)).toBe(true)
  expect(seeded.every((row) => row.state === 2)).toBe(true)

  // --- the diagnostic itself -------------------------------------------------------------
  const opened = await callApiWith(
    window,
    ({ api, arg }) => api.pathgen.diagnosticGet({ pathVersionId: arg }),
    pathVersionId,
  )
  expect(opened.ok).toBe(true)
  if (!opened.ok) throw new Error('pathgen.diagnosticGet failed')
  const selfAssessment = Object.fromEntries(
    opened.data.sections.map((section) => [section.id, 'know' as const]),
  )

  const first = await callApiWith(
    window,
    ({ api, arg }) =>
      api.pathgen.diagnosticStart({
        pathVersionId: arg.pathVersionId,
        entry: 'partial',
        selfAssessment: arg.selfAssessment,
      }),
    { pathVersionId, selfAssessment },
  )
  expect(first.ok).toBe(true)
  if (!first.ok) throw new Error('pathgen.diagnosticStart failed')

  let state: DiagnosticStateDto = first.data
  let answered = 0
  while (state.item !== null) {
    expect(answered).toBeLessThan(30)
    // The fake keys option "a"; main grades it from the response, not from a verdict.
    const next = await callApiWith(
      window,
      ({ api, arg }) =>
        api.pathgen.diagnosticAnswer({
          sessionId: arg.sessionId,
          attemptId: arg.attemptId,
          skipped: false,
          response: { sets: [{ selected: ['a'] }] },
          confidence: 'sure',
          timeMs: 20_000,
        }),
      { sessionId: state.session.id, attemptId: state.item.attemptId },
    )
    expect(next.ok).toBe(true)
    if (!next.ok) throw new Error('pathgen.diagnosticAnswer failed')
    state = next.data
    answered += 1
  }

  expect(state.session.status).toBe('completed')
  expect(state.result).not.toBeNull()
  expect(state.progress.asked).toBeLessThanOrEqual(30)
  // The module the preview marked known is the preview's, never asked again.
  const declared = state.result?.modules.find(
    (module) => module.specId === (firstModule as { id: string }).id,
  )
  if (declared !== undefined) expect(declared.source).toBe('self_declared')

  // Seeding stays exactly once per card however the diagnostic went.
  expect(readDiagnosticLogs().every((row) => row.logs === 1)).toBe(true)

  // --- the one-click undo --------------------------------------------------------------
  const reverted = await callApiWith(
    window,
    ({ api, arg }) => api.pathgen.diagnosticRevert({ sessionId: arg }),
    state.session.id,
  )
  expect(reverted.ok).toBe(true)
  if (reverted.ok) {
    // "Deshacer todo" from the summary reaches the preview's "ya lo sé" module too: its
    // seeding lived in the preview session, and the undo must take it back all the same.
    expect(readDiagnosticLogs()).toEqual([])
    expect(
      reverted.data.result?.modules.every((module) => module.status !== 'known' || module.reverted),
    ).toBe(true)
  }
})
