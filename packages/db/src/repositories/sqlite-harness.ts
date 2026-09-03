import { createHash } from 'node:crypto'
import type {
  Activity,
  LearningPath,
  Lesson,
  Module,
  OutboxEntry,
  PathVersion,
  Section,
  UnitOfWork,
} from '@retenia/core'
import type {
  ContractContext,
  ContractSeeds,
  HarnessOptions,
  RepositoryContractHarness,
} from '@retenia/core/testing'
import { asc, isNull } from 'drizzle-orm'
import type { OpenedDatabase } from '../open-database'
import { chunks, outbox } from '../schema'
import { insertEmbedding } from '../search'
import { openTestDatabase, TEST_DEVICE_ID, type TestClock, testClock, testIds } from '../testing'
import { createRepositories } from './index'

/**
 * The SQLite adapter's harness for `@retenia/core/testing`'s shared contract suites.
 *
 * Exported from `@retenia/db/testing` so packages built on top of this one can reuse the
 * same in-memory setup, and so a second adapter has a worked example to copy.
 */

/** A card whose FSRS fields are a plausible "new" card. */
function newCardDefaults(due: Date) {
  return {
    template: 'basic',
    payload: null,
    due,
    stability: 0,
    difficulty: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: 0 as const,
    lastReview: null,
    suspended: false,
    buriedUntil: null,
    leech: false,
    importanceOverride: null,
    examId: null,
  }
}

/**
 * FK-safe builders. Foreign keys are enforced (`PRAGMA foreign_keys = ON`) and ids must be
 * real UUIDv7s (the `*_id_uuidv7` CHECK), so every builder creates whatever parent is
 * missing and lets the repository mint the id. Suites then read as behaviour rather than
 * as seeding order.
 */
function createSeeds(repos: UnitOfWork, clock: TestClock): ContractSeeds {
  let counter = 0
  const next = () => ++counter

  const seeds: ContractSeeds = {
    source: (overrides = {}) =>
      repos.sources.create({
        kind: 'pdf',
        title: `Fuente ${next()}`,
        originUri: null,
        blobSha256: null,
        status: 'ready',
        language: 'es',
        meta: null,
        error: null,
        ingestedAt: null,
        ...overrides,
      }),

    chunk: async (overrides = {}) => {
      const sourceId = overrides.sourceId ?? (await seeds.source()).id
      const text = overrides.text ?? `Fragmento ${next()}`
      return repos.chunks.create({
        sourceId,
        unitId: null,
        ordinal: 0,
        text,
        charStart: 0,
        charEnd: text.length,
        tokenCount: text.split(/\s+/).length,
        hash: createHash('sha256').update(text).digest('hex'),
        headingPath: null,
        context: null,
        locator: null,
        ...overrides,
        // `text` may have come from the overrides, so the derived columns follow it.
        ...(overrides.hash === undefined
          ? { hash: createHash('sha256').update(text).digest('hex') }
          : {}),
      })
    },

    knowledgeItem: (overrides = {}) =>
      repos.knowledgeItems.create({
        lessonId: null,
        topicId: null,
        kind: 'fact',
        fields: { front: `Pregunta ${next()}`, back: 'Respuesta' },
        sourceId: null,
        annotationId: null,
        locator: null,
        asOf: null,
        importance: 'normal',
        // `active` is what puts a card in the queue; `need_to_learn` (the column default)
        // deliberately does not.
        status: 'active',
        createdBy: 'user',
        tags: [],
        ...overrides,
      }),

    card: async (overrides = {}) => {
      const itemId = overrides.itemId ?? (await seeds.knowledgeItem()).id
      return repos.cards.create({
        ...newCardDefaults(overrides.due ?? clock.now()),
        itemId,
        ...overrides,
      })
    },

    reviewLog: async (overrides = {}) => {
      const cardId = overrides.cardId ?? (await seeds.card()).id
      return repos.reviewLogs.append({
        cardId,
        rating: 3,
        state: 2,
        due: clock.now(),
        stability: 5,
        difficulty: 5,
        elapsedDays: 1,
        scheduledDays: 3,
        learningSteps: 0,
        review: clock.now(),
        durationMs: 4200,
        context: 'daily',
        exerciseScore: null,
        device: null,
        attemptId: null,
        algorithmVersion: 'fsrs6',
        ...overrides,
      })
    },

    path: (overrides = {}) =>
      repos.paths.create({
        title: `Camino ${next()}`,
        language: 'es',
        level: null,
        goal: null,
        targetDate: null,
        status: 'draft',
        activeVersion: null,
        sourceIds: [],
        settings: null,
        ...overrides,
      }) as Promise<LearningPath>,

    pathVersion: async (overrides = {}) => {
      const pathId = overrides.pathId ?? (await seeds.path()).id
      return repos.paths.createVersion({
        pathId,
        spec: {},
        knowledgeGraph: null,
        manifest: null,
        diff: null,
        frozenAt: null,
        ...overrides,
      }) as Promise<PathVersion>
    },

    section: async (overrides = {}) => {
      const pathVersionId = overrides.pathVersionId ?? (await seeds.pathVersion()).id
      return repos.paths.createSection({
        pathVersionId,
        ordinal: 0,
        specId: `S${next()}`,
        title: `Sección ${counter}`,
        unlockRule: null,
        xpReward: 0,
        ...overrides,
      }) as Promise<Section>
    },

    module: async (overrides = {}) => {
      const sectionId = overrides.sectionId ?? (await seeds.section()).id
      return repos.paths.createModule({
        sectionId,
        ordinal: 0,
        specId: `M${next()}`,
        title: `Módulo ${counter}`,
        objectives: [],
        diagnosticItemIds: [],
        unlockRule: null,
        xpReward: 0,
        ...overrides,
      }) as Promise<Module>
    },

    lesson: async (overrides = {}) => {
      const moduleId = overrides.moduleId ?? (await seeds.module()).id
      return repos.paths.createLesson({
        moduleId,
        ordinal: 0,
        specId: `L${next()}`,
        kind: 'core',
        parentLessonId: null,
        title: `Lección ${counter}`,
        status: 'ready',
        objectives: [],
        conceptIds: [],
        prerequisiteLessonIds: [],
        estimatedMinutes: null,
        theory: null,
        citations: [],
        qa: null,
        remediation: null,
        unlockRule: null,
        xpReward: 0,
        completedAt: null,
        ...overrides,
      }) as Promise<Lesson>
    },

    activity: async (overrides = {}) => {
      const lessonId =
        overrides.lessonId === undefined ? (await seeds.lesson()).id : overrides.lessonId
      return repos.paths.createActivity({
        lessonId,
        ordinal: 0,
        type: 'mcq_single',
        family: 'choice',
        schemaVersion: 1,
        lang: 'es',
        bloom: 'remember',
        difficulty: 2,
        conceptIds: [],
        misconceptionIds: [],
        config: { stem: 'x', options: [] },
        grading: { strategy: 'deterministic' },
        status: 'ready',
        sourceRefs: [],
        ...overrides,
      }) as Promise<Activity>
    },
  }

  return seeds
}

