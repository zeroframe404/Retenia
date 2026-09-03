import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BlobStore } from '@retenia/core'
import { extForMime } from './mime'

/**
 * The filesystem half of the blob store: `<root>/<sha256[0:2]>/<sha256>.<ext>`
 * (`docs/spec/07-architecture.md` §5). `../../db/open.ts`'s `BlobRepository` is the SQLite
 * index over the same shas; this is what actually holds the bytes.
 *
 * Windows-safe by construction: `path.join` throughout, no path segment ever comes from
 * caller-controlled input except the sha256 (hex only, fixed length) and a mime-derived
 * extension drawn from a fixed allowlist (`./mime.ts`) — never from a client-supplied
 * filename.
 */

function shardDir(root: string, sha256: string): string {
  return join(root, sha256.slice(0, 2))
}

function fileName(sha256: string, ext?: string | null): string {
  return ext ? `${sha256}.${ext}` : sha256
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

export function createFsBlobStore(root: string): BlobStore {
  function pathFor(sha256: string, ext?: string | null): string {
    return join(shardDir(root, sha256), fileName(sha256, ext))
  }

  return {
    async put(input, mime) {
      await mkdir(root, { recursive: true })
      // Written next to (not inside) the final shard directory: the sha, and therefore the
      // shard, is only known once hashing finishes. Staying under `root` keeps the eventual
      // rename on one filesystem, which is what makes it atomic.
      const tmpPath = join(root, `.tmp-${randomBytes(16).toString('hex')}`)
      const hash = createHash('sha256')
      let bytes = 0

      try {
        if (input instanceof Uint8Array) {
          hash.update(input)
          bytes = input.byteLength
          await writeFile(tmpPath, input)
        } else {
          const ws = createWriteStream(tmpPath)
          try {
            for await (const chunk of input) {
              hash.update(chunk)
              bytes += chunk.byteLength
              if (!ws.write(chunk)) {
                await once(ws, 'drain')
              }
            }
            ws.end()
            await once(ws, 'finish')
          } catch (error) {
            ws.destroy()
            throw error
          }
        }

        const sha256 = hash.digest('hex')
        const ext = extForMime(mime)
        const destDir = shardDir(root, sha256)
        const dest = join(destDir, fileName(sha256, ext))

        await mkdir(destDir, { recursive: true })
        // Dedupe: identical bytes hash the same, so a file already at `dest` means some
        // earlier `put` (of these same bytes) already won — discard this write rather than
        // clobber it, so two callers racing to store the same blob never corrupt a
        // half-written file.
        if (await exists(dest)) {
          await rm(tmpPath, { force: true })
        } else {
          await rename(tmpPath, dest)
        }

        return { sha256, bytes, mime, ext }
      } catch (error) {
        await rm(tmpPath, { force: true }).catch(() => {})
        throw error
      }
    },

    async has(sha256, ext) {
      return exists(pathFor(sha256, ext))
    },

    path(sha256, ext) {
      return pathFor(sha256, ext)
    },

    async get(sha256, ext) {
      return new Uint8Array(await readFile(pathFor(sha256, ext)))
    },

    async delete(sha256, ext) {
      try {
        await unlink(pathFor(sha256, ext))
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
    },
  }
}
