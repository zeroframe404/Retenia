import { writeFile } from 'node:fs/promises'
import { is } from '@electron-toolkit/utils'
import type { PricingOverlay } from '@retenia/ai'
import { mergePricingOverlay, resolveRates, SHIPPED_PRICING, unknownOverlayKeys } from '@retenia/ai'
import { probeProvider } from '@retenia/ai/providers'
import type {
  AiCallRepository,
  Annotation,
  BlobStore,
  Card,
  Chunk,
  ChunkSearchHit,
  Forecast,
  ImportanceLevel,
  JsonObject,
  JsonValue,
  KnowledgeItem,
  OptimizerStatus,
  RescheduleImpact,
  RescheduleSelection,
  RoleAssignmentValue,
  SchedulerProfile,
  SchedulingPreview,
  SecretName,
  SecretStore,
  SessionEntry,
  SessionPlan,
  SessionRunnerState,
  SessionSummary,
  SettingsKey,
  SettingsRepository,
  Source,
  StatsOverview,
  TrueRetention,
  UrgentModeHours,
} from '@retenia/core'
import { GRADES, parseSourceLocator, SETTINGS } from '@retenia/core'
import type {
  AnnotationAnchor,
  AnnotationDto,
  ChunkSummary,
  Contract,
  ReadingLocator,
  RecentSource,
  SearchHit,
  SourceSummary,
} from '@retenia/ipc-contract'
import { PROVIDER_ROLE_VALUES } from '@retenia/ipc-contract'
import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import type { BatchesFacade } from '../ai/batch'
import { buildRegistry } from '../ai/client'
import type { BackupService } from '../backups/service'
import { ensureDevMediaSample } from '../dev/media-sample'
import { collectSystemInfo, exportDiagnostics } from '../diagnostics/export'
import type { JobsFacade } from '../jobs/facade'
import { IMPORTABLE_EXTENSIONS } from '../library/detect-kind'
import type { EmbeddingService } from '../library/embedding-service'
import type { LibraryService } from '../library/service'
import { log } from '../logging/log'
import type { ServedActivity } from '../memory/activity-service'
import type { MemoryService } from '../memory/service'
import { getDevMediaSamplePath, getLogsDir } from '../paths'
import { maskSecret } from '../secrets/store'
import type { SettingsStore } from '../settings/store'
import type { Updater } from '../updates/updater'
import type { Handlers } from './register-handlers'

/** What a subsystem that depends on the database looks like once it failed to open — every
 *  handler in its domain reports why instead of pretending to work (same pattern as
 *  `../jobs/bootstrap.ts`'s `unavailableFacade`). */
function unavailable(domain: string, reason: string): never {
  throw new Error(`${domain} is unavailable: the database did not open (${reason})`)
}

/** `ProviderProfile` carries no display label — `docs/spec/08-ux.md` §1's provider cards
 *  are Anthropic, Google and, once configured, Ollama/LM Studio; the other cards the spec
 *  lists (OpenAI, OpenRouter, Azure Speech, ElevenLabs) are not `packages/ai` profiles yet
 *  and are rendered as static placeholders by the renderer, not by this list. */
function providerLabel(profile: { id: string; kind: string; local?: boolean }): string {
  if (profile.local === true) return 'Ollama / LM Studio'
  if (profile.kind === 'anthropic') return 'Anthropic'
  if (profile.kind === 'google') return 'Google'
  return profile.id
}

/**
 * One field of a CSV row, quoted only when it needs to be.
 *
 * The quote character is spelled `\x22` rather than written literally: a source-level `"`
 * inside a regex or string on this line reads, to `esm-main-globals.test.ts`'s naive
 * comment/string stripper (it does not parse regex literals), as an unterminated string —
 * which then swallows everything up to the next stray `"` anywhere later in the file.
 */
function csvField(value: string | number): string {
  const text = String(value)
  const quote = '\x22'
  if (!text.includes(quote) && !text.includes(',') && !text.includes('\n')) return text
  return quote + text.split(quote).join(quote + quote) + quote
}

/** The `[from, to)` window for a `YYYY-MM` month, in local time — matching
 *  `packages/ai/src/budget.ts`'s `startOfMonth`'s reasoning: a budget lines up with the
 *  calendar month the user typed, not with a UTC boundary that can land on a different day. */
function monthRange(month: string): { from: Date; to: Date } {
  const [year, monthNumber] = month.split('-').map(Number)
  const y = year ?? new Date().getFullYear()
  const m = (monthNumber ?? 1) - 1
  return { from: new Date(y, m, 1), to: new Date(y, m + 1, 1) }
}

export interface HandlerDeps {
  settings: SettingsStore
  updater: Updater
  jobs: JobsFacade
  library: LibraryService
  /** The vector half of the library (sub-phase 6.3). `null` when the database did not open. */
  embeddings: EmbeddingService | null
  blobStore: BlobStore
  /** Forwarded to the main-process Sentry client, once telemetry is on. */
  reportRendererError: (error: { name: string; message: string; stack?: string }) => void
  /**
   * Submitted Batch API jobs (sub-phase 7.3). `null` when the database did not open, in
   * which case the two channels report that rather than answering with an empty tray.
   */
  batches: BatchesFacade | null
  /** `null` when the database did not open — see `../jobs/bootstrap.ts`. */
  secrets: SecretStore | null
  backups: BackupService | null
  settingsRepo: SettingsRepository | null
  /** Rebuilds the main `AiClient` against a fresh `ai.pricing.overlay` — called after
   *  `ai.setPricingOverlay` and `ai.restorePricing` write the setting
   *  (`../jobs/bootstrap.ts`'s `AiClientOptions.pricing` is a value, not a resolver).
   *  and `ai.restorePricing` write the setting. No-op when the database did not open. */
  refreshAiPricing: () => Promise<void>
  /** The cost log behind the usage dashboard (sub-phase 7.1/7.5). `null` when the database
   *  did not open. */
  aiCalls: AiCallRepository | null
  memory: MemoryService | null
  /** Computed once at startup (`../backups/synced-folder.ts`). */
  syncedFolderWarning: boolean
  /** Closes the shared database, swaps in the chosen backup file, and relaunches the app.
   *  Never returns under normal operation — the process exits. */
  restoreFromBackup: () => Promise<boolean>
  dbUnavailableReason: string
  /** Broadcasts `settings.changed`; what makes `useSetting` a "subscription" in practice. */
  emitSettingsChanged: (key: string, value: JsonValue) => void
  /** Same gate as `jobs.enqueueDemo`/`app.devMediaSampleUrl`: whether `memory.seedReviewDemo`
   *  will seed anything. False in a packaged build. */
  reviewDemoEnabled: boolean
}

