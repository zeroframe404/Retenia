import { fromActivityRow } from '@retenia/activity-schema'
import type {
  Activity,
  Card,
  Clock,
  DiagnosticSession,
  ItemBankEntry,
  JsonObject,
  JsonValue,
  PathTree,
  PathVersion,
  SeededCard,
  UnitOfWork,
} from '@retenia/core'
import type {
  DiagnosticConfidenceDto,
  DiagnosticItemDto,
  DiagnosticModuleResultDto,
  DiagnosticResultDto,
  DiagnosticSectionDto,
  DiagnosticStateDto,
  SelfAssessmentLevelDto,
} from '@retenia/ipc-contract'
import {
  abandonDiagnostic,
  answerItem,
  buildDiagnosticResult,
  buildModuleGraph,
  DIAGNOSTIC_LIMITS,
  type DiagnosticAnswer,
  type DiagnosticConfig,
  type DiagnosticItem,
  type DiagnosticResult,
  type DiagnosticState,
  itemDifficultyAfter,
  knowledgeGraphDocumentSchema,
  type ModuleGraph,
  nextItem,
  type PathDraft,
  pathDraftSchema,
  REOPEN_WINDOW_DAYS,
  readAuthoring,
  remainingEstimate,
  replayDiagnostic,
  SELF_ASSESSMENT_LEVELS,
  type SelfAssessmentLevel,
  shouldReopen,
  stopReason,
} from '@retenia/pathgen'
import { log } from '../logging/log'

/**
 * The prior-knowledge diagnostic in the main process (`docs/spec/04-path-generation.md` §10;
 * sub-phase 8.5) — the I/O around `@retenia/pathgen`'s pure engine:
 *
 * - **Persistence and resume.** A session is its configuration (entry, self-assessment) and
 *   its answer log; every read replays the log through the engine, so closing the app between
 *   two answers loses nothing and a resumed run is the run it was.
 * - **Serving and grading.** Each item shown opens an `attempts` row (`context =
 *   'diagnostic'`). The answer is graded *here*, from the option ids the host reports against
 *   the item's keyed options, never from a verdict the renderer sends.
 * - **The item's Elo half.** `difficulty_logit` moves by the item update and `stats` keeps
 *   `{ n, p_correct }` (`ItemBankItem.v1`).
 * - **The result's actions (§10 step 8).** `mark_completed` sets `completed_at` on the known
 *   module's lessons; `seed_memory` seeds the cards those lessons already have and queues the
 *   ones not written yet (seeded when expansion lands them); `insert_remediation` is recorded
 *   for 8.6. Everything written is kept in `applied`, which is what the one-click undo and the
 *   deferred verification read.
 */

export interface DiagnosticMemory {
  seedKnown(lessonIds: readonly string[]): Promise<SeededCard[]>
  unseed(records: readonly SeededCard[]): Promise<number>
  retrievability(card: Card, at: Date): number
}

export interface DiagnosticServiceDeps {
  readonly repos: UnitOfWork
  /** `null` when the memory service could not start: nothing is seeded, the rest works. */
  readonly memory: DiagnosticMemory | null
  readonly clock: Clock
}

export interface DiagnosticStartInput {
  readonly pathVersionId: string
  readonly entry: 'scratch' | 'partial'
  readonly selfAssessment: Readonly<Record<string, SelfAssessmentLevelDto>>
}

export interface DiagnosticAnswerInput {
  readonly sessionId: string
  readonly attemptId: string
  readonly skipped: boolean
  readonly response?: unknown
  readonly confidence: DiagnosticConfidenceDto | null
  readonly timeMs: number
}

export interface DiagnosticService {
  get(
    pathVersionId: string,
  ): Promise<{ sections: DiagnosticSectionDto[]; state: DiagnosticStateDto | null }>
  start(input: DiagnosticStartInput): Promise<DiagnosticStateDto>
  answer(input: DiagnosticAnswerInput): Promise<DiagnosticStateDto>
  finish(sessionId: string): Promise<DiagnosticStateDto>
  revert(sessionId: string, moduleId?: string): Promise<DiagnosticStateDto>
  /** At freeze: the preview's "ya lo sé" modules get the same seeding (a `preview` session). */
  recordPreviewKnown(pathVersionId: string): Promise<void>
  /** A lesson finished expansion: seed its cards if its module was marked known. */
  onLessonExpanded(pathVersionId: string, lessonId: string): Promise<void>
  /** Startup: seed whatever expansion wrote while the app was closed. */
  sweepPendingSeeds(): Promise<number>
  /** §10 "deferred verification": re-open known modules whose cards say otherwise. */
  verifyKnownModules(now?: Date): Promise<{ reopened: number }>
}

