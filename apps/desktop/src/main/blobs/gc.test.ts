import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Blob, BlobRepository } from '@retenia/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logging/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { collectBlobGarbage } = await import('./gc')
const { createFsBlobStore } = await import('./store')

function blob(overrides: Partial<Blob>): Blob {
  return {
    id: overrides.id ?? 'b1',
    sha256: 'a'.repeat(64),
    mime: 'text/plain',
    bytes: 10,
    ext: 'txt',
    originalName: null,
    meta: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deviceId: 'device-1',
    version: 1,
    ...overrides,
  }
}

function fakeBlobRepo(unreferenced: Blob[]): BlobRepository {
  return {
    findById: vi.fn(),
    findMany: vi.fn(),
    list: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    save: vi.fn(),
    softDelete: vi.fn(),
    restore: vi.fn(),
    findBySha256: vi.fn(),
    listUnreferenced: vi.fn(async () => unreferenced),
    collectGarbage: vi.fn(async (shas: readonly string[]) => shas.length),
  } as unknown as BlobRepository
}

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'retenia-blobs-gc-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('collectBlobGarbage', () => {
  it('dry run reports candidates without touching the row or the file', async () => {
    const store = createFsBlobStore(root)
    const { sha256 } = await store.put(Buffer.from('orphan'), 'text/plain')
    const repo = fakeBlobRepo([blob({ sha256, bytes: 6, ext: 'txt' })])

    const result = await collectBlobGarbage(repo, store, { dryRun: true })

    expect(result).toEqual({ candidates: [{ sha256, bytes: 6 }], collected: [], bytesFreed: 0 })
    expect(repo.collectGarbage).not.toHaveBeenCalled()
    expect(await store.has(sha256, 'txt')).toBe(true)
  })

  it('a real run drops the row and deletes the file, reporting bytes freed', async () => {
    const store = createFsBlobStore(root)
    const { sha256 } = await store.put(Buffer.from('orphan bytes'), 'text/plain')
    const repo = fakeBlobRepo([blob({ sha256, bytes: 12, ext: 'txt' })])

    const result = await collectBlobGarbage(repo, store, { dryRun: false })

    expect(repo.collectGarbage).toHaveBeenCalledWith([sha256])
    expect(result).toEqual({
      candidates: [{ sha256, bytes: 12 }],
      collected: [sha256],
      bytesFreed: 12,
    })
    expect(await store.has(sha256, 'txt')).toBe(false)
  })

  it('does nothing when there is no garbage', async () => {
    const store = createFsBlobStore(root)
    const repo = fakeBlobRepo([])

    const result = await collectBlobGarbage(repo, store, { dryRun: false })

    expect(result).toEqual({ candidates: [], collected: [], bytesFreed: 0 })
    expect(repo.collectGarbage).not.toHaveBeenCalled()
  })

  it('a stubborn file delete does not abort the rest of the batch', async () => {
    const store = createFsBlobStore(root)
    const ok = await store.put(Buffer.from('ok bytes'), 'text/plain')
    const stuck = blob({ id: 'b2', sha256: 'f'.repeat(64), bytes: 5, ext: 'txt' })
    const repo = fakeBlobRepo([blob({ sha256: ok.sha256, bytes: ok.bytes, ext: 'txt' }), stuck])
    const failingStore = {
      ...store,
      delete: vi.fn(async (sha256: string, ext?: string | null) => {
        if (sha256 === stuck.sha256) throw new Error('EBUSY: file is locked')
        return store.delete(sha256, ext)
      }),
    }

    const result = await collectBlobGarbage(repo, failingStore, { dryRun: false })

    // Both rows are dropped regardless (the hard delete already happened); only the file
    // that actually deleted counts toward `collected`/`bytesFreed` — the stuck one is
    // logged as a leak rather than thrown, so the rest of the batch is not abandoned.
    expect(repo.collectGarbage).toHaveBeenCalledWith([ok.sha256, stuck.sha256])
    expect(result.collected).toEqual([ok.sha256])
    expect(result.bytesFreed).toBe(ok.bytes)
  })
})
