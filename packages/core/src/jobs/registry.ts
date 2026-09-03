import type { RegisteredJob } from './definition'

/**
 * The set of job kinds this build knows how to run.
 *
 * Both ends consult it: `JobScheduler.enqueue` refuses a kind nobody can execute (a typo
 * would otherwise sit `queued` forever), and the worker looks up what to actually call.
 */
export interface JobRegistry {
  get(type: string): RegisteredJob | undefined
  has(type: string): boolean
  /** Every registered kind, sorted — what a worker passes to `claim` so it only takes
   *  work it can do. */
  types(): readonly string[]
}

export function createJobRegistry(definitions: readonly RegisteredJob[]): JobRegistry {
  const byType = new Map<string, RegisteredJob>()
  for (const definition of definitions) {
    if (byType.has(definition.type)) {
      throw new Error(`Two job definitions both claim the type "${definition.type}"`)
    }
    byType.set(definition.type, definition)
  }
  const types = Object.freeze([...byType.keys()].sort())

  return {
    get: (type) => byType.get(type),
    has: (type) => byType.has(type),
    types: () => types,
  }
}