/** The bridge speaks ISO strings; the use cases speak `Date`. */
function toSelection(input: {
  cardIds?: readonly string[]
  itemIds?: readonly string[]
  levels?: readonly string[]
  limit?: number
}): RescheduleSelection {
  return {
    ...(input.cardIds === undefined ? {} : { cardIds: input.cardIds }),
    ...(input.itemIds === undefined ? {} : { itemIds: input.itemIds }),
    ...(input.levels === undefined ? {} : { levels: input.levels as ImportanceLevel[] }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  }
}

function toImpactDto(impact: RescheduleImpact) {
  return {
    ...impact,
    changes: impact.changes.map((change) => ({
      ...change,
      currentDue: change.currentDue.toISOString(),
      newDue: change.newDue.toISOString(),
    })),
    computedAt: impact.computedAt.toISOString(),
  }
}

function toPlanDto(plan: SessionPlan) {
  return {
    counts: plan.counts,
    overload: { ...plan.overload, byLevel: [...plan.overload.byLevel] },
    postponements: plan.postponements.length,
    burials: plan.burials.length,
    estimatedMinutes: plan.estimatedMinutes,
    budgetMinutes: plan.budgetMinutes,
    streakGoalCards: plan.streakGoalCards,
    medianSecondsPerCard: plan.medianSecondsPerCard,
    backlogDays: plan.backlogDays,
    newGated: plan.newGated,
    finalDrill: plan.finalDrill,
    order: plan.order,
    seed: plan.seed,
    composedAt: plan.composedAt.toISOString(),
  }
}

/** The FSRS half of the card only: `payload` is the activity's, and the audit columns are
 *  no business of the renderer. */
function toCardDto(card: Card) {
  return {
    id: card.id,
    itemId: card.itemId,
    template: card.template,
    payload: card.payload as JsonValue,
    state: card.state,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduledDays,
    learningSteps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.lastReview === null ? null : card.lastReview.toISOString(),
    leech: card.leech,
  }
}

function toEntryDto(entry: SessionEntry | null, activity: ServedActivity | null = null) {
  if (entry === null) return null
  if (entry.kind === 'reinforcement') return { kind: entry.kind, node: entry.node }
  return {
    kind: entry.kind,
    card: toCardDto(entry.card),
    level: entry.level,
    retrievability: entry.retrievability,
    desiredRetention: entry.options.desiredRetention,
    examId: entry.examId,
    activity,
  }
}

function toProgressDto(state: SessionRunnerState) {
  return { ...state }
}

function toItemDto(item: KnowledgeItem | null) {
  if (item === null) return null
  return { fields: item.fields as JsonValue }
}

function toPreviewDto(preview: SchedulingPreview | null) {
  if (preview === null) return null
  return GRADES.map((grade) => {
    const { card } = preview[grade]
    return {
      grade,
      due: card.due.toISOString(),
      scheduledDays: card.scheduledDays,
      stability: card.stability,
      difficulty: card.difficulty,
    }
  })
}

/** `scheduler_profiles` on the wire: dates as ISO strings, like every other channel. */
function toSchedulerProfileDto(profile: SchedulerProfile) {
  return {
    scope: profile.scope,
    algorithm: profile.algorithm,
    w: profile.w,
    decay: profile.decay,
    learningSteps: profile.learningSteps,
    relearningSteps: profile.relearningSteps,
    enableFuzz: profile.enableFuzz,
    enableShortTerm: profile.enableShortTerm,
    maximumInterval: profile.maximumInterval,
    dayStartHour: profile.dayStartHour,
    trainedAt: profile.trainedAt === null ? null : profile.trainedAt.toISOString(),
    nReviews: profile.nReviews,
    logLoss: profile.logLoss,
    rmse: profile.rmse,
  }
}

function toOptimizerStatusDto(status: OptimizerStatus) {
  return {
    profile: toSchedulerProfileDto(status.profile),
    nReviews: status.nReviews,
    offer: status.offer,
  }
}

function toSummaryDto(summary: SessionSummary) {
  return {
    ...summary,
    overload: { ...summary.overload, byLevel: [...summary.overload.byLevel] },
    finishedAt: summary.finishedAt.toISOString(),
  }
}

function toForecastDto(forecast: Forecast) {
  return {
    ...forecast,
    days: forecast.days.map((day) => ({ ...day, byLevel: { ...day.byLevel } })),
    generatedAt: forecast.generatedAt.toISOString(),
  }
}

/**
 * The bridge has no `Infinity`: the top stability bin is open-ended in core and `null` on
 * the wire, which is also how the schema declares it.
 */
function toBinDto(bin: { label: string; from: number; to: number; count: number; share: number }) {
  return { ...bin, to: Number.isFinite(bin.to) ? bin.to : null }
}

function toRetentionDto(retention: TrueRetention) {
  return {
    window: retention.window,
    from: retention.from,
    young: { ...retention.young },
    mature: { ...retention.mature },
    all: { ...retention.all },
  }
}

function toStatsDto(stats: StatsOverview) {
  return {
    trueRetention: toRetentionDto(stats.trueRetention),
    byLevel: stats.byLevel.map((entry) => ({ ...entry })),
    retentionAlert: stats.retentionAlert,
    memorized: {
      ...stats.memorized,
      series: stats.memorized.series.map((day) => ({ ...day })),
      generatedAt: stats.memorized.generatedAt.toISOString(),
    },
    distribution: {
      ...stats.distribution,
      stability: stats.distribution.stability.map(toBinDto),
      difficulty: stats.distribution.difficulty.map(toBinDto),
    },
    forecast: stats.forecast === null ? null : toForecastDto(stats.forecast),
    generatedAt: stats.generatedAt.toISOString(),
  }
}

/** Imports each file independently: one unreadable or unsupported file must not sink the
 *  rest of a multi-select or a multi-file drop. Failures are logged, not surfaced per-file —
 *  the source list simply shows what actually got added. */
async function addEach(
  labels: readonly string[],
  attempts: readonly Promise<Source>[],
): Promise<SourceSummary[]> {
  const results = await Promise.allSettled(attempts)
  const sources: SourceSummary[] = []
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      sources.push(toSourceSummary(result.value))
    } else {
      // Never let this message read as an ES import statement (the word "import" followed
      // by a quoted string): electron-vite finds the built main chunk's last import with a
      // regex, and a message shaped like one made it inject its `__dirname` shim inside the
      // string instead of at module scope — main then threw before opening a window.
      log.error(`[library] could not add "${labels[index]}":`, result.reason)
    }
  }
  return sources
}

