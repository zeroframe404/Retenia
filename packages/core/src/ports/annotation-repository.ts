import type { Annotation } from '../entities'
import type { CrudRepository, ListOptions } from './audit'

/**
 * What the user marks on a source (`docs/spec/07a-schema.md` "Source library"): a highlight,
 * a note, an image region or a media clip. A highlight becomes a knowledge item through
 * `library.createCardFromAnnotation`, which points back here via `knowledgeItems.annotationId`
 * — soft-deleting an annotation never touches the card it produced.
 */
export interface AnnotationRepository extends CrudRepository<Annotation> {
  listBySource(sourceId: string, options?: ListOptions): Promise<Annotation[]>
  listByUnit(unitId: string, options?: ListOptions): Promise<Annotation[]>
}
