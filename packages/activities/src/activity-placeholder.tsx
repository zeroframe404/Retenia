import type { IdGenerator } from '@retenia/core'
import { AppShellPlaceholder } from '@retenia/ui'

export interface ActivityTypePlaceholder {
  readonly id: string
  readonly family: string
}

/** Stand-in for the real activity-type registry (sub-phase 5.x, 98 types / 22 families). */
export function makeActivityPlaceholder(ids: IdGenerator, family: string): ActivityTypePlaceholder {
  return { id: ids.next(), family }
}

/** Proves `activities` can compose `ui` components while staying within the boundary rules. */
export function ActivityHostPlaceholder({ family }: { family: string }) {
  return <AppShellPlaceholder title={`Activity family: ${family}`} />
}