/** `sources.meta` holds what the parse produced — the renderer's `meta` — and, from the
 *  moment of import, `blobExt` (see `library/service.ts`), which is main's business only.
 *  The DTO carries the former, and only once a parse has produced it. */
function parsedMeta(meta: Source['meta']): SourceSummary['meta'] {
  if (meta === null || typeof meta.sourceDocBlobSha256 !== 'string') return null
  const parsed = meta as unknown as NonNullable<SourceSummary['meta']>
  return {
    sourceDocBlobSha256: parsed.sourceDocBlobSha256,
    blockCount: parsed.blockCount,
    assetCount: parsed.assetCount,
    needsOcr: parsed.needsOcr,
    ocrPages: parsed.ocrPages,
    warnings: parsed.warnings,
    // Written later, by the chunk job — a source between parse and chunk simply has none.
    ...(typeof parsed.chunkCount === 'number' ? { chunkCount: parsed.chunkCount } : {}),
    ...(typeof parsed.unitCount === 'number' ? { unitCount: parsed.unitCount } : {}),
    ...(typeof parsed.frontmatterChunkCount === 'number'
      ? { frontmatterChunkCount: parsed.frontmatterChunkCount }
      : {}),
    ...(typeof parsed.chunkTokenCount === 'number'
      ? { chunkTokenCount: parsed.chunkTokenCount }
      : {}),
    // Sub-phase 6.4. This copy is hand-written rather than a spread, so a field the pipeline
    // starts writing and this list forgets is silently absent in the renderer rather than a
    // type error — which is exactly how `media` would have gone missing.
    ...(parsed.media === undefined ? {} : { media: parsed.media }),
    ...(typeof parsed.chunkingVersion === 'string'
      ? { chunkingVersion: parsed.chunkingVersion }
      : {}),
  }
}

/**
 * How much of a chunk's text crosses the bridge. Tables, code listings and equations are never
 * split (`ATOMIC_BLOCK_TYPES`), so one pathological source — a PDF that is a single enormous
 * table — has no size ceiling at all, and this view line-clamps what it shows to four lines
 * anyway. The DTO says when it truncated so nothing mistakes the excerpt for the chunk.
 */
const MAX_CHUNK_TEXT_CHARS = 4_000

/**
 * A `chunks` row as the Library shows it. The locator's canonical keys are snake_case (see
 * `parseSourceLocator`), which is why this reads it through core rather than by hand.
 *
 * `parseSourceLocator` is deliberately permissive about the numbers it finds — it also reads
 * rows written by importers of other apps' data — while the DTO promises integers, so they are
 * rounded here. Without that, one imported row with a fractional page would fail the channel's
 * *output* validation and blank the whole list rather than that one entry.
 */
function toChunkSummary(chunk: Chunk): ChunkSummary {
  const locator = parseSourceLocator(chunk)
  const round = (value: number | null): number | null => (value === null ? null : Math.round(value))
  const truncated = chunk.text.length > MAX_CHUNK_TEXT_CHARS
  return {
    id: chunk.id,
    ordinal: chunk.ordinal,
    text: truncated ? `${chunk.text.slice(0, MAX_CHUNK_TEXT_CHARS)}…` : chunk.text,
    truncated,
    tokenCount: chunk.tokenCount,
    headingPath: chunk.headingPath,
    context: chunk.context,
    isFrontmatter: chunk.isFrontmatter,
    label: locator.label,
    page: round(locator.page),
    tStartMs: round(locator.tStartMs),
    tEndMs: round(locator.tEndMs),
    blockIds: [...locator.blockIds],
  }
}

/** `<b>` is the only markup FTS5's `snippet()` puts in, and it is what tells the renderer
 *  which run of the passage matched. */
const HIGHLIGHT = /<\/?b>/

/**
 * One `ChunkSearchHit` as the wire carries it.
 *
 * A hit the vector branch alone found has no `snippet` — `snippet()` is an FTS5 function and
 * there was no FTS5 match to take one from — so the head of the chunk stands in, and
 * `highlighted` tells the renderer which of the two it is holding.
 */
