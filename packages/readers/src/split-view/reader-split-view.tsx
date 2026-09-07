import { SplitPane } from '@retenia/ui'
import type { ReactNode } from 'react'
import { usePersistedSplitSize } from './use-persisted-split-size'

export interface ReaderSplitViewProps {
  /** The reader (`PdfReader`/`EpubReader`), on the left. */
  reader: ReactNode
  /** The notes/cards panel, on the right. */
  panel: ReactNode
  /** Accessible name for the resize handle. */
  panelLabel: string
  /** `localStorage` key the split ratio persists under. One default key means every reader
   *  shares the same remembered width — the same call `chrome-store.ts` makes for the
   *  sidebar, and simpler than a per-source key nobody asked for. */
  storageKey?: string
}

const DEFAULT_STORAGE_KEY = 'retenia.reader-split-size'
const DEFAULT_SIZE = 65

/** "Biblioteca de fuentes": reader on the left, notes/cards panel on the right
 * (`docs/spec/08-ux.md` §2, Readwise Reader reference), with the split ratio remembered
 * between sessions. Layout only — `PdfReader`/`EpubReader` and the panel's content are the
 * caller's. */
export function ReaderSplitView({
  reader,
  panel,
  panelLabel,
  storageKey = DEFAULT_STORAGE_KEY,
}: ReaderSplitViewProps) {
  const [size, setSize] = usePersistedSplitSize(storageKey, DEFAULT_SIZE)

  return (
    <SplitPane
      aria-label={panelLabel}
      direction="horizontal"
      defaultSize={size}
      onSizeChange={setSize}
      minSize={30}
      maxSize={85}
      className="h-full"
      start={reader}
      end={panel}
    />
  )
}
