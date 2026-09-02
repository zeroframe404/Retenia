import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ContractContext, RepositoryContractHarness } from '../harness'

/**
 * Blobs — the one table where a hard delete is legal.
 *
 * Everywhere else "no hard deletes" is absolute; here an unreferenced blob is garbage
 * rather than history, and leaving it would grow `userData` without bound. The guard is
 * that garbage collection refuses anything still referenced.
 */
export function blobsContract(harness: RepositoryContractHarness): void {
  describe('blobs and garbage collection', () => {
    let ctx: ContractContext
    beforeEach(async () => {
      ctx = await harness.create()
    })
    afterEach(async () => {
      await ctx.dispose()
    })

    async function blob(sha256: string) {
      return ctx.repos.blobs.create({
        sha256,
        mime: 'application/pdf',
        bytes: 1024,
        ext: 'pdf',
        originalName: 'libro.pdf',
        meta: null,
      })
    }

    it('finds a blob by its content hash', async () => {
      const created = await blob('a'.repeat(64))
      expect((await ctx.repos.blobs.findBySha256('a'.repeat(64)))?.id).toBe(created.id)
    })

    it('lists a blob nothing references', async () => {
      await blob('b'.repeat(64))
      const unreferenced = await ctx.repos.blobs.listUnreferenced()
      expect(unreferenced.map((entry) => entry.sha256)).toEqual(['b'.repeat(64)])
    })

    it('does not list a blob a live source points at', async () => {
      const sha = 'c'.repeat(64)
      await blob(sha)
      await ctx.seed.source({ blobSha256: sha })
      expect(await ctx.repos.blobs.listUnreferenced()).toEqual([])
    })

    it('lists it again once the source is gone', async () => {
      const sha = 'd'.repeat(64)
      await blob(sha)
      const source = await ctx.seed.source({ blobSha256: sha })
      await ctx.repos.sources.softDelete(source.id)
      expect(await ctx.repos.blobs.listUnreferenced()).toHaveLength(1)
    })

    it('hard-deletes an unreferenced blob — the one place a row really leaves', async () => {
      const sha = 'e'.repeat(64)
      await blob(sha)
      expect(await ctx.countRows('blobs')).toBe(1)

      const removed = await ctx.repos.blobs.collectGarbage([sha])

      expect(removed).toBe(1)
      expect(await ctx.countRows('blobs')).toBe(0)
    })

    it('refuses to collect a blob a live source still points at', async () => {
      const sha = 'f'.repeat(64)
      await blob(sha)
      await ctx.seed.source({ blobSha256: sha })

      await expect(ctx.repos.blobs.collectGarbage([sha])).rejects.toThrow()
      expect(await ctx.countRows('blobs')).toBe(1)
    })

    it('collects nothing for an empty list', async () => {
      await blob('1'.repeat(64))
      expect(await ctx.repos.blobs.collectGarbage([])).toBe(0)
      expect(await ctx.countRows('blobs')).toBe(1)
    })
  })
}
