import type { ResponseFamily } from '@retenia/activity-schema'
import { hasResponseSchema } from '@retenia/activity-schema'
import type { ActivityFamily } from '@retenia/core'
import { type ComponentType, type LazyExoticComponent, lazy } from 'react'

/**
 * One renderer module per family, imported lazily — §7's whole point is that `type` decides the
 * renderer while `family` decides the data, so 21 MVP types share 10 chunks rather than 21.
 * `getRenderer(type)` hands back the family's component, and every type of that family resolves to
 * the *same* `lazy()` wrapper, so the second `mcq_multi` after an `mcq_single` costs no fetch.
 *
 * The 13 families that are still payload placeholders in `activity-schema` have no renderer; their
 * types are not registered, and `<ActivityHost/>` says so instead of crashing.
 */

/**
 * A renderer takes no props: it reads the activity, the machine and the host's affordances from
 * `useActivity()` / `useFamilyActivity()`. That is what keeps "adding a type = one file" true —
 * a new type never widens a prop contract the host has to thread through.
 */
export type ActivityRendererComponent = ComponentType<Record<string, never>>

const FAMILY_MODULES: Record<
  ResponseFamily,
  () => Promise<{ Renderer: ActivityRendererComponent }>
> = {
  choice: () => import('../families/choice'),
  text_input: () => import('../families/text-input'),
  cloze: () => import('../families/cloze'),
  long_text: () => import('../families/long-text'),
  pairs: () => import('../families/pairs'),
  ordering: () => import('../families/ordering'),
  categorize: () => import('../families/categorize'),
  text_mark: () => import('../families/text-mark'),
  cards: () => import('../families/cards'),
  disclosure: () => import('../families/disclosure'),
}

const CACHE = new Map<ResponseFamily, LazyExoticComponent<ActivityRendererComponent>>()

/** The family's renderer, as a `React.lazy` component the host mounts inside its `<Suspense/>`. */
export function familyRenderer(
  family: ResponseFamily,
): LazyExoticComponent<ActivityRendererComponent> {
  const cached = CACHE.get(family)
  if (cached) return cached
  const component = lazy(async () => ({ default: (await FAMILY_MODULES[family]()).Renderer }))
  CACHE.set(family, component)
  return component
}

/** Whether a family has a renderer at all (the MVP ten of §6). */
export function hasRenderer(family: ActivityFamily): family is ResponseFamily {
  return hasResponseSchema(family)
}

/** Warms a family's chunk — the session generator calls it while the previous activity is on screen. */
export function preloadFamily(family: ResponseFamily): Promise<unknown> {
  return FAMILY_MODULES[family]()
}
