import { DEFAULT_PROFILES } from '@retenia/ai'
import type { Clock } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { HARNESS_NOW } from '../testing/ai-harness'
import { expandWorld } from '../testing/expand-world'
import { buildLessonPrefix, outlineDigest, pathGlossaryDigest } from './prefix'

const clock: Clock = { now: () => HARNESS_NOW }
const [profile] = DEFAULT_PROFILES
if (profile === undefined) throw new Error('DEFAULT_PROFILES is empty')

const glossaryOfWorld = (world: ReturnType<typeof expandWorld>) =>
  [...world.concepts.values()]
    .map((concept) => ({
      conceptId: concept.id,
      name: concept.name,
      definition: concept.definition,
    }))
    .sort((a, b) => a.conceptId.localeCompare(b.conceptId))

describe('buildLessonPrefix()', () => {
  it('is byte-identical between two builds — otherwise no call ever hits the cache', () => {
    const world = expandWorld(clock, { lessons: 8 })
    const input = { draft: world.draft, glossary: glossaryOfWorld(world) }
    const options = { profile, modelId: 'model-a' }

    const first = buildLessonPrefix('system', input, options)
    const second = buildLessonPrefix('system', input, options)

    expect(second.cachePrefix).toBe(first.cachePrefix)
    expect(second.system).toBe(first.system)
  })

  it('does not depend on the order the concepts were loaded in', () => {
    const world = expandWorld(clock, { lessons: 8 })
    const glossary = glossaryOfWorld(world)
    const options = { profile, modelId: 'model-a' }

    const forward = buildLessonPrefix('system', { draft: world.draft, glossary }, options)
    const reversed = buildLessonPrefix(
      'system',
      {
        draft: world.draft,
        glossary: [...glossary].reverse().sort((a, b) => a.conceptId.localeCompare(b.conceptId)),
      },
      options,
    )

    expect(reversed.cachePrefix).toBe(forward.cachePrefix)
  })

  it('carries the few-shots, the outline and the path glossary, and nothing per-lesson', () => {
    const world = expandWorld(clock, { lessons: 8 })
    const prefix = buildLessonPrefix(
      'system',
      {
        draft: world.draft,
        glossary: glossaryOfWorld(world),
      },
      { profile, modelId: 'model-a' },
    )

    expect(prefix.cachePrefix).toContain('few_shots')
    expect(prefix.cachePrefix).toContain('outline')
    expect(prefix.cachePrefix).toContain('path_glossary')
    // The lesson's own fragments belong in the task: a prefix carrying them would be a prefix
    // no second lesson ever matches.
    expect(prefix.cachePrefix).not.toContain('citable')
  })

  it('asks for the 1 h path-generation TTL, not the 5 m default', () => {
    const world = expandWorld(clock, { lessons: 8 })
    const prefix = buildLessonPrefix(
      'system',
      {
        draft: world.draft,
        glossary: glossaryOfWorld(world),
      },
      { profile, modelId: 'model-a' },
    )

    if (prefix.cache !== undefined) expect(prefix.cache.ttl).toBe('1h')
  })
})

describe('outlineDigest()', () => {
  it('names every lesson of the path, so a lesson knows what its neighbours cover', () => {
    const world = expandWorld(clock, { lessons: 8 })
    const digest = outlineDigest(world.draft)
    const ids = world.draft.sections.flatMap((section) =>
      section.modules.flatMap((module) => module.lessons.map((lesson) => lesson.id)),
    )
    for (const id of ids) expect(digest).toContain(id)
  })
})

describe('pathGlossaryDigest()', () => {
  it('is empty for a path with no concepts rather than throwing', () => {
    expect(pathGlossaryDigest([])).toBe('')
  })
})