function toSearchHit(hit: ChunkSearchHit, sources: ReadonlyMap<string, Source>): SearchHit {
  const source = sources.get(hit.chunk.sourceId)
  const snippet = hit.snippet ?? `${hit.chunk.text.slice(0, SNIPPET_FALLBACK_CHARS)}…`
  return {
    chunkId: hit.chunk.id,
    sourceId: hit.chunk.sourceId,
    sourceTitle: source?.title ?? '',
    sourceKind: source?.kind ?? 'text',
    score: hit.score,
    fusionScore: hit.fusionScore,
    snippet,
    highlighted: hit.snippet !== undefined && HIGHLIGHT.test(hit.snippet),
    headingPath: hit.chunk.headingPath,
    label: hit.sourceLocator.label,
    page: hit.sourceLocator.page,
    tStartMs: hit.sourceLocator.tStartMs,
    blockIds: [...hit.blockIds],
    matchedFts: hit.fts !== undefined,
    matchedVector: hit.vector !== undefined,
  }
}

/** How much of a purely semantic hit to show when there is no FTS5 snippet to quote. */
const SNIPPET_FALLBACK_CHARS = 240

function toSourceSummary(source: Source): SourceSummary {
  return {
    id: source.id,
    kind: source.kind,
    title: source.title,
    status: source.status,
    language: source.language,
    error: source.error,
    meta: parsedMeta(source.meta),
    blobSha256: source.blobSha256,
    embeddingStatus: source.embeddingStatus,
    embeddingModelId: source.embeddingModelId,
    embeddingError: source.embeddingError,
    createdAt: source.createdAt.toISOString(),
    ingestedAt: source.ingestedAt?.toISOString() ?? null,
  }
}

/** `annotation.anchor` is validated once, at `library.createAnnotation`'s IPC boundary
 *  (`annotationAnchorSchema`); the cast here just names that already-checked shape rather
 *  than re-deriving it from a loosely-typed `JsonObject`. */
function toAnnotationDto(annotation: Annotation): AnnotationDto {
  return {
    id: annotation.id,
    sourceId: annotation.sourceId,
    unitId: annotation.unitId,
    kind: annotation.kind,
    anchor: annotation.anchor as unknown as AnnotationAnchor,
    quote: annotation.quote,
    note: annotation.note,
    color: annotation.color,
    tStart: annotation.tStart,
    tEnd: annotation.tEnd,
    createdAt: annotation.createdAt.toISOString(),
    updatedAt: annotation.updatedAt.toISOString(),
  }
}

/** `source.lastLocator` is non-null by construction here: `library.listRecentlyOpened` only
 *  ever returns sources `recordProgress` has already written one for. */
function toRecentSource(source: Source): RecentSource {
  return {
    id: source.id,
    kind: source.kind,
    title: source.title,
    locator: source.lastLocator as unknown as ReadingLocator,
    lastOpenedAt: (source.lastOpenedAt as Date).toISOString(),
  }
}

