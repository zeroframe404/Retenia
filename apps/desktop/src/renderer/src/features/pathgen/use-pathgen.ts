import type {
  Contract,
  DiagnosticStateDto,
  GenerationConfigInputDto,
  InferOutput,
  ItemBankStatusDto,
  LessonSummaryDto,
  PathEditOpDto,
} from '@retenia/ipc-contract'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useIpcEvent, useIpcMutation, useIpcQuery } from '../../ipc/hooks'

/**
 * "Generate with AI" (sub-phase 8.2, `docs/spec/04-path-generation.md` §13 steps 1–3 and 6):
 * the wizard's live estimate and run lifecycle, the editable preview's draft, and freezing a
 * version.
 */

export function useQuote() {
  return useIpcMutation('pathgen.quote')
}

export function useStartGeneration() {
  return useIpcMutation('pathgen.start')
}

export function useResumeGeneration() {
  return useIpcMutation('pathgen.resume')
}

export function useCancelGeneration() {
  return useIpcMutation('pathgen.cancel')
}

export function useGenerationRun(runId: string | undefined) {
  return useIpcQuery('pathgen.getRun', { runId: runId ?? '' }, { enabled: runId !== undefined })
}

/** Live stage/progress for one run, updated by `pathgen.progress` pushes and seeded from
 *  `pathgen.getRun` so reopening the app mid-run still shows the last known stage. */
export function useGenerationProgress(runId: string | undefined) {
  const run = useGenerationRun(runId)
  const [live, setLive] = useState<{ stage: string; done: number; total: number } | null>(null)

  useIpcEvent(
    'pathgen.progress',
    useCallback(
      (event) => {
        if (event.runId !== runId) return
        setLive({ stage: event.stage, done: event.done, total: event.total })
      },
      [runId],
    ),
  )

  if (live !== null) return live
  const progress = run.data?.run?.progress
  return progress ? { stage: progress.stage, done: progress.done, total: progress.total } : null
}

const VERSION_KEY = (pathVersionId: string) => ['pathgen.getVersion', { pathVersionId }]

export function usePathVersion(pathVersionId: string | undefined) {
  return useIpcQuery(
    'pathgen.getVersion',
    { pathVersionId: pathVersionId ?? '' },
    { enabled: pathVersionId !== undefined },
  )
}

export function useEditDraft(pathVersionId: string) {
  const client = useQueryClient()
  return useIpcMutation('pathgen.editDraft', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: VERSION_KEY(pathVersionId) })
    },
  })
}

export function useFreeze() {
  const client = useQueryClient()
  return useIpcMutation('pathgen.freeze', {
    onSuccess: (_data, { pathVersionId }) => {
      void client.invalidateQueries({ queryKey: VERSION_KEY(pathVersionId) })
    },
  })
}

export type { GenerationConfigInputDto, LessonSummaryDto, PathEditOpDto }

const LESSONS_KEY = (pathVersionId: string) => ['pathgen.getLessons', { pathVersionId }]

/**
 * Stage 7's panel (sub-phase 8.3, §13 step 5): the lessons of a frozen version, seeded by a
 * query and kept live by `pathgen.lessonStatus`.
 *
 * The same seed-then-overlay shape as `useGenerationProgress`, and for the same reason: the
 * list has to be right after a reload, when no push has arrived yet, and a panel that
 * refetched the whole tree on every tick would be unusable for a forty-lesson path.
 */
export function useLessons(pathVersionId: string | undefined) {
  const client = useQueryClient()
  const query = useIpcQuery(
    'pathgen.getLessons',
    { pathVersionId: pathVersionId ?? '' },
    { enabled: pathVersionId !== undefined },
  )

  useIpcEvent(
    'pathgen.lessonStatus',
    useCallback(
      (event) => {
        if (pathVersionId === undefined || event.pathVersionId !== pathVersionId) return
        client.setQueryData(
          LESSONS_KEY(pathVersionId),
          (previous: { lessons: LessonSummaryDto[] } | undefined) =>
            previous === undefined
              ? previous
              : {
                  lessons: previous.lessons.map((lesson) =>
                    lesson.id === event.lessonId
                      ? {
                          ...lesson,
                          status: event.status,
                          activities: event.activities,
                          flashcards: event.flashcards,
                          // The verdict rides on the push that moves the row to `ready` (8.4).
                          qa: event.qa ?? lesson.qa,
                        }
                      : lesson,
                  ),
                },
        )
      },
      [client, pathVersionId],
    ),
  )

  return query
}

export function useExpand(pathVersionId: string) {
  const client = useQueryClient()
  return useIpcMutation('pathgen.expand', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: LESSONS_KEY(pathVersionId) })
    },
  })
}

