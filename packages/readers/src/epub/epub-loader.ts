import { BlobWriter, configure, HttpReader, TextWriter, ZipReader } from '@zip.js/zip.js'
import type { EpubLoader } from './vendor/foliate-js/epub.js'

/**
 * The `{ loadText, loadBlob, getSize }` loader `vendor/foliate-js/epub.js`'s `EPUB` needs,
 * built over a `media://blob/<sha>.epub` URL rather than over a `File`/`Blob` the way
 * foliate-js's own demo (`makeZipLoader` in its `view.js`) does it.
 *
 * `HttpReader` with `useRangeHeader: true` reads the zip's central directory and each
 * requested entry with byte-range `GET`s instead of downloading the whole file first — the
 * "with Range support" half of the reader spec, matching how `PdfReader` streams a PDF from
 * the same protocol (`apps/desktop/src/main/protocol/media-protocol.ts` already serves Range
 * for both). `preventHeadRequest: true` because `media://` never sets `Accept-Ranges`/
 * `Content-Length` on a `HEAD` the way a real HTTP server would — it answers the size from a
 * ranged `GET` instead, which is exactly the fallback this flag opts into.
 *
 * A fresh `ZipReader` per `EPUB` instance: closing it (`EpubLoader.destroy`, called from
 * `EPUB.destroy()` — see `epub-reader.tsx`) releases the connection so switching sources does
 * not leak one `HttpReader` per open source.
 */
export interface HttpEpubLoader extends EpubLoader {
  /** Closes the underlying `ZipReader`. Call when the reader unmounts or switches sources. */
  destroy(): Promise<void>
}

let configured = false

export function makeHttpEpubLoader(url: string): HttpEpubLoader {
  // zip.js spins up a Web Worker pool by default; `useWebWorkers: false` keeps everything on
  // this thread, which is simpler to reason about for files in the tens-of-MB range an EPUB
  // typically is, and avoids a CSP/worker-script question `docs/spec/07-architecture.md` §4's
  // checklist would otherwise have to answer for a bundled worker.
  if (!configured) {
    configure({ useWebWorkers: false })
    configured = true
  }

  const reader = new HttpReader(url, { useRangeHeader: true, preventHeadRequest: true })
  const zip = new ZipReader(reader)
  let entries: Map<string, Awaited<ReturnType<ZipReader<unknown>['getEntries']>>[number]> | null =
    null

  async function getEntries() {
    if (entries === null) {
      const list = await zip.getEntries()
      entries = new Map(list.map((entry) => [entry.filename, entry]))
    }
    return entries
  }

  return {
    loadText: async (href) => {
      const entry = (await getEntries()).get(href)
      if (entry === undefined || entry.directory) return null
      return entry.getData(new TextWriter())
    },
    loadBlob: async (href) => {
      const entry = (await getEntries()).get(href)
      if (entry === undefined || entry.directory) return null
      return entry.getData(new BlobWriter())
    },
    getSize: (href) => {
      // Synchronous by the `EpubLoader` contract, so this only ever answers once `getEntries`
      // has already been awaited elsewhere (`EPUB.init()` always reads the OPF's own `loadText`
      // first, which does exactly that) — a size asked for before then reads as `0`, exactly
      // as it would for a filename the archive does not have.
      return entries?.get(href)?.uncompressedSize ?? 0
    },
    destroy: () => zip.close(),
  }
}
