import type { PathDraft } from '../schemas/path-draft'
import { PathEditError } from './types'

/** Flips which source is primary. The primary source fixes the narrative
 *  (`docs/spec/04-path-generation.md` §7); this only relabels `draft.sources`, it does not
 *  re-run sequencing — a regeneration (8.6) is what would actually re-narrate the path. */
export function setPrimarySource(draft: PathDraft, sourceId: string): PathDraft {
  if (!draft.sources.some((source) => source.source_id === sourceId)) {
    throw new PathEditError('unknown_source', `"${sourceId}" is not one of this path's sources`)
  }
  return {
    ...draft,
    sources: draft.sources.map((source) => ({
      ...source,
      primary: source.source_id === sourceId,
    })),
  }
}
