import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenedDatabase } from '../open-database'
import { openTestDatabase, TEST_DEVICE_ID, testClock, testIds } from '../testing'
import { createRepositories } from './index'

/**
 * The `annotations` repository (sub-phase 6.6): highlight persistence round-trip and the
 * reading-progress columns on `sources`. `docs/spec/07a-schema.md` "Source library" is the
 * schema this exercises.
 */

async function seedSource(repos: ReturnType<typeof createRepositories>) {
  return repos.sources.create({
    kind: 'pdf',
    title: 'Fisiología',
    originUri: null,
    blobSha256: null,
    status: 'ready',
    language: 'es',
    meta: null,
    error: null,
    ingestedAt: null,
    embeddingStatus: 'pending',
    embeddingModelId: null,
    embeddingError: null,
    lastLocator: null,
    lastOpenedAt: null,
  })
}

describe('annotation repository', () => {
  let opened: OpenedDatabase
  let repos: ReturnType<typeof createRepositories>
  const clock = testClock()

  beforeEach(() => {
    opened = openTestDatabase()
    repos = createRepositories(opened, { deviceId: TEST_DEVICE_ID, clock, ids: testIds(clock) })
  })
  afterEach(() => opened.close())

  it('persists a highlight and reads it back with its anchor intact', async () => {
    const source = await seedSource(repos)
    const created = await repos.annotations.create({
      sourceId: source.id,
      unitId: null,
      kind: 'highlight',
      anchor: { page: 12, rects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.05 }] },
      quote: 'La consolidación ocurre durante el sueño',
      note: null,
      color: 'yellow',
      tStart: null,
      tEnd: null,
    })

    const found = await repos.annotations.findById(created.id)
    expect(found).toEqual(created)
    expect(found?.anchor).toEqual({
      page: 12,
      rects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.05 }],
    })
    expect(found?.quote).toBe('La consolidación ocurre durante el sueño')
  })

  it('survives a reopen of the database (the durability half of "highlights survive restart")', async () => {
    const source = await seedSource(repos)
    const created = await repos.annotations.create({
      sourceId: source.id,
      unitId: null,
      kind: 'highlight',
      anchor: { page: 3, rects: [] },
      quote: 'texto resaltado',
      note: null,
      color: 'green',
      tStart: null,
      tEnd: null,
    })

    // A fresh repository set over the *same* connection stands in for "closed and reopened":
    // the row has to come from the table, not from any in-process cache.
    const reopened = createRepositories(opened, {
      deviceId: TEST_DEVICE_ID,
      clock,
      ids: testIds(clock),
    })
    const found = await reopened.annotations.findById(created.id)
    expect(found?.anchor).toEqual({ page: 3, rects: [] })
  })

  it('lists a source’s annotations in creation order and excludes another source’s', async () => {
    const source = await seedSource(repos)
    const other = await seedSource(repos)
    const first = await repos.annotations.create({
      sourceId: source.id,
      unitId: null,
      kind: 'highlight',
      anchor: { page: 1, rects: [] },
      quote: null,
      note: null,
      color: null,
      tStart: null,
      tEnd: null,
    })
    clock.advance(1_000)
    const second = await repos.annotations.create({
      sourceId: source.id,
      unitId: null,
      kind: 'note',
      anchor: { page: 2, rects: [] },
      quote: null,
      note: 'recordar esto',
      color: null,
      tStart: null,
      tEnd: null,
    })
    await repos.annotations.create({
      sourceId: other.id,
      unitId: null,
      kind: 'highlight',
      anchor: { page: 1, rects: [] },
      quote: null,
      note: null,
      color: null,
      tStart: null,
      tEnd: null,
    })

    const list = await repos.annotations.listBySource(source.id)
    expect(list.map((a) => a.id)).toEqual([first.id, second.id])
  })

  it('soft-deletes without a hard DELETE, and restore brings it back', async () => {
    const source = await seedSource(repos)
    const created = await repos.annotations.create({
      sourceId: source.id,
      unitId: null,
      kind: 'highlight',
      anchor: { page: 1, rects: [] },
      quote: null,
      note: null,
      color: null,
      tStart: null,
      tEnd: null,
    })

    await repos.annotations.softDelete(created.id)
    expect(await repos.annotations.findById(created.id)).toBeUndefined()
    expect(
      (await repos.annotations.findById(created.id, { includeDeleted: true }))?.deletedAt,
    ).not.toBeNull()

    await repos.annotations.restore(created.id)
    expect((await repos.annotations.findById(created.id))?.deletedAt).toBeNull()
  })
})

describe('source reading progress (sub-phase 6.6)', () => {
  let opened: OpenedDatabase
  let repos: ReturnType<typeof createRepositories>
  const clock = testClock()

  beforeEach(() => {
    opened = openTestDatabase()
    repos = createRepositories(opened, { deviceId: TEST_DEVICE_ID, clock, ids: testIds(clock) })
  })
  afterEach(() => opened.close())

  it('starts with no locator and no recently-opened sources', async () => {
    const source = await seedSource(repos)
    expect(source.lastLocator).toBeNull()
    expect(source.lastOpenedAt).toBeNull()
    expect(await repos.sources.listRecentlyOpened(10)).toEqual([])
  })

  it('records a locator and surfaces the source as recently opened', async () => {
    const source = await seedSource(repos)
    const at = clock.now()
    const updated = await repos.sources.recordProgress(source.id, { page: 12 }, at)

    expect(updated.lastLocator).toEqual({ page: 12 })
    expect(updated.lastOpenedAt?.getTime()).toBe(at.getTime())

    const recent = await repos.sources.listRecentlyOpened(10)
    expect(recent.map((s) => s.id)).toEqual([source.id])
  })

  it('orders recently-opened sources most-recent-first', async () => {
    const first = await seedSource(repos)
    const second = await seedSource(repos)

    await repos.sources.recordProgress(first.id, { page: 1 }, clock.now())
    clock.advance(60_000)
    await repos.sources.recordProgress(second.id, { cfi: 'epubcfi(/6/4!/4/2)' }, clock.now())

    const recent = await repos.sources.listRecentlyOpened(10)
    expect(recent.map((s) => s.id)).toEqual([second.id, first.id])
  })

  it('a later locator overwrites the earlier one for the same source', async () => {
    const source = await seedSource(repos)
    await repos.sources.recordProgress(source.id, { page: 1 }, clock.now())
    clock.advance(1_000)
    const updated = await repos.sources.recordProgress(source.id, { page: 12 }, clock.now())

    expect(updated.lastLocator).toEqual({ page: 12 })
    expect(await repos.sources.listRecentlyOpened(10)).toHaveLength(1)
  })
})
