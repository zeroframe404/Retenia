import {
  EXTRACT_CHUNK_SCHEMA_NAME,
  extractChunkOutputSchema,
  SYNTHESIZE_MODULE_SCHEMA_NAME,
  SYNTHESIZE_OUTLINE_SCHEMA_NAME,
  synthesizeModuleOutputSchema,
  synthesizeOutlineOutputSchema,
} from '@retenia/pathgen'
import { describe, expect, it } from 'vitest'
import { createE2eFakeInvoker, E2E_MODEL_ID, e2eFakeProfile, e2eFakeRegistry } from './e2e-fake-ai'

/**
 * The E2E-only deterministic invoker (`docs/spec/04-path-generation.md` §13's Playwright
 * acceptance: "wizard → preview → freeze with fakes") — every answer it can be asked for must
 * actually validate against the real schema a live generation run checks it with, or the run
 * itself would be the only place a bad canned answer ever surfaced.
 */

const target = { profile: e2eFakeProfile(), modelId: E2E_MODEL_ID, apiKey: '' }

async function invoke(
  invoker: ReturnType<typeof createE2eFakeInvoker>,
  request: Parameters<typeof invoker>[1],
) {
  const outcome = await invoker(target, request, { signal: undefined })
  if (outcome.kind !== 'ok') throw new Error(`expected an ok outcome, got ${outcome.kind}`)
  return JSON.parse(outcome.text) as unknown
}

describe('e2eFakeRegistry()', () => {
  it('routes both text roles at the fake, keyless profile', () => {
    const registry = e2eFakeRegistry()
    expect(registry.profiles).toHaveLength(1)
    expect(registry.profiles[0]?.keyRef).toBeNull()
    expect(registry.roles.cheap?.primary.profileId).toBe('e2e-fake')
    expect(registry.roles.smart?.primary.profileId).toBe('e2e-fake')
  })
})

describe('createE2eFakeInvoker()', () => {
  it('answers extract_chunk@1 with a schema-valid extraction carrying real concepts', async () => {
    const invoker = createE2eFakeInvoker()
    const answer = await invoke(invoker, {
      prompt: 'irrelevant',
      temperature: 0,
      schemaName: EXTRACT_CHUNK_SCHEMA_NAME,
    })
    const parsed = extractChunkOutputSchema.parse(answer)
    expect(parsed.concepts.length).toBeGreaterThan(0)
  })

  it('answers synthesize_outline@1 with nodes read back from the cache prefix', async () => {
    const invoker = createE2eFakeInvoker()
    const cachePrefix = [
      'c_aaa | Concepto A | concept | imp 0.90 | diff 2 | first: "cap 1"',
      'c_bbb | Concepto B | concept | imp 0.60 | diff 2 | first: "cap 1"',
    ].join('\n')
    const answer = await invoke(invoker, {
      prompt: 'irrelevant',
      temperature: 0,
      schemaName: SYNTHESIZE_OUTLINE_SCHEMA_NAME,
      cachePrefix,
    })
    const parsed = synthesizeOutlineOutputSchema.parse(answer)
    expect(parsed.graph.nodes.map((node) => node.concept_id).sort()).toEqual(['c_aaa', 'c_bbb'])
    expect(parsed.sections[0]?.modules[0]?.concept_ids.sort()).toEqual(['c_aaa', 'c_bbb'])
  })

  it('falls back to a placeholder concept when the cache prefix carries none', async () => {
    const invoker = createE2eFakeInvoker()
    const answer = await invoke(invoker, {
      prompt: 'irrelevant',
      temperature: 0,
      schemaName: SYNTHESIZE_OUTLINE_SCHEMA_NAME,
    })
    expect(() => synthesizeOutlineOutputSchema.parse(answer)).not.toThrow()
  })

  it('answers synthesize_module@1 with the concept ids parsed off the module task prompt', async () => {
    const invoker = createE2eFakeInvoker()
    const prompt = [
      'section: 1 of 1',
      'module: 1 of 1',
      'module_title: Módulo generado (e2e)',
      'concept_ids: c_aaa, c_bbb',
    ].join('\n')
    const answer = await invoke(invoker, {
      prompt,
      temperature: 0,
      schemaName: SYNTHESIZE_MODULE_SCHEMA_NAME,
    })
    const parsed = synthesizeModuleOutputSchema.parse(answer)
    expect(parsed.lesson_specs[0]?.concept_ids.sort()).toEqual(['c_aaa', 'c_bbb'])
    expect(parsed.lesson_specs[0]?.title).toContain('Módulo generado (e2e)')
  })
})
