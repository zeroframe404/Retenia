import type { Activity, Clock, ItemBankEntry, ItemUsage } from '@retenia/core'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createItemBankRepos,
  type ItemBankMemoryRepos,
  itemBankWorld,
} from '../testing/item-bank-world'
import { reconcileItemBank } from './reconcile'

/**
 * The other half of the bank's dedupe (`build.ts`'s own header, §14 pitfall 3): a lesson that
 * just finished expansion is checked against the bank the freeze already built, and the
 * lesson always wins.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const clock: Clock = { now: () => NOW }

interface Fixture {
  readonly world: ReturnType<typeof itemBankWorld>
  readonly repos: ItemBankMemoryRepos
}

function setUp(): Fixture {
  const world = itemBankWorld(clock)
  return { world, repos: createItemBankRepos(clock, world.rows) }
}

/** The lesson `L01`'s own activity asks "La memoria de trabajo retiene información breve.";
 *  every "duplicate" scenario reuses that stem in a different case/accent spelling —
 *  normalisation is what makes them the same question. */
const LESSON_STEM_SHOUTED = 'LA MEMORIA DE TRABAJO RETIENE INFORMACION BREVE'

interface BankEntrySeed {
  readonly id: string
  readonly stem: string
  readonly usage: readonly ItemUsage[]
  readonly exposure: number
  readonly moduleId: string | null
}

/** Pushes one item-bank-only activity and its `item_bank` row, the way `build.ts`'s `accept()`
 *  leaves them — `authoring.stem` carries the question, so `readAuthoring` never has to fall
 *  back to the activity's own config. */
function seedBankEntry(fixture: Fixture, seed: BankEntrySeed): void {
  const activity: Activity = {
    id: `${seed.id}-activity`,
    lessonId: null,
    ordinal: null,
    type: 'mcq_single',
    family: 'choice',
    schemaVersion: 1,
    lang: 'es-AR',
    bloom: 'understand',
    difficulty: 2,
    conceptIds: ['c1'],
    misconceptionIds: [],
    config: { prompt: seed.stem },
    grading: { method: 'det' },
    status: 'ready',
    sourceRefs: [],
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    deviceId: 'test',
    version: 1,
  }
  const entry: ItemBankEntry = {
    id: seed.id,
    activityId: activity.id,
    pathVersionId: fixture.world.pathVersionId,
    moduleId: seed.moduleId,
    usage: [...seed.usage],
    difficultyLogit: -0.8,
    discriminationHint: null,
    exposure: seed.exposure,
    stats: { n: 0, p_correct: null },
    authoring: { cell_key: `k-${seed.id}`, stem: seed.stem, misconception_by_option: {} },
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    deviceId: 'test',
    version: 1,
  }
  fixture.repos.rows.activities.push(activity)
  fixture.repos.rows.itemBank.push(entry)
}

function lesson1(fixture: Fixture) {
  const lesson = fixture.repos.rows.lessons.find((row) => row.specId === 'L01')
  if (lesson === undefined) throw new Error('the fixture has no L01')
  return lesson
}

function module1(fixture: Fixture) {
  const module = fixture.repos.rows.modules.find((row) => row.specId === 'M01')
  if (module === undefined) throw new Error('the fixture has no M01')
  return module
}

function inputOf(fixture: Fixture, overrides: { lessonId?: string; lessonSpecId?: string } = {}) {
  return {
    pathVersionId: fixture.world.pathVersionId,
    lessonId: overrides.lessonId ?? lesson1(fixture).id,
    lessonSpecId: overrides.lessonSpecId ?? 'L01',
  }
}

describe('reconcileItemBank() — nothing to do', () => {
  let fixture: Fixture

  beforeEach(() => {
    fixture = setUp()
  })

  it('does nothing when the lesson has no activities', async () => {
    const result = await reconcileItemBank(
      { repos: fixture.repos },
      inputOf(fixture, { lessonId: 'no-such-lesson' }),
    )
    expect(result).toEqual({ dropped: [], restricted: [], warnings: [] })
  })

  it('does nothing when the bank is empty', async () => {
    const result = await reconcileItemBank({ repos: fixture.repos }, inputOf(fixture))
    expect(result).toEqual({ dropped: [], restricted: [], warnings: [] })
  })
})