// --- what a session row stores -------------------------------------------------------

interface StoredAnswer extends DiagnosticAnswer {
  readonly attemptId: string
}

interface Pending {
  readonly itemBankId: string
  readonly attemptId: string
  readonly difficulty: number
  readonly servedAt: string
}

interface AppliedModule {
  completedLessonIds: string[]
  seeded: SeededCard[]
  pendingSeedLessonIds: string[]
  revertedAt: string | null
  reopenedAt: string | null
  reopenReason: 'lapses' | 'low_retention' | null
}

interface Remediation {
  readonly moduleId: string
  readonly itemId: string
  readonly conceptIds: readonly string[]
  readonly misconceptionId: string | null
}

interface Applied {
  modules: Record<string, AppliedModule>
  remediations: Remediation[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
const toJson = (value: unknown): JsonObject => value as JsonObject

function readAnswers(raw: readonly JsonValue[]): StoredAnswer[] {
  return raw.flatMap((value): StoredAnswer[] => {
    if (!isRecord(value)) return []
    const itemId = stringOrNull(value.itemId)
    const attemptId = stringOrNull(value.attemptId)
    const { outcome, confidence } = value
    if (itemId === null || attemptId === null) return []
    if (outcome !== 'correct' && outcome !== 'wrong' && outcome !== 'skipped') return []
    return [
      {
        itemId,
        attemptId,
        outcome,
        confidence:
          confidence === 'sure' || confidence === 'unsure' || confidence === 'guessed'
            ? confidence
            : null,
        timeMs: typeof value.timeMs === 'number' ? value.timeMs : 0,
        difficulty: typeof value.difficulty === 'number' ? value.difficulty : 0,
        chosenOptionId: stringOrNull(value.chosenOptionId),
      },
    ]
  })
}

function readPending(raw: JsonObject | null): Pending | null {
  if (raw === null) return null
  const itemBankId = stringOrNull(raw.itemBankId)
  const attemptId = stringOrNull(raw.attemptId)
  if (itemBankId === null || attemptId === null || typeof raw.difficulty !== 'number') return null
  return {
    itemBankId,
    attemptId,
    difficulty: raw.difficulty,
    servedAt: stringOrNull(raw.servedAt) ?? '',
  }
}

function readSeeded(raw: unknown): SeededCard[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((value): SeededCard[] => {
    if (!isRecord(value)) return []
    const cardId = stringOrNull(value.cardId)
    const itemId = stringOrNull(value.itemId)
    const logId = stringOrNull(value.logId)
    const importance = stringOrNull(value.previousImportance)
    const status = stringOrNull(value.previousStatus)
    if (!cardId || !itemId || !logId || !importance || !status) return []
    return [
      {
        cardId,
        itemId,
        logId,
        previousImportance: importance as SeededCard['previousImportance'],
        previousStatus: status as SeededCard['previousStatus'],
      },
    ]
  })
}

function readApplied(raw: JsonObject): Applied {
  const modules: Record<string, AppliedModule> = {}
  if (isRecord(raw.modules)) {
    for (const [moduleId, value] of Object.entries(raw.modules)) {
      if (!isRecord(value)) continue
      const reason = value.reopenReason
      modules[moduleId] = {
        completedLessonIds: strings(value.completedLessonIds),
        seeded: readSeeded(value.seeded),
        pendingSeedLessonIds: strings(value.pendingSeedLessonIds),
        revertedAt: stringOrNull(value.revertedAt),
        reopenedAt: stringOrNull(value.reopenedAt),
        reopenReason: reason === 'lapses' || reason === 'low_retention' ? reason : null,
      }
    }
  }
  const remediations = Array.isArray(raw.remediations)
    ? raw.remediations.flatMap((value): Remediation[] => {
        if (!isRecord(value)) return []
        const moduleId = stringOrNull(value.moduleId)
        const itemId = stringOrNull(value.itemId)
        if (moduleId === null || itemId === null) return []
        return [
          {
            moduleId,
            itemId,
            conceptIds: strings(value.conceptIds),
            misconceptionId: stringOrNull(value.misconceptionId),
          },
        ]
      })
    : []
  return { modules, remediations }
}

function blankModule(): AppliedModule {
  return {
    completedLessonIds: [],
    seeded: [],
    pendingSeedLessonIds: [],
    revertedAt: null,
    reopenedAt: null,
    reopenReason: null,
  }
}

/** The option ids the choice host reports: `{ sets: [{ selected: [...] }] }`. */
function selectedOptionIds(response: unknown): string[] {
  if (!isRecord(response) || !Array.isArray(response.sets)) return []
  const first = response.sets[0]
  return isRecord(first) ? strings(first.selected) : []
}

/** Correct when exactly the keyed options were selected — graded here, not by the renderer. */
export function gradeChoiceResponse(
  activity: Pick<Activity, 'config'>,
  response: unknown,
): { readonly correct: boolean; readonly chosenOptionId: string | null } {
  // Deduplicated: `['a', 'a']` is one selection, never two keyed options.
  const selected = [...new Set(selectedOptionIds(response))]
  const config = activity.config as {
    payload?: { sets?: readonly { options?: readonly { id?: unknown; correct?: unknown }[] }[] }
  }
  const keyed = (config.payload?.sets?.[0]?.options ?? [])
    .filter((option) => option.correct === true)
    .map((option) => option.id)
    .filter((id): id is string => typeof id === 'string')
  const correct =
    keyed.length > 0 &&
    selected.length === keyed.length &&
    selected.every((id) => keyed.includes(id))
  return { correct, chosenOptionId: selected[0] ?? null }
}

type TreeModule = PathTree['sections'][number]['modules'][number]
type TreeSection = PathTree['sections'][number]

interface Context {
  readonly version: PathVersion
  readonly draft: PathDraft
  readonly modules: ReadonlyMap<
    string,
    { readonly module: TreeModule; readonly section: TreeSection }
  >
  readonly graph: ModuleGraph
  readonly selfDeclared: readonly string[]
  readonly entries: ReadonlyMap<string, ItemBankEntry>
  readonly activities: ReadonlyMap<string, Activity>
  readonly items: readonly DiagnosticItem[]
  readonly sections: readonly DiagnosticSectionDto[]
}

export function createDiagnosticService(deps: DiagnosticServiceDeps): DiagnosticService {
  const { repos, memory, clock } = deps

  async function loadContext(pathVersionId: string): Promise<Context> {
    const version = await repos.paths.findVersion(pathVersionId)
    if (version === undefined) throw new Error(`pathgen: no path version "${pathVersionId}"`)
    if (version.frozenAt === null) {
      throw new Error(`pathgen: path version "${pathVersionId}" is not frozen yet`)
    }
    const tree = await repos.paths.loadTree(pathVersionId)
    if (tree === undefined) throw new Error(`pathgen: path version "${pathVersionId}" has no tree`)
    const draft = pathDraftSchema.parse(version.spec)
    const parsedGraph = knowledgeGraphDocumentSchema.safeParse(version.knowledgeGraph ?? {})
    const graphDocument = parsedGraph.success ? parsedGraph.data : { nodes: [], edges: [] }

    const draftModules = new Map(
      draft.sections.flatMap((section) => section.modules.map((module) => [module.id, module])),
    )
    const modules = new Map<string, { module: TreeModule; section: TreeSection }>()
    const sectionsInput = tree.sections.map((section) => ({
      id: section.id,
      modules: section.modules.map((module) => {
        modules.set(module.id, { module, section })
        return { id: module.id, conceptIds: draftModules.get(module.specId)?.concept_ids ?? [] }
      }),
    }))
    const graph = buildModuleGraph({
      sections: sectionsInput,
      concepts: graphDocument.nodes,
      edges: graphDocument.edges,
    })

    const known = new Set(draft.known_node_ids)
    const selfDeclared = [...modules.values()]
      .filter(({ module, section }) => known.has(module.specId) || known.has(section.specId))
      .map(({ module }) => module.id)
    const declared = new Set(selfDeclared)

    const entries = (await repos.itemBank.listByUsage(version.id, 'diagnostic')).filter(
      (entry) => entry.moduleId !== null && modules.has(entry.moduleId),
    )
    const activityRows = await repos.paths.findActivities(entries.map((entry) => entry.activityId))
    const activities = new Map(activityRows.map((activity) => [activity.id, activity]))
    const items = entries.flatMap((entry): DiagnosticItem[] => {
      const activity = activities.get(entry.activityId)
      if (activity === undefined || entry.moduleId === null) return []
      return [
        {
          id: entry.id,
          moduleId: entry.moduleId,
          conceptIds: [...activity.conceptIds],
          difficultyLogit: entry.difficultyLogit,
          bloom: activity.bloom,
          exposure: entry.exposure,
          misconceptionByOption: readAuthoring(entry).misconceptionByOption,
        },
      ]
    })

    return {
      version,
      draft,
      modules,
      graph,
      selfDeclared,
      entries: new Map(entries.map((entry) => [entry.id, entry])),
      activities,
      items,
      sections: tree.sections.map((section) => ({
        id: section.id,
        specId: section.specId,
        title: section.title,
        modules: section.modules.map((module) => ({
          id: module.id,
          specId: module.specId,
          title: module.title,
        })),
        selfDeclared:
          section.modules.length > 0 && section.modules.every((module) => declared.has(module.id)),
      })),
    }
  }

  function configFor(context: Context, session: DiagnosticSession): DiagnosticConfig {
    const selfAssessment: Record<string, SelfAssessmentLevel> = {}
    for (const [sectionId, level] of Object.entries(session.selfAssessment)) {
      if ((SELF_ASSESSMENT_LEVELS as readonly unknown[]).includes(level)) {
        selfAssessment[sectionId] = level as SelfAssessmentLevel
      }
    }
    return {
      graph: context.graph,
      items: context.items,
      entry: session.entry === 'scratch' ? 'scratch' : 'partial',
      selfAssessment,
      selfDeclaredKnown: context.selfDeclared,
    }
  }

  const stateOf = (context: Context, session: DiagnosticSession): DiagnosticState =>
    replayDiagnostic(configFor(context, session), readAnswers(session.answers))

  function itemDto(context: Context, session: DiagnosticSession): DiagnosticItemDto | null {
    if (session.status !== 'in_progress') return null
    const pending = readPending(session.pending)
    if (pending === null) return null
    const entry = context.entries.get(pending.itemBankId)
    const activity = entry === undefined ? undefined : context.activities.get(entry.activityId)
    if (entry === undefined || activity === undefined) return null
    return {
      itemBankId: entry.id,
      attemptId: pending.attemptId,
      activityId: activity.id,
      type: activity.type,
      activity: redactForBlindServe(fromActivityRow(activity) as unknown as JsonObject),
      seed: `${session.id}:${pending.attemptId}`,
    }
  }

  function resultDto(
    context: Context,
    session: DiagnosticSession,
    previewApplied: Applied | null,
  ): DiagnosticResultDto | null {
    if (session.result === null) return null
    const result = session.result as unknown as DiagnosticResult
    const applied = readApplied(session.applied)
    const modules: DiagnosticModuleResultDto[] = []
    for (const entry of result.modules ?? []) {
      const info = context.modules.get(entry.moduleId)
      if (info === undefined) continue
      // A self-declared module's seeding and undo live in the preview session.
      const done =
        applied.modules[entry.moduleId] ??
        (entry.source === 'self_declared' ? previewApplied?.modules[entry.moduleId] : undefined)
      modules.push({
        moduleId: entry.moduleId,
        specId: info.module.specId,
        title: info.module.title,
        sectionTitle: info.section.title,
        status: entry.status,
        source: entry.source,
        theta: entry.theta,
        p: Math.min(1, Math.max(0, entry.p)),
        answered: entry.answered,
        inferred: entry.inferred,
        quickReview: entry.quickReview,
        lessonsCompleted: done?.completedLessonIds.length ?? 0,
        seededCards: done?.seeded.length ?? 0,
        pendingSeedLessons: done?.pendingSeedLessonIds.length ?? 0,
        reverted: done?.revertedAt != null,
        reopened: done?.reopenedAt != null,
        reopenReason: done?.reopenReason ?? null,
      })
    }
    return {
      stopReason: result.stopReason,
      asked: result.asked,
      elapsedMs: Math.round(result.elapsedMs),
      modules,
      remediations: applied.remediations.map((remediation) => ({
        moduleId: remediation.moduleId,
        conceptIds: remediation.conceptIds.slice(0, 16),
        misconceptionId: remediation.misconceptionId,
      })),
    }
  }

  async function stateDto(
    context: Context,
    session: DiagnosticSession,
    state: DiagnosticState | null,
  ): Promise<DiagnosticStateDto> {
    const answers = readAnswers(session.answers)
    const preview =
      session.entry === 'preview' || session.result === null
        ? undefined
        : await previewSessionOf(session.pathVersionId)
    const previewApplied = preview === undefined ? null : readApplied(preview.applied)
    const elapsed = state?.elapsedMs ?? answers.reduce((sum, answer) => sum + answer.timeMs, 0)
    return {
      session: {
        id: session.id,
        pathVersionId: session.pathVersionId,
        status: session.status,
        entry: session.entry,
        startedAt: session.startedAt.toISOString(),
        finishedAt: session.finishedAt === null ? null : session.finishedAt.toISOString(),
        stopReason: session.stopReason,
      },
      progress: {
        asked: answers.length,
        remaining:
          session.status === 'in_progress' && state !== null ? remainingEstimate(state) : 0,
        elapsedMs: Math.round(elapsed),
        maxItems: DIAGNOSTIC_LIMITS.maxItems,
      },
      item: itemDto(context, session),
      result: resultDto(context, session, previewApplied),
    }
  }

  /** The version's preview session — the "ya lo sé" record — when the preview marked any. */
  async function previewSessionOf(pathVersionId: string): Promise<DiagnosticSession | undefined> {
    return (await repos.diagnosticSessions.listByPathVersion(pathVersionId)).find(
      (row) => row.entry === 'preview',
    )
  }

  async function mustSession(id: string): Promise<DiagnosticSession> {
    const session = await repos.diagnosticSessions.findById(id)
    if (session === undefined) throw new Error(`pathgen: no diagnostic session "${id}"`)
    return session
  }

  /** Every never-reviewed card of the module's core lessons; lessons with no cards yet wait. */
  async function seedModule(
    info: { readonly module: TreeModule },
    applied: AppliedModule,
  ): Promise<void> {
    const core = info.module.lessons.filter((lesson) => lesson.kind === 'core')
    if (memory !== null && core.length > 0) {
      applied.seeded.push(...(await memory.seedKnown(core.map((lesson) => lesson.id))))
    }
    const waiting: string[] = []
    for (const lesson of core) {
      if ((await repos.knowledgeItems.listByLesson(lesson.id)).length === 0) waiting.push(lesson.id)
    }
    applied.pendingSeedLessonIds = waiting
  }

  async function applyResult(context: Context, result: DiagnosticResult): Promise<Applied> {
    const applied: Applied = { modules: {}, remediations: [] }
    const now = clock.now()
    const moduleOf = (id: string) => {
      applied.modules[id] ??= blankModule()
      return applied.modules[id] as AppliedModule
    }
    for (const action of result.actions) {
      const info = context.modules.get(action.moduleId)
      if (info === undefined) continue
      if (action.kind === 'mark_completed') {
        const completed: string[] = []
        for (const lesson of info.module.lessons) {
          if (lesson.kind === 'remediation' || lesson.completedAt !== null) continue
          await repos.paths.updateLesson(lesson.id, { completedAt: now })
          completed.push(lesson.id)
        }
        moduleOf(action.moduleId).completedLessonIds = completed
      } else if (action.kind === 'seed_memory') {
        await seedModule(info, moduleOf(action.moduleId))
      } else {
        applied.remediations.push({
          moduleId: action.moduleId,
          itemId: action.itemId,
          conceptIds: [...action.conceptIds],
          misconceptionId: action.misconceptionId,
        })
      }
    }
    return applied
  }

  async function complete(
    context: Context,
    session: DiagnosticSession,
    state: DiagnosticState,
  ): Promise<DiagnosticStateDto> {
    const result = buildDiagnosticResult(state)
    const applied = await applyResult(context, result)
    const now = clock.now()
    const pending = readPending(session.pending)
    // An item on screen when "Terminar ahora" was pressed: its attempt closes unanswered.
    if (pending !== null) await repos.attempts.update(pending.attemptId, { finishedAt: now })
    const saved = await repos.diagnosticSessions.update(session.id, {
      status: 'completed',
      result: toJson(result),
      applied: toJson(applied),
      stopReason: result.stopReason,
      finishedAt: now,
      pending: null,
    })
    log.info(
      `[pathgen] diagnostic ${session.id} finished (${result.stopReason}) after ${result.asked} item(s)`,
    )
    return stateDto(context, saved, state)
  }

  async function serve(
    session: DiagnosticSession,
    item: DiagnosticItem,
    context: Context,
  ): Promise<DiagnosticSession> {
    const entry = context.entries.get(item.id) as ItemBankEntry
    const now = clock.now()
    return repos.transaction(async (tx) => {
      const attempt = await tx.attempts.create({
        activityId: entry.activityId,
        context: 'diagnostic',
        mode: 'test',
        lessonSessionId: null,
        reviewSessionId: null,
        examAttemptId: null,
        cardId: null,
        startedAt: now,
        finishedAt: null,
        score: null,
        correct: null,
        rating: null,
        answer: null,
        feedback: null,
        timeMs: null,
        tries: 1,
        hintsUsed: 0,
        confidence: null,
        aiEvalCallId: null,
      })
      await tx.itemBank.bumpExposure([item.id])
      return tx.diagnosticSessions.update(session.id, {
        pending: {
          itemBankId: item.id,
          attemptId: attempt.id,
          difficulty: item.difficultyLogit,
          servedAt: now.toISOString(),
        },
      })
    })
  }

  async function advance(
    context: Context,
    session: DiagnosticSession,
    state: DiagnosticState,
  ): Promise<DiagnosticStateDto> {
    const item = stopReason(state) === null ? nextItem(state) : null
    if (item === null) return complete(context, session, state)
    return stateDto(context, await serve(session, item, context), state)
  }

  async function seedPending(
    sessions: readonly DiagnosticSession[],
    onlyLessonId?: string,
  ): Promise<number> {
    if (memory === null) return 0
    let seededCards = 0
    for (const session of sessions) {
      if (session.status !== 'completed') continue
      const applied = readApplied(session.applied)
      let changed = false
      for (const module of Object.values(applied.modules)) {
        if (module.revertedAt !== null || module.reopenedAt !== null) continue
        for (const lessonId of [...module.pendingSeedLessonIds]) {
          if (onlyLessonId !== undefined && lessonId !== onlyLessonId) continue
          if ((await repos.knowledgeItems.listByLesson(lessonId)).length === 0) continue
          const seeded = await memory.seedKnown([lessonId])
          module.seeded.push(...seeded)
          module.pendingSeedLessonIds = module.pendingSeedLessonIds.filter((id) => id !== lessonId)
          seededCards += seeded.length
          changed = true
        }
      }
      if (changed) {
        await repos.diagnosticSessions.update(session.id, { applied: toJson(applied) })
      }
    }
    return seededCards
  }

  const service: DiagnosticService = {
    get: async (pathVersionId) => {
      const context = await loadContext(pathVersionId)
      const sessions = await repos.diagnosticSessions.listByPathVersion(pathVersionId)
      const session =
        sessions.find((row) => row.status === 'in_progress') ??
        [...sessions].reverse().find((row) => row.status === 'completed' && row.entry !== 'preview')
      if (session === undefined) return { sections: [...context.sections], state: null }
      const state = stateOf(context, session)
      // An open session with nothing on screen (the app closed between an answer and the
      // next item being served): serve it now, so a resume always shows an item.
      if (session.status === 'in_progress' && readPending(session.pending) === null) {
        return { sections: [...context.sections], state: await advance(context, session, state) }
      }
      return { sections: [...context.sections], state: await stateDto(context, session, state) }
    },

    start: async (input) => {
      const context = await loadContext(input.pathVersionId)
      const sessions = await repos.diagnosticSessions.listByPathVersion(input.pathVersionId)
      const open = sessions.find((row) => row.status === 'in_progress')
      if (open !== undefined) {
        const state = stateOf(context, open)
        return readPending(open.pending) === null
          ? advance(context, open, state)
          : stateDto(context, open, state)
      }
      const done = sessions.find((row) => row.status === 'completed' && row.entry !== 'preview')
      if (done !== undefined) return stateDto(context, done, stateOf(context, done))
      if (input.entry === 'partial' && context.items.length === 0) {
        throw new Error('pathgen: the item bank has no diagnostic items yet')
      }
      const session = await repos.diagnosticSessions.create({
        pathVersionId: input.pathVersionId,
        status: 'in_progress',
        entry: input.entry,
        // Only this version's own sections: anything else is noise the renderer sent.
        selfAssessment: Object.fromEntries(
          Object.entries(input.selfAssessment).filter(([sectionId]) =>
            context.sections.some((section) => section.id === sectionId),
          ),
        ),
        answers: [],
        pending: null,
        result: null,
        applied: toJson({ modules: {}, remediations: [] }),
        stopReason: null,
        startedAt: clock.now(),
        finishedAt: null,
      })
      return advance(context, session, stateOf(context, session))
    },

    answer: async (input) => {
      const session = await mustSession(input.sessionId)
      if (session.status !== 'in_progress') {
        throw new Error(`pathgen: diagnostic "${session.id}" has already finished`)
      }
      const pending = readPending(session.pending)
      if (pending === null || pending.attemptId !== input.attemptId) {
        throw new Error('pathgen: that item is no longer the one on screen')
      }
      const context = await loadContext(session.pathVersionId)
      const entry = context.entries.get(pending.itemBankId)
      const activity = entry === undefined ? undefined : context.activities.get(entry.activityId)
      if (entry === undefined || activity === undefined || entry.moduleId === null) {
        throw new Error(`pathgen: diagnostic item "${pending.itemBankId}" is gone`)
      }

      const state = stateOf(context, session)
      const graded = input.skipped ? null : gradeChoiceResponse(activity, input.response)
      const answer: StoredAnswer = {
        itemId: entry.id,
        attemptId: pending.attemptId,
        outcome: graded === null ? 'skipped' : graded.correct ? 'correct' : 'wrong',
        confidence: graded === null ? null : input.confidence,
        timeMs: input.timeMs,
        difficulty: pending.difficulty,
        chosenOptionId: graded?.chosenOptionId ?? null,
      }
      const thetaBefore = state.estimates.get(entry.moduleId)?.theta ?? 0
      let next: DiagnosticState
      try {
        next = answerItem(state, answer)
      } catch (error) {
        throw new Error(`pathgen: ${error instanceof Error ? error.message : String(error)}`)
      }

      const now = clock.now()
      const updated = await repos.transaction(async (tx) => {
        await tx.attempts.update(pending.attemptId, {
          finishedAt: now,
          correct: graded?.correct ?? null,
          score: graded === null ? null : graded.correct ? 1 : 0,
          // A skip is no answer: nothing the renderer sent with it is kept.
          answer:
            graded === null || input.response === undefined ? null : (input.response as JsonValue),
          confidence: answer.confidence,
          timeMs: input.timeMs,
        })
        if (graded !== null) {
          const stats = entry.stats as { n?: unknown; p_correct?: unknown }
          const n = typeof stats.n === 'number' ? stats.n : 0
          const pCorrect = typeof stats.p_correct === 'number' ? stats.p_correct : 0
          await tx.itemBank.update(entry.id, {
            difficultyLogit: itemDifficultyAfter({
              difficulty: pending.difficulty,
              theta: thetaBefore,
              correct: graded.correct,
              answered: n,
            }),
            stats: {
              ...entry.stats,
              n: n + 1,
              p_correct: (pCorrect * n + (graded.correct ? 1 : 0)) / (n + 1),
            },
          })
        }
        return tx.diagnosticSessions.update(session.id, {
          answers: [...session.answers, toJson(answer)],
          pending: null,
        })
      })
      return advance(context, updated, next)
    },

    finish: async (sessionId) => {
      const session = await mustSession(sessionId)
      const context = await loadContext(session.pathVersionId)
      const state = stateOf(context, session)
      if (session.status !== 'in_progress') return stateDto(context, session, state)
      return complete(context, session, abandonDiagnostic(state))
    },

    revert: async (sessionId, moduleId) => {
      const session = await mustSession(sessionId)
      if (session.status !== 'completed') {
        throw new Error(`pathgen: diagnostic "${sessionId}" has not finished`)
      }
      const now = clock.now().toISOString()
      // The summary shows the preview's "ya lo sé" modules as known too, but their seeding was
      // recorded by the preview session — so the undo reaches that session as well, or
      // "Deshacer" on such a module would change nothing.
      const preview =
        session.entry === 'preview' ? undefined : await previewSessionOf(session.pathVersionId)
      let saved = session
      for (const owner of preview === undefined ? [session] : [session, preview]) {
        const applied = readApplied(owner.applied)
        const targets = moduleId === undefined ? Object.keys(applied.modules) : [moduleId]
        let changed = false
        for (const id of targets) {
          const module = applied.modules[id]
          if (module === undefined || module.revertedAt !== null) continue
          if (memory !== null && module.seeded.length > 0) await memory.unseed(module.seeded)
          for (const lessonId of module.completedLessonIds) {
            await repos.paths.updateLesson(lessonId, { completedAt: null })
          }
          module.revertedAt = now
          module.pendingSeedLessonIds = []
          changed = true
        }
        if (!changed) continue
        const updated = await repos.diagnosticSessions.update(owner.id, {
          applied: toJson(applied),
        })
        if (owner.id === session.id) saved = updated
      }
      const context = await loadContext(session.pathVersionId)
      return stateDto(context, saved, stateOf(context, saved))
    },

    recordPreviewKnown: async (pathVersionId) => {
      const context = await loadContext(pathVersionId)
      if (context.selfDeclared.length === 0) return
      const sessions = await repos.diagnosticSessions.listByPathVersion(pathVersionId)
      if (sessions.some((row) => row.entry === 'preview')) return
      const applied: Applied = { modules: {}, remediations: [] }
      for (const moduleId of context.selfDeclared) {
        const info = context.modules.get(moduleId)
        if (info === undefined) continue
        const module = blankModule()
        // `freezePath` already completed these lessons; recording them is what makes the
        // preview's "ya lo sé" reversible and verifiable like the diagnostic's own.
        module.completedLessonIds = info.module.lessons
          .filter((lesson) => lesson.completedAt !== null)
          .map((lesson) => lesson.id)
        await seedModule(info, module)
        applied.modules[moduleId] = module
      }
      const now = clock.now()
      await repos.diagnosticSessions.create({
        pathVersionId,
        status: 'completed',
        entry: 'preview',
        selfAssessment: {},
        answers: [],
        pending: null,
        result: null,
        applied: toJson(applied),
        stopReason: null,
        startedAt: now,
        finishedAt: now,
      })
    },

    onLessonExpanded: async (pathVersionId, lessonId) => {
      const sessions = await repos.diagnosticSessions.listByPathVersion(pathVersionId)
      await seedPending(sessions, lessonId)
    },

    sweepPendingSeeds: async () =>
      seedPending(await repos.diagnosticSessions.listByStatus('completed')),

    verifyKnownModules: async (now = clock.now()) => {
      if (memory === null) return { reopened: 0 }
      const sessions = await repos.diagnosticSessions.listByStatus('completed')
      if (sessions.length === 0) return { reopened: 0 }
      const since = new Date(now.getTime() - REOPEN_WINDOW_DAYS * 86_400_000)
      const logs = await repos.reviewLogs.listSince(since, now)
      let reopened = 0
      for (const session of sessions) {
        const applied = readApplied(session.applied)
        let changed = false
        for (const [moduleId, module] of Object.entries(applied.modules)) {
          if (module.revertedAt !== null || module.reopenedAt !== null) continue
          const lessons = await repos.paths.listLessons(moduleId)
          const items = (
            await Promise.all(lessons.map((lesson) => repos.knowledgeItems.listByLesson(lesson.id)))
          ).flat()
          if (items.length === 0) continue
          const cards = await repos.cards.listByItems(items.map((item) => item.id))
          const cardIds = new Set(cards.map((card) => card.id))
          const verdict = shouldReopen({
            now,
            logs: logs
              .filter((entry) => cardIds.has(entry.cardId))
              .map((entry) => ({ rating: entry.rating, state: entry.state, review: entry.review })),
            cards: cards.map((card) => ({
              state: card.state,
              retrievability: memory.retrievability(card, now),
            })),
          })
          if (!verdict.reopen) continue
          for (const lessonId of module.completedLessonIds) {
            await repos.paths.updateLesson(lessonId, { completedAt: null })
          }
          // Back to the importance it had — unless the learner has changed it since.
          const restored = new Set<string>()
          for (const record of module.seeded) {
            if (restored.has(record.itemId)) continue
            restored.add(record.itemId)
            const item = items.find((candidate) => candidate.id === record.itemId)
            if (item?.importance === 'maintenance') {
              await repos.knowledgeItems.update(record.itemId, {
                importance: record.previousImportance,
              })
            }
          }
          module.reopenedAt = now.toISOString()
          module.reopenReason = verdict.reason
          changed = true
          reopened += 1
        }
        if (changed) {
          await repos.diagnosticSessions.update(session.id, { applied: toJson(applied) })
        }
      }
      return { reopened }
    },
  }

  /**
   * One diagnostic operation at a time. Every one of them reads a session, awaits the
   * database and the memory service, and writes the whole `answers` log or `applied` record
   * back — so two interleaved (a "Terminar ahora" while an answer is in flight, a duplicate
   * answer, the background seeding racing an undo) would lose one of the writes, and with it
   * the record the undo and the deferred verification rely on. A single queue is enough: the
   * operations are short and there is one learner. None of them calls another through this
   * wrapper, so the queue cannot deadlock on itself.
   */
  const exclusive = serialQueue()
  const locked =
    <A extends unknown[], R>(operation: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> =>
      exclusive(() => operation(...args))
  return {
    get: locked(service.get),
    start: locked(service.start),
    answer: locked(service.answer),
    finish: locked(service.finish),
    revert: locked(service.revert),
    recordPreviewKnown: locked(service.recordPreviewKnown),
    onLessonExpanded: locked(service.onLessonExpanded),
    sweepPendingSeeds: locked(service.sweepPendingSeeds),
    verifyKnownModules: locked(service.verifyKnownModules),
  }
}

function serialQueue(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return (work) => {
    const next = tail.then(work, work)
    tail = next.catch(() => undefined)
    return next
  }
}

/**
 * The envelope as the blind diagnostic may show it: every option unkeyed, and no feedback,
 * hints or explanation. The host renders and collects a choice without them, main grades the
 * answer against the stored row, and a renderer that never held the key cannot answer from it.
 */
export function redactForBlindServe(envelope: JsonObject): JsonObject {
  const {
    explanation: _explanation,
    hints: _hints,
    ...rest
  } = envelope as JsonObject & {
    explanation?: unknown
    hints?: unknown
  }
  const payload = rest.payload as { sets?: unknown } | undefined
  if (payload === undefined || !Array.isArray(payload.sets)) return rest as JsonObject
  return {
    ...rest,
    payload: {
      ...payload,
      sets: payload.sets.map((set) => {
        if (!isRecord(set) || !Array.isArray(set.options)) return set
        return {
          ...set,
          options: set.options.map((option) => {
            if (!isRecord(option)) return option
            const { feedback: _feedback, ...kept } = option
            return { ...kept, correct: false }
          }),
        }
      }),
    },
  } as JsonObject
}
