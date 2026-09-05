import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type {
  BlobStore,
  Job,
  JobScheduler,
  JsonObject,
  ListOptions,
  Source,
  SourceStatus,
  UnitOfWork,
} from '@retenia/core'
import type { SourceDoc } from '@retenia/ingest'
import type { IngestParseResult } from '../../jobs/ingest-parse'
import { detectSource } from './detect-kind'

/**
 * The source library: importing a file or pasted text, watching it through
 * `ingestParseSource`, and reading back what the parse found (sub-phase 6.1).
 *
 * Mirrors `main/memory/optimizer-service.ts`'s shape — a job the worker runs, a main-process
 * service that owns applying its result — with one difference: an optimization needs a
 * human's "apply" decision (§16's health check can reject it), so that step is a separate,
 * explicit call. A parse has no such judgement to make; `onJobSettled` applies it the moment
 * the job the runner reports it, with no user action in between.
 */

const JOB_KIND = 'ingestParseSource'

export interface LibraryService {
  addFromFile(path: string, originalName?: string): Promise<Source>
  addFromText(text: string, title: string): Promise<Source>
  /** Re-enqueues the same parse for a `failed` (or stuck) source. */
  retry(sourceId: string): Promise<Source>
  list(options?: { statuses?: SourceStatus[] } & ListOptions): Promise<Source[]>
  get(id: string): Promise<Source | undefined>
  /** The parser's own output, once ready — `undefined` before the first successful parse. */
  getDoc(id: string): Promise<SourceDoc | undefined>
  remove(id: string): Promise<void>
  /** Wired into `createJobRunner`'s `onSettled`; a no-op for any job that is not one of ours. */
  onJobSettled(job: Job): Promise<void>
}

export interface LibraryServiceOptions {
  repos: UnitOfWork
  blobStore: BlobStore
  scheduler: JobScheduler
}

export function createLibraryService({
  repos,
  blobStore,
  scheduler,
}: LibraryServiceOptions): LibraryService {
  const enqueueParse = (source: Source): Promise<Job> =>
    scheduler.enqueue(
      JOB_KIND,
      {
        sourceId: source.id,
        // `blobSha256`/`kind` are validated non-null by `addFromFile`/`addFromText`/`retry`
        // before this is ever called — every source this service creates has both.
        blobSha256: source.blobSha256 as string,
        ext: null,
        kind: source.kind,
        title: source.title,
      },
      { subjectId: source.id },
    )

  const addBytes = async (
    bytes: Uint8Array,
    mime: string,
    kind: Source['kind'],
    title: string,
    originUri: string | null,
  ): Promise<Source> => {
    const put = await blobStore.put(bytes, mime)
    const source = await repos.sources.create({
      kind,
      title,
      originUri,
      blobSha256: put.sha256,
      status: 'pending',
      language: null,
      meta: null,
      error: null,
      ingestedAt: null,
    })
    await enqueueParse(source)
    return source
  }

  return {
    addFromFile: async (path, originalName) => {
      const name = originalName ?? basename(path)
      const { kind, mime } = detectSource(name)
      const bytes = await readFile(path)
      return addBytes(new Uint8Array(bytes), mime, kind, name, `file://${path}`)
    },

    addFromText: async (text, title) =>
      addBytes(new TextEncoder().encode(text), 'text/plain', 'text', title, null),

    retry: async (sourceId) => {
      const source = await repos.sources.findById(sourceId)
      if (source === undefined) throw new Error(`No source ${sourceId}`)
      if (source.blobSha256 === null) {
        throw new Error(`Source ${sourceId} has no stored file to re-parse`)
      }
      const reset = await repos.sources.update(sourceId, { status: 'pending', error: null })
      await enqueueParse(reset)
      return reset
    },

    list: async (options) => {
      const statuses = options?.statuses
      if (statuses === undefined || statuses.length === 0) return repos.sources.list(options)
      if (statuses.length === 1) {
        // biome-ignore lint/style/noNonNullAssertion: length just checked
        return repos.sources.listByStatus(statuses[0]!, options)
      }
      // `SourceRepository` only filters by one status at a time; more than one is rare
      // enough (a handful of sources, not thousands) that filtering in memory here beats
      // the complexity of a multi-status repository query.
      const all = await repos.sources.list(options)
      return all.filter((source) => statuses.includes(source.status))
    },

    get: (id) => repos.sources.findById(id),

    getDoc: async (id) => {
      const source = await repos.sources.findById(id)
      const sha256 = (source?.meta as { sourceDocBlobSha256?: string } | null)?.sourceDocBlobSha256
      if (sha256 === undefined) return undefined
      const bytes = await blobStore.get(sha256, 'json')
      return JSON.parse(new TextDecoder().decode(bytes)) as SourceDoc
    },

    remove: async (id) => {
      await repos.sources.softDelete(id)
    },

    onJobSettled: async (job) => {
      if (job.kind !== JOB_KIND || job.subjectId === null) return
      const sourceId = job.subjectId

      if (job.status === 'succeeded' && job.result !== null) {
        const result = job.result as unknown as IngestParseResult
        const meta: JsonObject = {
          sourceDocBlobSha256: result.sourceDocBlobSha256,
          blockCount: result.blockCount,
          assetCount: result.assetCount,
          needsOcr: result.needsOcr,
          ocrPages: result.ocrPages,
          warnings: result.warnings,
        }
        await repos.sources.update(sourceId, { language: result.language, meta })
        await repos.sources.markIngested(sourceId, new Date())
        return
      }

      if (job.status === 'failed' || job.status === 'cancelled') {
        await repos.sources.markFailed(sourceId, job.error ?? 'Parsing failed')
      }
    },
  }
}