describe('reconcileItemBank() — a duplicate never shown (exposure 0)', () => {
  it('soft-deletes the item and its activity, and prunes it from the module', async () => {
    const fixture = setUp()
    seedBankEntry(fixture, {
      id: 'bank-1',
      stem: LESSON_STEM_SHOUTED,
      usage: ['diagnostic'],
      exposure: 0,
      moduleId: module1(fixture).id,
    })
    await fixture.repos.paths.updateModule(module1(fixture).id, { diagnosticItemIds: ['bank-1'] })

    const result = await reconcileItemBank({ repos: fixture.repos }, inputOf(fixture))

    expect(result.dropped).toEqual(['bank-1'])
    expect(result.restricted).toEqual([])
    expect(
      result.warnings.some(
        (w) => w.code === 'item_bank_reconciled' && w.params.action === 'dropped',
      ),
    ).toBe(true)

    const item = fixture.repos.rows.itemBank.find((row) => row.id === 'bank-1')
    expect(item?.deletedAt).not.toBeNull()
    const activity = fixture.repos.rows.activities.find((row) => row.id === 'bank-1-activity')
    expect(activity?.deletedAt).not.toBeNull()

    const module = module1(fixture)
    expect(module.diagnosticItemIds).not.toContain('bank-1')
  })
})

describe('reconcileItemBank() — a duplicate already exposed', () => {
  it("restricts usage to ['diagnostic'] when exposed with other usages alongside it", async () => {
    const fixture = setUp()
    seedBankEntry(fixture, {
      id: 'bank-2',
      stem: LESSON_STEM_SHOUTED,
      usage: ['diagnostic', 'reinforcement'],
      exposure: 3,
      moduleId: module1(fixture).id,
    })

    const result = await reconcileItemBank({ repos: fixture.repos }, inputOf(fixture))

    expect(result.restricted).toEqual(['bank-2'])
    expect(result.dropped).toEqual([])
    expect(
      result.warnings.some(
        (w) => w.code === 'item_bank_reconciled' && w.params.action === 'restricted',
      ),
    ).toBe(true)
    const item = fixture.repos.rows.itemBank.find((row) => row.id === 'bank-2')
    expect(item?.usage).toEqual(['diagnostic'])
    expect(item?.deletedAt).toBeNull()
  })

  it("leaves an exposed item untouched when its usage is already only ['diagnostic']", async () => {
    const fixture = setUp()
    seedBankEntry(fixture, {
      id: 'bank-3',
      stem: LESSON_STEM_SHOUTED,
      usage: ['diagnostic'],
      exposure: 5,
      moduleId: module1(fixture).id,
    })

    const result = await reconcileItemBank({ repos: fixture.repos }, inputOf(fixture))

    expect(result.dropped).toEqual([])
    expect(result.restricted).toEqual([])
    expect(result.warnings).toEqual([])
    const item = fixture.repos.rows.itemBank.find((row) => row.id === 'bank-3')
    expect(item?.usage).toEqual(['diagnostic'])
    expect(item?.deletedAt).toBeNull()
  })

  it("drops an exposed item that never carried 'diagnostic' usage", async () => {
    const fixture = setUp()
    seedBankEntry(fixture, {
      id: 'bank-4',
      stem: LESSON_STEM_SHOUTED,
      usage: ['reinforcement', 'remediation'],
      exposure: 2,
      moduleId: module1(fixture).id,
    })

    const result = await reconcileItemBank({ repos: fixture.repos }, inputOf(fixture))

    expect(result.dropped).toEqual(['bank-4'])
    expect(result.restricted).toEqual([])
    const item = fixture.repos.rows.itemBank.find((row) => row.id === 'bank-4')
    expect(item?.deletedAt).not.toBeNull()
  })
})

describe('reconcileItemBank() — what it leaves alone', () => {
  it('leaves a non-duplicate item untouched', async () => {
    const fixture = setUp()
    seedBankEntry(fixture, {
      id: 'bank-5',
      stem: 'Una pregunta completamente distinta sobre otra cosa',
      usage: ['diagnostic'],
      exposure: 0,
      moduleId: module1(fixture).id,
    })

    const result = await reconcileItemBank({ repos: fixture.repos }, inputOf(fixture))

    expect(result).toEqual({ dropped: [], restricted: [], warnings: [] })
    const item = fixture.repos.rows.itemBank.find((row) => row.id === 'bank-5')
    expect(item?.deletedAt).toBeNull()
    expect(item?.usage).toEqual(['diagnostic'])
  })

  it('ignores a bank item with empty usage even when its stem duplicates the lesson', async () => {
    const fixture = setUp()
    seedBankEntry(fixture, {
      id: 'bank-6',
      stem: LESSON_STEM_SHOUTED,
      usage: [],
      exposure: 0,
      moduleId: module1(fixture).id,
    })

    const result = await reconcileItemBank({ repos: fixture.repos }, inputOf(fixture))

    expect(result).toEqual({ dropped: [], restricted: [], warnings: [] })
    const item = fixture.repos.rows.itemBank.find((row) => row.id === 'bank-6')
    expect(item?.deletedAt).toBeNull()
  })
})