/** The implementation of every channel in the contract. */
export function createHandlers({
  settings,
  updater,
  jobs,
  batches,
  library,
  embeddings,
  blobStore,
  reportRendererError,
  secrets,
  backups,
  settingsRepo,
  refreshAiPricing,
  aiCalls,
  memory,
  syncedFolderWarning,
  restoreFromBackup,
  dbUnavailableReason,
  emitSettingsChanged,
  reviewDemoEnabled,
}: HandlerDeps): Handlers<Contract> {
  return {
    'app.getVersion': () => ({
      app: app.getVersion(),
      electron: process.versions.electron ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      node: process.versions.node ?? 'unknown',
    }),

    'app.ping': ({ sentAt }) => ({
      sentAt,
      receivedAt: new Date().toISOString(),
    }),

    'app.devMediaSampleUrl': async () => {
      if (!is.dev) {
        return { url: null }
      }
      return { url: await ensureDevMediaSample(getDevMediaSamplePath(), blobStore) }
    },

    'app.getSettings': () => settings.get(),

    'app.setUpdateChannel': ({ channel }) => settings.setUpdateChannel(channel),

    'app.setTelemetryEnabled': ({ enabled }) => settings.setTelemetryEnabled(enabled),

    // `nativeTheme.themeSource = …` synchronously fires the `'updated'` listener registered
    // in `main/theme/sync.ts`, which broadcasts the resolved value on `app.themeChanged` —
    // the same path an OS-level theme switch takes. So the only thing this handler owns is
    // persisting the preference.
    'app.setTheme': ({ theme }) => {
      nativeTheme.themeSource = theme
      return settings.setTheme(theme)
    },

    'app.setDensity': ({ density }) => settings.setDensity(density),

    'app.setGamificationProfile': ({ profile }) => settings.setGamificationProfile(profile),

    'app.checkForUpdates': () => {
      updater.checkForUpdates()
    },

    'app.quitAndInstall': () => {
      updater.quitAndInstall()
    },

    'app.exportDiagnostics': async (_input, event) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions = {
        title: 'Export diagnostics',
        defaultPath: `retenia-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
        filters: [{ name: 'Zip archive', extensions: ['zip'] }],
      }
      const { canceled, filePath } = window
        ? await dialog.showSaveDialog(window, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)
      if (canceled || !filePath) {
        return { savedTo: null }
      }
      const systemInfo = await collectSystemInfo()
      await exportDiagnostics(getLogsDir(), systemInfo, filePath)
      return { savedTo: filePath }
    },

    'app.reportRendererError': (error) => {
      reportRendererError(error)
    },

    'jobs.list': async (input) => ({ jobs: await jobs.list(input) }),

    'jobs.cancel': ({ id }) => jobs.cancel(id),

    'jobs.retry': ({ id }) => jobs.retry(id),

    'jobs.enqueueDemo': (input) => jobs.enqueueDemo(input),

    // --- AI batches: the Batch API's tray surface (sub-phase 7.3) ---

    'ai.listBatches': async () => ({
      batches: batches === null ? [] : await batches.list(),
    }),

    'ai.cancelBatch': async ({ id }) => {
      if (batches === null) {
        throw new Error(`The AI batch queue is unavailable: ${dbUnavailableReason}`)
      }
      return await batches.cancel(id)
    },

    // --- library: import, watch, read back a parse (sub-phase 6.1) ---

    'library.listSources': async (input) => ({
      sources: (await library.list(input)).map(toSourceSummary),
    }),

    'library.getSource': async ({ id }) => {
      const source = await library.get(id)
      return { source: source === undefined ? null : toSourceSummary(source) }
    },

    'library.getSourceDoc': async ({ id }) => ({ doc: (await library.getDoc(id)) ?? null }),

    'library.listChunks': async ({ id, limit, offset, excludeFrontmatter }) => {
      const all = await library.getChunks(id)
      const visible = excludeFrontmatter === true ? all.filter((c) => !c.isFrontmatter) : all
      const from = offset ?? 0
      return {
        chunks: visible.slice(from, from + (limit ?? 100)).map(toChunkSummary),
        total: visible.length,
      }
    },

    'library.estimateContextualization': ({ id }) => library.estimateContextualization(id),

    'library.addSourceFromDialog': async (_input, event) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions: Electron.OpenDialogOptions = {
        title: 'Add to Library',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Supported files', extensions: IMPORTABLE_EXTENSIONS }],
      }
      const { canceled, filePaths } = window
        ? await dialog.showOpenDialog(window, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      if (canceled) return { sources: [] }
      return {
        sources: await addEach(
          filePaths,
          filePaths.map((path) => library.addFromFile(path)),
        ),
      }
    },

    'library.addCourseFromFolder': async (_input, event) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions: Electron.OpenDialogOptions = {
        title: 'Add a course folder',
        properties: ['openDirectory'],
      }
      const { canceled, filePaths } = window
        ? await dialog.showOpenDialog(window, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      const folder = filePaths[0]
      if (canceled || folder === undefined) {
        return { source: null, fileCount: 0, skipped: [], truncated: false }
      }
      const result = await library.addCourseFromFolder(folder)
      return {
        source: toSourceSummary(result.source),
        fileCount: result.fileCount,
        skipped: result.skipped,
        truncated: result.truncated,
      }
    },

    'library.createCardFromClip': async (input) => library.createCardFromClip(input),

    'library.listUnits': async ({ id, kinds, limit }) => {
      const units = await library.getUnits(id)
      const wanted = kinds === undefined ? units : units.filter((unit) => kinds.includes(unit.kind))
      return {
        units: (limit === undefined ? wanted : wanted.slice(0, limit)).map((unit) => ({
          id: unit.id,
          kind: unit.kind,
          ordinal: unit.ordinal,
          label: unit.label,
          tStartMs: unit.tStart,
          tEndMs: unit.tEnd,
          text: unit.text,
          blobSha256: unit.blobSha256,
        })),
      }
    },

    'library.addSourceFromFiles': async ({ files }) => ({
      sources: await addEach(
        files.map((file) => file.name),
        files.map((file) => library.addFromBytes(file.name, file.bytes)),
      ),
    }),

    'library.addSourceFromText': async ({ text, title }) =>
      toSourceSummary(await library.addFromText(text, title)),

    'library.addSourceFromUrl': async ({ url }) => {
      const { sources, truncated } = await library.addFromUrl(url)
      return { sources: sources.map(toSourceSummary), truncated }
    },

    'library.retrySource': async ({ id }) => toSourceSummary(await library.retry(id)),

    'library.deleteSource': async ({ id }) => {
      await library.remove(id)
    },

    // --- retrieval (sub-phase 6.3, docs/spec/05-ingestion-rag.md §4) ---

    'library.search': async ({ query, mode, k, sourceIds, kinds, prefix }) => {
      if (!embeddings) unavailable('search', dbUnavailableReason)

      // The library is listed once and used for both jobs below: resolving the `kinds` facet
      // to source ids, and giving each hit the title of the source it came from — a citation
      // without the book it came from is not a citation.
      const sources = new Map((await library.list()).map((source) => [source.id, source] as const))
      const modelId = (await embeddings.activeModelId()) ?? null

      // The kinds facet is resolved here rather than pushed into the query: `chunks` has no
      // `kind` column, and this keeps the two facets intersecting in one place.
      let ids = sourceIds
      if (kinds !== undefined) {
        const matching = [...sources.values()]
          .filter((source) => kinds.includes(source.kind))
          .map((source) => source.id)
        ids = ids === undefined ? matching : ids.filter((id) => matching.includes(id))
        // An empty list is a real answer ("no source of those kinds"), not "every source".
        if (ids.length === 0) return { hits: [], modelId, degraded: false, tookMs: 0 }
      }

      const startedAt = Date.now()
      const hits = await embeddings.search(query, {
        ...(mode === undefined ? {} : { mode }),
        ...(k === undefined ? {} : { k }),
        ...(ids === undefined ? {} : { sourceIds: ids }),
        ...(prefix === undefined ? {} : { prefix }),
      })
      const tookMs = Date.now() - startedAt

      return {
        hits: hits.map((hit) => toSearchHit(hit, sources)),
        modelId,
        // `vector` never ran when no hit carries a vector rank *and* a vector search was
        // wanted — which is exactly the case the UI has to disclose.
        degraded:
          (mode ?? 'hybrid') !== 'fts' &&
          (modelId === null || hits.every((hit) => hit.vector === undefined)),
        tookMs,
      }
    },

    'library.createCardFromChunk': ({ chunkId, front, back }) =>
      library.createCardFromChunk({
        chunkId,
        ...(front === undefined ? {} : { front }),
        ...(back === undefined ? {} : { back }),
      }),

    'library.embedSource': async ({ id }) => {
      if (!embeddings) unavailable('search', dbUnavailableReason)
      await embeddings.embedSource(id)
    },

    'library.retrievalStatus': async () => {
      if (!embeddings) unavailable('search', dbUnavailableReason)
      return embeddings.status()
    },

    // --- annotations and reading progress (sub-phase 6.6, docs/spec/05-ingestion-rag.md §6.6) ---

    'library.listAnnotations': async ({ sourceId }) => ({
      annotations: (await library.listAnnotations(sourceId)).map(toAnnotationDto),
    }),

    'library.createAnnotation': async ({ sourceId, unitId, kind, anchor, quote, note, color }) => ({
      annotation: toAnnotationDto(
        await library.createAnnotation({
          sourceId,
          ...(unitId === undefined ? {} : { unitId }),
          kind,
          anchor: anchor as unknown as JsonObject,
          ...(quote === undefined ? {} : { quote }),
          ...(note === undefined ? {} : { note }),
          ...(color === undefined ? {} : { color }),
        }),
      ),
    }),

    'library.updateAnnotation': async ({ id, note, color }) => ({
      annotation: toAnnotationDto(
        await library.updateAnnotation({
          id,
          ...(note === undefined ? {} : { note }),
          ...(color === undefined ? {} : { color }),
        }),
      ),
    }),

    'library.deleteAnnotation': async ({ id }) => {
      await library.deleteAnnotation(id)
    },

    'library.createCardFromAnnotation': ({ annotationId, front, back }) =>
      library.createCardFromAnnotation({
        annotationId,
        ...(front === undefined ? {} : { front }),
        ...(back === undefined ? {} : { back }),
      }),

    'library.recordProgress': async ({ sourceId, locator }) => {
      await library.recordProgress(sourceId, locator as unknown as JsonObject)
    },

    'library.listRecentlyOpened': async ({ limit }) => ({
      sources: (await library.listRecentlyOpened(limit)).map(toRecentSource),
    }),

    // --- memory: importance, urgent mode, reschedule (docs/spec/02-memory-system.md §7) ---

    'items.setImportance': async ({ ids, level }) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      return { updated: await memory.setItemImportance(ids, level as ImportanceLevel) }
    },

    'cards.overrideImportance': async ({ ids, level, expiresAt }) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      const updated = await memory.overrideCardImportance(
        ids,
        level as ImportanceLevel | null,
        expiresAt === undefined || expiresAt === null ? null : new Date(expiresAt),
      )
      return { updated }
    },

    'memory.importanceMix': async () => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      const mix = await memory.importanceMix()
      return { ...mix, entries: [...mix.entries], computedAt: mix.computedAt.toISOString() }
    },

    'memory.simulateReschedule': async (selection) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      return toImpactDto(await memory.simulateReschedule(toSelection(selection)))
    },

    'memory.rescheduleNow': async ({ confirm: _confirm, ...selection }) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      const { impact, applied } = await memory.rescheduleNow(toSelection(selection))
      return { impact: toImpactDto(impact), applied }
    },

    'memory.forecast': async ({ days }) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      return toForecastDto(await memory.forecast(days))
    },

    // --- the scheduler profile and its optimizer (§6, §16) ---

    'scheduler.status': async () => {
      if (!memory) unavailable('scheduler', dbUnavailableReason)
      return toOptimizerStatusDto(await memory.optimizerStatus())
    },

    'scheduler.optimize': async () => {
      if (!memory) unavailable('scheduler', dbUnavailableReason)
      const { jobId, nReviews } = await memory.startOptimization()
      const job = await jobs.find(jobId)
      if (job === null) throw new Error('The optimization job disappeared after it was queued')
      return { job, nReviews }
    },

    'scheduler.applyOptimization': async ({ jobId, confirm: _confirm }) => {
      if (!memory) unavailable('scheduler', dbUnavailableReason)
      const outcome = await memory.applyOptimization(jobId)
      return {
        applied: outcome.applied,
        reason: outcome.check.reason,
        before: outcome.before,
        after: outcome.after,
        profile: toSchedulerProfileDto(outcome.profile),
      }
    },

    'scheduler.updateProfile': async (patch) => {
      if (!memory) unavailable('scheduler', dbUnavailableReason)
      return toSchedulerProfileDto(await memory.updateProfile(patch))
    },

    'scheduler.setLevel': async ({ level, ...patch }) => {
      if (!memory) unavailable('scheduler', dbUnavailableReason)
      return { updated: await memory.setLevel(level, patch) }
    },

    'cards.disperseSiblings': async ({ itemId, confirm: _confirm }) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      return { moved: await memory.disperseSiblings(itemId) }
    },

    'stats.overview': async (options) => {
      if (!memory) unavailable('stats', dbUnavailableReason)
      return toStatsDto(await memory.stats(options))
    },

    'stats.trueRetention': async ({ window }) => {
      if (!memory) unavailable('stats', dbUnavailableReason)
      return toRetentionDto(await memory.trueRetention(window))
    },

    'session.plan': async (settings) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      return toPlanDto(await memory.planSession(settings))
    },

    'session.start': async ({ confirm: _confirm, ...settings }) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      const result = await memory.startSession(settings)
      return {
        progress: toProgressDto(result.runner.state()),
        resumed: result.resumed,
        burials: result.burials,
        postponed: result.postponed,
        // A resumed session shows the figures it was started with, not a fresh projection
        // of a day the user is halfway through.
        plan: result.plan === null ? null : toPlanDto(result.plan),
      }
    },

    'session.next': async () => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      const { entry, progress, item, preview, activity } = await memory.sessionNext()
      return {
        entry: toEntryDto(entry, activity),
        progress: toProgressDto(progress),
        item: toItemDto(item),
        preview: toPreviewDto(preview),
      }
    },

    'session.answer': async ({
      rating,
      exerciseScore,
      durationMs,
      attemptId,
      activityId,
      attempt,
    }) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      const { result, progress } = await memory.sessionAnswer(
        {
          rating,
          ...(exerciseScore === undefined ? {} : { exerciseScore }),
          ...(durationMs === undefined ? {} : { durationMs }),
          ...(attemptId === undefined ? {} : { attemptId }),
          ...(activityId === undefined ? {} : { activityId }),
        },
        attempt === undefined
          ? undefined
          : {
              answer: attempt.answer ?? null,
              feedback: attempt.feedback ?? null,
              correct: attempt.correct,
              tries: attempt.tries,
              hintsUsed: attempt.hintsUsed,
            },
      )
      return {
        card: toCardDto(result.card),
        drilled: result.drilled,
        progress: toProgressDto(progress),
      }
    },

    'session.skip': async () => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      return { progress: toProgressDto(await memory.sessionSkip()) }
    },

    'session.undo': async () => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      const { undone, progress } = await memory.sessionUndo()
      return {
        undone: undone !== null,
        cardId: undone?.cardId ?? null,
        progress: toProgressDto(progress),
      }
    },

    'session.finish': async () => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      return toSummaryDto(await memory.sessionFinish())
    },

    'memory.startUrgentMode': async ({ itemIds, hours }) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      const result = await memory.startUrgentMode(itemIds, hours as UrgentModeHours | undefined)
      return { ...result, expiresAt: result.expiresAt.toISOString() }
    },

    'cards.setLeech': async ({ ids, leech }) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      return { updated: await memory.setCardLeech(ids, leech) }
    },

    'memory.seedReviewDemo': async ({ count }) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      if (!reviewDemoEnabled) return { itemIds: [], cardIds: [] }
      return memory.seedReviewDemo(count)
    },

    'secrets.set': async ({ name, value }) => {
      if (!secrets) unavailable('secrets', dbUnavailableReason)
      await secrets.setSecret(name as SecretName, value)
      return { ok: true }
    },

    'secrets.get': async ({ name }) => {
      if (!secrets) unavailable('secrets', dbUnavailableReason)
      const value = await secrets.getSecret(name as SecretName)
      return { hasSecret: value !== undefined, preview: maskSecret(value) }
    },

    'secrets.delete': async ({ name }) => {
      if (!secrets) unavailable('secrets', dbUnavailableReason)
      await secrets.deleteSecret(name as SecretName)
      return { ok: true }
    },

    'ai.listProviderCards': async () => {
      if (!settingsRepo || !secrets) unavailable('ai', dbUnavailableReason)
      const registry = await buildRegistry({ settings: settingsRepo })
      const cards = await Promise.all(
        registry.profiles.map(async (profile) => {
          const secretValue =
            profile.keyRef === null ? undefined : await secrets.getSecret(profile.keyRef)
          const perMillionUsd: Record<string, { input: number; output: number } | null> = {}
          for (const modelId of profile.models) {
            try {
              const rates = resolveRates(SHIPPED_PRICING, `${profile.kind}:${modelId}`, new Date())
              perMillionUsd[modelId] = { input: rates.input, output: rates.output }
            } catch {
              perMillionUsd[modelId] = null
            }
          }
          return {
            id: profile.id,
            kind: profile.kind,
            label: providerLabel(profile),
            models: [...profile.models],
            perMillionUsd,
            local: profile.local === true,
            hasKey: secretValue !== undefined,
            keyPreview: maskSecret(secretValue),
            baseUrl: profile.baseURL ?? null,
          }
        }),
      )
      return { cards }
    },

    'ai.probeProvider': async ({ profileId }) => {
      if (!settingsRepo || !secrets) unavailable('ai', dbUnavailableReason)
      const registry = await buildRegistry({ settings: settingsRepo })
      const profile = registry.profiles.find((p) => p.id === profileId)
      if (!profile) {
        return { ok: false, models: [], error: `no such provider: "${profileId}"`, latencyMs: 0 }
      }
      const apiKey = profile.keyRef === null ? '' : await secrets.getSecret(profile.keyRef)
      if (apiKey === undefined) {
        return {
          ok: false,
          models: [],
          error: 'no key is stored for this provider',
          latencyMs: 0,
        }
      }
      const result = await probeProvider(profile, apiKey)
      return { ...result, models: [...result.models] }
    },

    'ai.getRoles': async () => {
      if (!settingsRepo) unavailable('ai', dbUnavailableReason)
      const registry = await buildRegistry({ settings: settingsRepo })
      const roles = PROVIDER_ROLE_VALUES.map((role) => {
        const config = registry.roles[role]
        return {
          role,
          primary: config?.primary ?? null,
          fallbacks: config ? [...config.fallbacks] : [],
        }
      })
      return { roles }
    },

    'ai.setRoles': async ({ roles }) => {
      if (!settingsRepo || !secrets) unavailable('ai', dbUnavailableReason)
      const registry = await buildRegistry({ settings: settingsRepo })
      const byId = new Map(registry.profiles.map((profile) => [profile.id, profile]))

      const isUsable = async (ref: { profileId: string; modelId: string }): Promise<boolean> => {
        const profile = byId.get(ref.profileId)
        if (!profile?.models.includes(ref.modelId)) return false
        if (profile.keyRef === null) return true
        return (await secrets.getSecret(profile.keyRef)) !== undefined
      }

      const stored: Record<string, RoleAssignmentValue> = {}
      for (const assignment of roles) {
        if (assignment.primary !== null) {
          if (!(await isUsable(assignment.primary))) {
            throw new Error(
              `ai.setRoles: "${assignment.role}"'s primary ` +
                `(${assignment.primary.profileId}/${assignment.primary.modelId}) has no ` +
                'stored key or is not a model that provider lists',
            )
          }
          for (const fallback of assignment.fallbacks) {
            if (!(await isUsable(fallback))) {
              throw new Error(
                `ai.setRoles: "${assignment.role}"'s fallback ` +
                  `(${fallback.profileId}/${fallback.modelId}) has no stored key or is not ` +
                  'a model that provider lists',
              )
            }
          }
        }
        stored[assignment.role] = { primary: assignment.primary, fallbacks: assignment.fallbacks }
      }

      await settingsRepo.set('ai.roles', stored)
      return { ok: true }
    },

    'ai.getPricingOverlay': async () => {
      if (!settingsRepo) unavailable('ai', dbUnavailableReason)
      const overlayRaw = await settingsRepo.get('ai.pricing.overlay')
      const overlay = overlayRaw as unknown as PricingOverlay
      const merged = mergePricingOverlay(SHIPPED_PRICING, overlay)
      const now = new Date()
      const rows = Object.entries(SHIPPED_PRICING.models).map(([key, model]) => {
        const resolved = resolveRates(merged, key, now)
        const entry = overlayRaw[key]
        return {
          modelKey: key,
          label: model.label,
          resolved: {
            input: resolved.input,
            output: resolved.output,
            cacheRead: resolved.cacheRead,
            cacheWrite5m: resolved.cacheWrite5m,
            cacheWrite1h: resolved.cacheWrite1h,
            batchDiscount: resolved.batchDiscount,
          },
          overlay: entry === undefined ? null : { modelKey: key, ...entry },
        }
      })
      return {
        revision: SHIPPED_PRICING.revision,
        isOverridden: Object.keys(overlayRaw).length > 0,
        rows,
      }
    },

    'ai.setPricingOverlay': async ({ entries }) => {
      if (!settingsRepo) unavailable('ai', dbUnavailableReason)
      const overlay: PricingOverlay = {}
      for (const entry of entries) {
        const { modelKey: key, ...rate } = entry
        overlay[key] = rate
      }
      const unknown = unknownOverlayKeys(SHIPPED_PRICING, overlay)
      if (unknown.length > 0) {
        throw new Error(`ai.setPricingOverlay: unknown model key(s): ${unknown.join(', ')}`)
      }
      await settingsRepo.set('ai.pricing.overlay', overlay)
      await refreshAiPricing()
      return { ok: true }
    },

    'ai.restorePricing': async () => {
      if (!settingsRepo) unavailable('ai', dbUnavailableReason)
      await settingsRepo.set('ai.pricing.overlay', {})
      await refreshAiPricing()
      return { ok: true }
    },

    'ai.getUsageSummary': async ({ month }) => {
      if (!aiCalls) unavailable('ai', dbUnavailableReason)
      const { from, to } = monthRange(month)
      const [totalUsd, byModel, byPurpose] = await Promise.all([
        aiCalls.sumCost({ from, to }),
        aiCalls.costByModel({ from, to }),
        aiCalls.costByPurpose({ from, to }),
      ])
      return { month, totalUsd, byModel, byPurpose }
    },

    'ai.listRecentCalls': async ({ limit }) => {
      if (!aiCalls) unavailable('ai', dbUnavailableReason)
      const rows = await aiCalls.listRecent({ limit })
      return {
        calls: rows.map((row) => ({
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          provider: row.provider,
          model: row.model,
          role: row.role,
          purpose: row.purpose,
          status: row.status,
          costUsd: row.costUsd,
          latencyMs: row.latencyMs,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
        })),
      }
    },

    'ai.exportUsageCsv': async ({ month }, event) => {
      if (!aiCalls) unavailable('ai', dbUnavailableReason)
      const { from, to } = monthRange(month)
      const byPurpose = await aiCalls.costByPurpose({ from, to })

      const window = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions = {
        title: 'Export this month’s AI usage',
        defaultPath: `retenia-ai-usage-${month}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      }
      const { canceled, filePath } = window
        ? await dialog.showSaveDialog(window, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)
      if (canceled || !filePath) return { savedTo: null }

      const header = 'purpose,provider,cost_usd,calls\n'
      const body = byPurpose
        .map((row) =>
          [csvField(row.purpose), csvField(row.provider), row.costUsd, row.calls].join(','),
        )
        .join('\n')
      await writeFile(filePath, `${header}${body}\n`, 'utf-8')
      return { savedTo: filePath }
    },

    'backups.status': async () => {
      if (!backups) unavailable('backups', dbUnavailableReason)
      return { backups: await backups.list(), syncedFolderWarning }
    },

    'backups.backupNow': async () => {
      if (!backups) unavailable('backups', dbUnavailableReason)
      return { file: await backups.backupNow() }
    },

    'backups.exportCopy': async (_input, event) => {
      if (!backups) unavailable('backups', dbUnavailableReason)
      const window = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions = {
        title: 'Export a copy of your data',
        defaultPath: `retenia-export-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
        filters: [{ name: 'Zip archive', extensions: ['zip'] }],
      }
      const { canceled, filePath } = window
        ? await dialog.showSaveDialog(window, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)
      if (canceled || !filePath) {
        return { savedTo: null }
      }
      await backups.exportCopy(filePath)
      return { savedTo: filePath }
    },

    'backups.restoreFromBackup': async () => ({ restored: await restoreFromBackup() }),

    'settings.get': async ({ key }) => {
      if (!settingsRepo) unavailable('settings', dbUnavailableReason)
      if (!Object.hasOwn(SETTINGS, key)) {
        throw new Error(`settings.get: "${key}" is not a registered setting`)
      }
      // The registry is heterogeneous by key — some values (`ai.roles`,
      // `ai.pricing.overlay`, `ai.budget.lastAlertedThreshold`) are plain interfaces rather
      // than `Record`s, so TypeScript cannot see them as structurally `JsonValue` even
      // though every field in every one of them already is. The cast is this boundary's,
      // not a new escape hatch: everything this repository stores is JSON by construction
      // (`packages/db`'s `settings` column is `TEXT` with a `json_valid` check).
      return { value: (await settingsRepo.get(key as SettingsKey)) as JsonValue }
    },

    'settings.set': async ({ key, value }) => {
      if (!settingsRepo) unavailable('settings', dbUnavailableReason)
      if (!Object.hasOwn(SETTINGS, key)) {
        throw new Error(`settings.set: "${key}" is not a registered setting`)
      }
      const settingsKey = key as SettingsKey
      // The registry is heterogeneous by key; the runtime `decode` inside `set` is what
      // actually guards a bad shape (falls back to the default on the next `get`, rather
      // than crashing here).
      // biome-ignore lint/suspicious/noExplicitAny: see above.
      await settingsRepo.set(settingsKey, value as any)
      const stored = (await settingsRepo.get(settingsKey)) as JsonValue
      emitSettingsChanged(settingsKey, stored)
      return { value: stored }
    },
  }
}
