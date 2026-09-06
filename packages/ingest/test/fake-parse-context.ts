import { createHash } from 'node:crypto'
import type { ParseContext } from '../src/parse-context'
import type { Asset, AssetKind } from '../src/source-doc'

/**
 * A `ParseContext` with no filesystem: ids are deterministic (`id-0`, `id-1`, …) and
 * `putAsset` "stores" bytes by hashing them, so parser tests can assert on `SourceDoc`
 * without a real blob store or the non-determinism a real UUIDv7 would add to a snapshot.
 */
export function createFakeParseContext(): ParseContext & { assets: Map<string, Uint8Array> } {
  let counter = 0
  const assets = new Map<string, Uint8Array>()

  return {
    assets,
    id: () => `id-${counter++}`,
    putAsset: async (bytes: Uint8Array, mime: string, kind: AssetKind): Promise<Asset> => {
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      assets.set(sha256, bytes)
      return { id: `asset-${assets.size - 1}`, blobSha256: sha256, mime, kind }
    },
  }
}
