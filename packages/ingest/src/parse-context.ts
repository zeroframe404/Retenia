import type { Asset, AssetKind } from './source-doc'

/**
 * What a parser is handed besides the bytes it is parsing: id minting and asset persistence,
 * kept behind an interface so every parser in `src/parsers/` is unit-testable against an
 * in-memory fake rather than a real blob store.
 *
 * The job definition that actually runs a parser (`apps/desktop/src/jobs/ingest-parse.ts`)
 * supplies the real implementation, backed by `createFsBlobStore` — the only place in this
 * package that touches a concrete filesystem path.
 */
export interface ParseContext {
  /** A fresh UUIDv7, for a block/section/asset id. */
  id(): string
  /** Persists bytes (a rendered page thumbnail, an embedded figure) and returns the asset
   *  record `SourceDoc.assets` should carry. */
  putAsset(bytes: Uint8Array, mime: string, kind: AssetKind): Promise<Asset>
  /** Structured warnings a parser wants surfaced without failing the whole parse. */
  warn?(message: string): void
}
