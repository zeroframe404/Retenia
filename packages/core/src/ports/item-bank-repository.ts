import type { ItemBankEntry, ItemUsage } from '../entities'
import type { CrudRepository, ListOptions } from './audit'

/** The calibrated pool an exam or a diagnostic draws from
 *  (`docs/spec/04-path-generation.md` §9, prompt P9). */
export interface ItemBankRepository extends CrudRepository<ItemBankEntry> {
  findByActivity(activityId: string): Promise<ItemBankEntry | undefined>
  listByModule(moduleId: string, options?: ListOptions): Promise<ItemBankEntry[]>
  listByPathVersion(pathVersionId: string, options?: ListOptions): Promise<ItemBankEntry[]>
  /** Entries tagged for a given use, least-exposed first, so a mock exam does not keep
   *  serving the same items. */
  listByUsage(
    pathVersionId: string,
    usage: ItemUsage,
    options?: ListOptions,
  ): Promise<ItemBankEntry[]>
  /** `exposure += 1` on each id, in one transaction. */
  bumpExposure(ids: readonly string[]): Promise<void>
}