export const sqliteHarness: RepositoryContractHarness = {
  name: 'sqlite (better-sqlite3)',

  async create(options: HarnessOptions = {}): Promise<ContractContext> {
    const opened: OpenedDatabase = openTestDatabase()
    const clock = testClock()
    const ids = testIds(clock)
    const repos = createRepositories(opened, {
      deviceId: TEST_DEVICE_ID,
      clock,
      ids,
      outboxEnabled: options.outboxEnabled ?? false,
    })

    return {
      repos,
      clock,
      ids,
      seed: createSeeds(repos, clock),
      capabilities: { vectorSearch: opened.vecLoaded, checkConstraints: true },

      /** Embeds every live chunk and writes both vector indexes, in one transaction. */
      embedChunks: async (provider) => {
        const rows = opened.db
          .select({ id: chunks.id, sourceId: chunks.sourceId, text: chunks.text })
          .from(chunks)
          .where(isNull(chunks.deletedAt))
          .all()
        const vectors = await provider.embed(rows.map((row) => row.text))
        const write = opened.sqlite.transaction(() => {
          for (const [index, row] of rows.entries()) {
            insertEmbedding(opened.sqlite, {
              id: ids.next(),
              sourceId: row.sourceId,
              chunkId: row.id,
              modelId: provider.modelId,
              embedding: vectors[index] as Float32Array,
            })
          }
        })
        write()
      },

      /** Every outbox row, synced ones included — straight at the table, so the suites can
       *  assert that draining it appended nothing. */
      listOutbox: async (): Promise<readonly OutboxEntry[]> =>
        (
          opened.db
            .select()
            .from(outbox)
            .orderBy(asc(outbox.createdAt), asc(outbox.id))
            .all() as OutboxRow[]
        ).map(toOutboxEntry),

      /** Straight at the table, bypassing every repository: this is how the suites prove a
       *  soft delete really did not remove anything. */
      countRows: async (table: string) => {
        const row = opened.sqlite
          .prepare<[], { value: number }>(`SELECT count(*) AS value FROM "${table}"`)
          .get()
        return row?.value ?? 0
      },

      dispose: async () => {
        opened.close()
      },
    }
  },
}

type OutboxRow = typeof outbox.$inferSelect

function toOutboxEntry(row: OutboxRow): OutboxEntry {
  return {
    id: row.id,
    tableName: row.tableName,
    rowId: row.rowId,
    op: row.op,
    rowVersion: row.rowVersion,
    payload: row.payload ?? null,
    syncedAt: row.syncedAt === null ? null : new Date(row.syncedAt),
    attempts: row.attempts,
    error: row.error ?? null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    deletedAt: row.deletedAt === null ? null : new Date(row.deletedAt),
    deviceId: row.deviceId,
    version: row.version,
  }
}
