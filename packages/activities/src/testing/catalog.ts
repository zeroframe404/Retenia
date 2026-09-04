import type { Activity, ActivityType } from '@retenia/activity-schema'
import { isActivityType, parseActivity } from '@retenia/activity-schema'

/**
 * Every valid fixture of `packages/activity-schema/fixtures/`, parsed into an `Activity`.
 *
 * This is the catalogue both the Storybook `Fixtures` story and the accessibility suite render:
 * §5 of the sub-phase brief asks for "a `Fixtures` story that renders every fixture from 5.1", and
 * the acceptance criterion is that all of them render without a runtime error. Reading them from
 * the directory rather than hand-listing them is the point — a fixture added in a later sub-phase
 * is covered the moment it lands.
 *
 * `import.meta.glob` rather than `@retenia/activity-schema/testing`'s `loadFixtures`: that one
 * reads the directory with `node:fs`, which Storybook (a browser) cannot do. Vite inlines these at
 * build time, so the same module serves the story and the Vitest suite.
 */

const MODULES = import.meta.glob<{ activity: unknown }>(
  '../../../activity-schema/fixtures/*/valid-*.json',
  { eager: true, import: 'default' },
)

export interface CatalogEntry {
  type: ActivityType
  /** The fixture's file name, e.g. `valid-2.json`. */
  name: string
  /** `mcq_single/valid-2.json` — stable, and unique across the catalogue. */
  id: string
  activity: Activity
}

function entryOf(path: string, module: { activity: unknown }): CatalogEntry {
  const [name = '', type = ''] = path.split('/').reverse()
  if (!isActivityType(type)) {
    throw new Error(`activityCatalog: "${path}" is not under an activity-type directory`)
  }
  return { type, name, id: `${type}/${name}`, activity: parseActivity(module.activity) }
}

/** The catalogue, in path order, so a story and a test list the fixtures the same way. */
export function activityCatalog(): CatalogEntry[] {
  return Object.entries(MODULES)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, module]) => entryOf(path, module))
}
