import type { TextGenerationRequest } from '@retenia/ai'
import type { ExtractChunkOutput } from '../schemas/extraction'
import type { SynthesizeModuleOutput, SynthesizeOutlineOutput } from '../schemas/outline'
import {
  MODULE_STAGE,
  OUTLINE_STAGE,
  type ParsedModuleTask,
  parseModuleTask,
} from '../synthesize/tasks'
import type { ReplayResolver } from './replay'

/**
 * A scripted model for the three prompts of this package: P1 answers by custom id, the
 * outline by a function of the request, and each module by a function of the parsed task.
 *
 * The module answers are computed rather than recorded because a module's custom id
 * depends on the skeleton *after* its fixes, which only the pipeline knows — a function of
 * the task the pipeline actually sends is the one thing that stays in step with it. What is
 * golden, and snapshotted, is the draft the whole run produces.
 */
export interface ScriptedModel {
  /** `custom_id` → the P1 answer. */
  readonly extractions: ReadonlyMap<string, ExtractChunkOutput>
  readonly outline: (request: TextGenerationRequest) => SynthesizeOutlineOutput | undefined
  readonly module: (
    task: ParsedModuleTask,
    request: TextGenerationRequest,
  ) => SynthesizeModuleOutput | undefined
}

export function createScriptedModel(model: ScriptedModel): ReplayResolver {
  return (request) => {
    const key = request.idempotencyKey ?? ''
    const extraction = model.extractions.get(key)
    if (extraction !== undefined) return JSON.stringify(extraction)
    if (key.startsWith(`${OUTLINE_STAGE}-`)) {
      const outline = model.outline(request)
      return outline === undefined ? undefined : JSON.stringify(outline)
    }
    if (key.startsWith(`${MODULE_STAGE}-`)) {
      const task = parseModuleTask(request.prompt)
      if (task === undefined) return undefined
      const output = model.module(task, request)
      return output === undefined ? undefined : JSON.stringify(output)
    }
    return undefined
  }
}