/** Stage 8's report (sub-phase 8.4): read once per visit; the panel's pushes do not feed it. */
export function useQaReport(pathVersionId: string | undefined) {
  return useIpcQuery(
    'pathgen.getQaReport',
    { pathVersionId: pathVersionId ?? '' },
    { enabled: pathVersionId !== undefined },
  )
}

export function useRegenerateLesson(pathVersionId: string) {
  const client = useQueryClient()
  return useIpcMutation('pathgen.regenerateLesson', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: LESSONS_KEY(pathVersionId) })
    },
  })
}

// --- stage 9 and the prior-knowledge diagnostic (sub-phase 8.5) ------------------------------

/** How often the diagnostic screen re-reads a bank that is still being built. */
export const ITEM_BANK_POLL_MS = 2_000

const ITEM_BANK_KEY = (pathVersionId: string) => ['pathgen.getItemBank', { pathVersionId }]
const DIAGNOSTIC_KEY = (pathVersionId: string) => ['pathgen.diagnosticGet', { pathVersionId }]

export type DiagnosticReadDto = InferOutput<Contract, 'pathgen.diagnosticGet'>

/** A bank still on its way: the freeze started it (`empty` is the instant before it does). */
export function isItemBankPending(bank: Pick<ItemBankStatusDto, 'state'>): boolean {
  return bank.state === 'empty' || bank.state === 'building'
}

/**
 * The item bank of a frozen version, re-read every {@link ITEM_BANK_POLL_MS} for as long as it is
 * still building and left alone once it settles — `ready`, `partial` or `failed` do not move on
 * their own, and a build is re-started only by `useBuildItemBank`.
 */
export function useItemBank(
  pathVersionId: string | undefined,
  options: { enabled?: boolean } = {},
) {
  return useIpcQuery(
    'pathgen.getItemBank',
    { pathVersionId: pathVersionId ?? '' },
    {
      enabled: pathVersionId !== undefined && (options.enabled ?? true),
      refetchInterval: (query) => {
        const bank = query.state.data
        return bank === undefined || isItemBankPending(bank) ? ITEM_BANK_POLL_MS : false
      },
    },
  )
}

/** "Volver a intentar" on a failed bank. Answers at once with `building`; the poll does the rest. */
export function useBuildItemBank(pathVersionId: string) {
  const client = useQueryClient()
  return useIpcMutation('pathgen.buildItemBank', {
    onSuccess: (bank) => {
      client.setQueryData(ITEM_BANK_KEY(pathVersionId), bank)
      void client.invalidateQueries({ queryKey: DIAGNOSTIC_KEY(pathVersionId) })
    },
  })
}

/** The diagnostic screen's first read: sections, the session to resume, the bank. */
export function useDiagnostic(pathVersionId: string | undefined) {
  return useIpcQuery(
    'pathgen.diagnosticGet',
    { pathVersionId: pathVersionId ?? '' },
    { enabled: pathVersionId !== undefined },
  )
}

/**
 * Every diagnostic write answers with the session's next state. That state goes straight into
 * the `diagnosticGet` cache — the next item has to be on screen the moment main serves it, not
 * one refetch later — and the query is then invalidated like every other pathgen mutation, so
 * main stays the source of truth. The in-flight read is cancelled first so a slower answer to
 * an older read cannot land on top of the newer state.
 */
function useWriteDiagnosticState(pathVersionId: string) {
  const client = useQueryClient()
  return useCallback(
    async (state: DiagnosticStateDto) => {
      const queryKey = DIAGNOSTIC_KEY(pathVersionId)
      await client.cancelQueries({ queryKey })
      client.setQueryData(queryKey, (previous: DiagnosticReadDto | undefined) =>
        previous === undefined ? previous : { ...previous, state },
      )
      void client.invalidateQueries({ queryKey })
    },
    [client, pathVersionId],
  )
}

export function useDiagnosticStart(pathVersionId: string) {
  const write = useWriteDiagnosticState(pathVersionId)
  return useIpcMutation('pathgen.diagnosticStart', { onSuccess: (state) => write(state) })
}

export function useDiagnosticAnswer(pathVersionId: string) {
  const write = useWriteDiagnosticState(pathVersionId)
  return useIpcMutation('pathgen.diagnosticAnswer', { onSuccess: (state) => write(state) })
}

export function useDiagnosticFinish(pathVersionId: string) {
  const write = useWriteDiagnosticState(pathVersionId)
  return useIpcMutation('pathgen.diagnosticFinish', { onSuccess: (state) => write(state) })
}

export function useDiagnosticRevert(pathVersionId: string) {
  const write = useWriteDiagnosticState(pathVersionId)
  return useIpcMutation('pathgen.diagnosticRevert', { onSuccess: (state) => write(state) })
}
