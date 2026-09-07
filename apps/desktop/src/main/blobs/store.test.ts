import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFsBlobStore } from './store'

let root: string

/**
 * Temp files left by a failed `put` are only observable once the write stream's pending
 * `open()` has settled, so give the event loop a few turns before looking. Without this,
 * a leaked file created a tick after the rejection would slip past the assertion.
 */
async function tmpFilesAfterSettling(): Promise<string[]> {
  await delay(25)
  return readdirSync(root).filter((name) => name.startsWith('.tmp-'))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'retenia-blobs-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('createFsBlobStore', () => {
  it('writes a buffer under <root>/<sha[0:2]>/<sha>.<ext>, keyed by content', async () => {
    const store = createFsBlobStore(root)
    const bytes = Buffer.from('hello retenia')
    const expectedSha = createHash('sha256').update(bytes).digest('hex')

    const result = await store.put(bytes, 'text/plain')

    expect(result).toEqual({
      sha256: expectedSha,
      bytes: bytes.byteLength,
      mime: 'text/plain',
      ext: 'txt',
    })
    const dest = join(root, expectedSha.slice(0, 2), `${expectedSha}.txt`)
    expect(readFileSync(dest)).toEqual(bytes)
  })

  it('two identical files produce one blob (dedupe)', async () => {
    const store = createFsBlobStore(root)
    const bytes = Buffer.from('duplicate content')

    const first = await store.put(bytes, 'image/png')
    const second = await store.put(Buffer.from(bytes), 'image/png')

    expect(second.sha256).toBe(first.sha256)
    // No leftover temp files from either write.
    const shard = join(root, first.sha256.slice(0, 2))
    expect(readdirSync(shard)).toEqual([`${first.sha256}.png`])
  })

  it('streams an async-iterable input and hashes it while writing', async () => {
    const store = createFsBlobStore(root)
    async function* chunks(): AsyncGenerator<Uint8Array> {
      yield new TextEncoder().encode('chunk one ')
      yield new TextEncoder().encode('chunk two')
    }
    const expectedSha = createHash('sha256').update('chunk one chunk two').digest('hex')

    const result = await store.put(chunks(), 'text/plain')

    expect(result.sha256).toBe(expectedSha)
    expect(result.bytes).toBe('chunk one chunk two'.length)
    expect(await store.has(expectedSha, 'txt')).toBe(true)
  })

  it('has/get/path/delete round-trip', async () => {
    const store = createFsBlobStore(root)
    const bytes = Buffer.from('round trip me')
    const { sha256 } = await store.put(bytes, 'application/pdf')

    expect(await store.has(sha256, 'pdf')).toBe(true)
    expect(await store.get(sha256, 'pdf')).toEqual(new Uint8Array(bytes))
    expect(store.path(sha256, 'pdf')).toBe(join(root, sha256.slice(0, 2), `${sha256}.pdf`))

    await store.delete(sha256, 'pdf')
    expect(await store.has(sha256, 'pdf')).toBe(false)
  })

  it('deleting a blob that does not exist is a no-op', async () => {
    const store = createFsBlobStore(root)
    await expect(store.delete('a'.repeat(64), 'txt')).resolves.toBeUndefined()
  })

  it('falls back to an extensionless path for an unknown mime type', async () => {
    const store = createFsBlobStore(root)
    const result = await store.put(Buffer.from('mystery bytes'), 'application/x-retenia-mystery')

    expect(result.ext).toBeNull()
    expect(existsSync(join(root, result.sha256.slice(0, 2), result.sha256))).toBe(true)
  })

  it('leaves no temp file behind when the write fails', async () => {
    const store = createFsBlobStore(root)
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield new TextEncoder().encode('partial')
      throw new Error('boom')
    }

    await expect(store.put(failing(), 'text/plain')).rejects.toThrow('boom')

    expect(await tmpFilesAfterSettling()).toEqual([])
  })

  // The source throws while the stream's lazy `open()` is still pending — `for await` only
  // drains microtasks, so no chunk ever reaches the file descriptor however many are
  // yielded. Cleanup that does not wait for the stream to close removes nothing, and the
  // open then creates the temp file behind it.
  it('leaves no temp file behind when the write fails with the open still pending', async () => {
    const store = createFsBlobStore(root)
    async function* failing(): AsyncGenerator<Uint8Array> {
      for (let i = 0; i < 8; i++) {
        yield new TextEncoder().encode(`chunk ${i} `)
      }
      throw new Error('boom')
    }

    await expect(store.put(failing(), 'text/plain')).rejects.toThrow('boom')

    expect(await tmpFilesAfterSettling()).toEqual([])
  })

  it('leaves no temp file behind when the write fails before any chunk is yielded', async () => {
    const store = createFsBlobStore(root)
    // Not a generator: one that only throws would have no `yield` for Biome's `useYield`.
    const failing: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new Error('boom')),
      }),
    }

    await expect(store.put(failing, 'text/plain')).rejects.toThrow('boom')

    expect(await tmpFilesAfterSettling()).toEqual([])
  })

  // Cleanup that races the open leaks only when `rm` happens to win, which on an idle
  // machine it usually does not. Enough concurrent failures to contend for libuv's thread
  // pool makes at least one leak overwhelmingly likely, so this is the case that actually
  // holds the fix in place.
  it('leaves no temp file behind under many concurrent failing writes', async () => {
    const store = createFsBlobStore(root)
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield new TextEncoder().encode('partial')
      throw new Error('boom')
    }

    const writes = Array.from({ length: 96 }, () =>
      expect(store.put(failing(), 'text/plain')).rejects.toThrow('boom'),
    )
    await Promise.all(writes)

    expect(await tmpFilesAfterSettling()).toEqual([])
  })
})
