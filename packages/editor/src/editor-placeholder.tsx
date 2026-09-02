import type { IdGenerator } from '@retenia/core'
import { AppShellPlaceholder } from '@retenia/ui'

export interface NoteBlockPlaceholder {
  readonly id: string
  readonly text: string
}

/** Stand-in for the real Tiptap note editor (sub-phase 9.5: cloze/math/occlusion/callout). */
export function makeNoteBlock(ids: IdGenerator, text: string): NoteBlockPlaceholder {
  return { id: ids.next(), text }
}

export function EditorPlaceholder({ text }: { text: string }) {
  return <AppShellPlaceholder title={`Note: ${text}`} />
}
