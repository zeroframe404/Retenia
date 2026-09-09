import type { GenerationRun, PathVersion } from '@retenia/core'
import type { GenerationConfig } from '../config/generation-config'
import { orderedSourceIds } from '../config/generation-config'
import { asJson } from '../json'
import type { KnowledgeGraphDocument } from '../schemas/knowledge-graph'
import type { GenerationManifest, ManifestCost } from '../schemas/manifest'
import type { PathDraft } from '../schemas/path-draft'
import type { GenerationWarning } from '../schemas/warnings'
import type { GenerationRepos } from './deps'

/**
 * The one transaction of a run: the path becomes a `draft`, its first unfrozen version
 * holds the draft, the graph and the manifest, and the run is completed pointing at it.
 * Nothing in here awaits anything but the repositories it was given
 * (`packages/core/src/ports/unit-of-work.ts`).
 */

export interface PersistDraftInput {
  readonly repos: Pick<GenerationRepos, 'transaction'>
  readonly runId: string
  readonly pathId: string
  readonly config: GenerationConfig
  readonly draft: PathDraft
  readonly graph: KnowledgeGraphDocument
  readonly manifest: GenerationManifest
  readonly warnings: readonly GenerationWarning[]
  readonly cost: ManifestCost
  readonly now: Date
}

export interface PersistedDraft {
  readonly version: PathVersion
  readonly run: GenerationRun
}

export async function persistDraft(input: PersistDraftInput): Promise<PersistedDraft> {
  return input.repos.transaction(async (tx) => {
    await tx.paths.update(input.pathId, {
      status: 'draft',
      title: input.draft.title,
      language: input.draft.language,
      level: input.draft.level,
      goal: input.draft.goal,
      targetDate: input.draft.target_date,
      sourceIds: orderedSourceIds(input.config),
      settings: asJson(input.config),
    })
    const version = await tx.paths.createVersion({
      pathId: input.pathId,
      spec: asJson(input.draft),
      knowledgeGraph: asJson(input.graph),
      manifest: asJson(input.manifest),
      diff: null,
      frozenAt: null,
    })
    const run = await tx.generationRuns.update(input.runId, {
      status: 'completed',
      pathVersionId: version.id,
      manifest: asJson(input.manifest),
      warnings: input.warnings.map((entry) => asJson(entry)),
      costUsd: input.cost.usd,
      inputTokens: input.cost.input_tokens,
      outputTokens: input.cost.output_tokens,
      cachedTokens: input.cost.cached_tokens,
      error: null,
      finishedAt: input.now,
    })
    return { version, run }
  })
}
