import { describe, expect, it } from 'vitest'
import { parseGenerationConfig } from '../config/generation-config'
import { GenerationError } from '../errors'
import { createAiHarness } from '../testing/ai-harness'
import { createMemoryRepos } from '../testing/memory-repos'
import { createMiniWorld, MINI_NOW } from '../testing/mini-world'
import { loadPlan, quoteConfig, quoteFromPlan } from './quote-config'

/**
 * The wizard's step-1 quote (`docs/spec/04-path-generation.md` §13 step 1), factored out of
 * `run/generation-run.ts`: it must ask the exact same question a run does, without writing
 * anything.
 */

const clock = { now: () => MINI_NOW }

function world() {
  const mini = createMiniWorld()
  const harness = createAiHarness({ resolve: mini.resolve, clock })
  const repos = createMemoryRepos(clock, { sources: mini.sources, chunks: mini.chunks })
  return { mini, harness, repos }
}

describe('loadPlan()', () => {
  it('resolves the config’s sources and chunks in primary-first order', async () => {
    const { mini, repos } = world()
    const plan = await loadPlan({ repos }, parseGenerationConfig(mini.config))
    expect(plan.sources.map((source) => source.id)).toEqual(['src-book', 'src-course'])
    expect(plan.extractable.length).toBeGreaterThan(0)
  })

  it('throws no_sources for a dangling source id', async () => {
    const { mini, repos } = world()
    const config = parseGenerationConfig({
      ...mini.config,
      sourceIds: ['does-not-exist'],
      primarySourceId: 'does-not-exist',
    })
    await expect(loadPlan({ repos }, config)).rejects.toMatchObject({ code: 'no_sources' })
  })
})

describe('quoteConfig() / quoteFromPlan()', () => {
  it('produces the same estimate a run’s own quote would', async () => {
    const { mini, harness, repos } = world()
    const deps = { ai: harness.ai, runner: harness.runner, repos, prompts: mini.prompts }

    const { estimate, plan } = await quoteConfig(deps, mini.config)
    expect(estimate.chunks).toBe(plan.extractable.length)
    expect(estimate.dispatch).toBe('sync')
    expect(estimate.lowUsd).toBeLessThanOrEqual(estimate.usd)
    expect(estimate.highUsd).toBeGreaterThanOrEqual(estimate.usd)

    // quoteFromPlan on the same plan must not drift from quoteConfig's own answer.
    const again = await quoteFromPlan(deps, plan)
    expect(again).toEqual(estimate)
  })

  it('reports batch dispatch once nobody is waiting and a runner exists', async () => {
    const { mini, harness, repos } = world()
    const deps = { ai: harness.ai, runner: harness.runner, repos, prompts: mini.prompts }
    const { estimate } = await quoteConfig(deps, mini.config, { userWaiting: false })
    expect(estimate.dispatch).toBe('batch')
  })

  it('discounts already-extracted chunks to zero P1 cost', async () => {
    const { mini, harness, repos } = world()
    const deps = { ai: harness.ai, repos, prompts: mini.prompts }
    const plan = await loadPlan({ repos }, parseGenerationConfig(mini.config))
    const full = await quoteFromPlan(deps, plan)
    const nothingLeft = await quoteFromPlan(deps, plan, {
      alreadyExtracted: plan.extractable.length,
    })
    expect(full.p1.calls).toBeGreaterThan(0)
    expect(nothingLeft.p1.calls).toBe(0)
    expect(nothingLeft.usd).toBeLessThan(full.usd)
  })

  it('surfaces no_chunks through the shared error type', async () => {
    const { mini, harness, repos } = world()
    const deps = { ai: harness.ai, repos, prompts: mini.prompts }
    await expect(
      quoteConfig(deps, { ...mini.config, scope: { kind: 'selected', headingPaths: ['Nowhere'] } }),
    ).rejects.toBeInstanceOf(GenerationError)
  })
})
