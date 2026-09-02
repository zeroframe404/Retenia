import type { AiCall } from '../entities'
import type { CrudRepository, ListOptions, NewEntity } from './audit'

export interface CostQuery {
  from: Date
  to?: Date
  provider?: string
  model?: string
  purpose?: string
}

/** The per-call cost log behind the budget and the usage dashboard
 *  (`docs/spec/06-ai-providers.md` §8). Written once per call, never edited. */
export interface AiCallRepository extends CrudRepository<AiCall> {
  record(input: NewEntity<AiCall>): Promise<AiCall>
  findByCustomId(customId: string): Promise<AiCall | undefined>
  listByBatch(batchId: string, options?: ListOptions): Promise<AiCall[]>
  listRecent(options?: ListOptions): Promise<AiCall[]>
  /** Total USD spent in the window, for the monthly budget check. */
  sumCost(query: CostQuery): Promise<number>
  /** Spend split by provider and model, for the dashboard. */
  costByModel(
    query: CostQuery,
  ): Promise<Array<{ provider: string; model: string; costUsd: number }>>
}
