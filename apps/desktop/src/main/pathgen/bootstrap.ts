import type { AiClient, AiRegistry } from '@retenia/ai'
import { realTimers } from '@retenia/ai'
import type { Clock } from '@retenia/core'
import type { PathgenProgressEvent } from '@retenia/ipc-contract'
import {
  createGenerationRun,
  type GenerationConfigInput,
  type PathgenLogger,
  quoteConfig as quoteGenerationConfig,
} from '@retenia/pathgen'
import { loadPathgenPrompts } from '@retenia/pathgen/node'
import { buildAiResultCache } from '../ai/client'
import type { AppDatabase } from '../db/open'
import { log } from '../logging/log'
import { createPathgenFacade, type PathgenFacade } from './facade'

/**
 * Wires `createGenerationRun` (sub-phase 8.1's orchestrator) and the wizard's quote against
 * the already-open database and the already-built AI client from `bootstrapJobs` — no second
 * database connection, no second client (`docs/spec/07-architecture.md` §5: main is the single
 * writer).
 */

export interface BootstrapPathgenOptions {
  readonly database: AppDatabase
  readonly ai: AiClient
  readonly registry: () => Promise<AiRegistry>
  /** Pushes `pathgen.progress`. */
  readonly emit: (event: PathgenProgressEvent) => void
  readonly clock?: Clock
}

const pathgenLogger: PathgenLogger = {
  warn: (message) => log.warn(message),
  error: (message, error) => log.error(message, error),
}

export function bootstrapPathgen({
  database,
  ai,
  registry,
  emit,
  clock = { now: () => new Date() },
}: BootstrapPathgenOptions): PathgenFacade {
  const prompts = loadPathgenPrompts()
  const repos = database.repos

  const runs = createGenerationRun({
    ai,
    registry,
    repos,
    prompts,
    resultCache: buildAiResultCache(repos),
    progress: {
      report: (event) => {
        emit({
          runId: event.runId,
          stage: event.stage,
          done: event.done,
          total: event.total,
          ...(event.detail === undefined ? {} : { detail: event.detail }),
        })
      },
    },
    clock,
    timers: realTimers,
    logger: pathgenLogger,
  })

  return createPathgenFacade({
    runs,
    repos,
    clock,
    quote: async (config: GenerationConfigInput) => {
      const { estimate } = await quoteGenerationConfig({ ai, repos, prompts }, config)
      return { estimate, warnings: [] }
    },
  })
}
