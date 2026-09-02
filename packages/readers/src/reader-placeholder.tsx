import type { IdGenerator } from '@retenia/core'
import { AppShellPlaceholder } from '@retenia/ui'

export interface SourceAnchorPlaceholder {
  readonly id: string
  readonly kind: 'pdf' | 'epub' | 'video' | 'audio'
}

/** Stand-in for the real pdf/epub/video/audio readers (sub-phase 6.6, 11.x). */
export function makeSourceAnchor(
  ids: IdGenerator,
  kind: SourceAnchorPlaceholder['kind'],
): SourceAnchorPlaceholder {
  return { id: ids.next(), kind }
}

export function ReaderPlaceholder({ kind }: { kind: SourceAnchorPlaceholder['kind'] }) {
  return <AppShellPlaceholder title={`Reader: ${kind}`} />
}
