import { makeHttpEpubLoader } from './epub-loader'
import { EPUB } from './vendor/foliate-js/epub.js'

/**
 * A parsed EPUB, plus the HTTP zip loader underneath it — `EPUB.destroy()` only tears down
 * foliate-js's own internal caches, never the loader it was constructed with, so both have to
 * be closed for real cleanup (`epub-reader.tsx`'s unmount/`src`-change effect).
 */
export interface EpubBook {
  book: EPUB
  destroy(): Promise<void>
}

/** Opens an EPUB from a `media://blob/<sha256>.epub` URL (Range-served by
 *  `apps/desktop/src/main/protocol/media-protocol.ts`, same as the PDF reader's `src`). */
export async function openEpubBook(src: string): Promise<EpubBook> {
  const loader = makeHttpEpubLoader(src)
  const book = await new EPUB(loader).init()
  return {
    book,
    destroy: async () => {
      book.destroy()
      await loader.destroy()
    },
  }
}
