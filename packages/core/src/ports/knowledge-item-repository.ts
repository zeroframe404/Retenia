import type { ImportanceLevel, KnowledgeItem, KnowledgeItemStatus } from '../entities'
import type { CrudRepository, ListOptions } from './audit'

/** The things worth remembering. Cards hang off these; a card outlives the source it came
 *  from, so soft-deleting a source never touches its items. */
export interface KnowledgeItemRepository extends CrudRepository<KnowledgeItem> {
  listByLesson(lessonId: string, options?: ListOptions): Promise<KnowledgeItem[]>
  listBySource(sourceId: string, options?: ListOptions): Promise<KnowledgeItem[]>
  listByAnnotation(annotationId: string, options?: ListOptions): Promise<KnowledgeItem[]>
  listByTopic(topicId: string, options?: ListOptions): Promise<KnowledgeItem[]>
  /** Changing the level never reschedules en masse — it only changes what the next review
   *  aims at (`docs/spec/02-memory-system.md` §7 rule 2). */
  setImportance(id: string, importance: ImportanceLevel): Promise<KnowledgeItem>
  countByStatus(): Promise<Record<KnowledgeItemStatus, number>>
}
