import type { Activity } from '../envelope'
import type { Issue } from './types'

/** Theory blocks have no answer key; the shared rules (ids, media, registry parity) are all that applies. */
export function validateDisclosure(_activity: Activity<'disclosure'>): Issue[] {
  return []
}
