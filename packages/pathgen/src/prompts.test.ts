import { USER_CONTENT_INSTRUCTIONS } from '@retenia/ai'
import { renderPrompt } from '@retenia/ai/prompts'
import { describe, expect, it } from 'vitest'
import { loadPathgenPrompts } from './node'
import { assertPathgenPrompts, PATHGEN_PROMPT_IDS, systemFor } from './prompts'
import { EXTRACT_CHUNK_SCHEMA_ID } from './schemas/extraction'
import { SYNTHESIZE_MODULE_SCHEMA_ID, SYNTHESIZE_OUTLINE_SCHEMA_ID } from './schemas/outline'
import { testPrompts } from './testing/extract-fixtures'

describe('the real prompt files', () => {
  const prompts = loadPathgenPrompts()

  it('are registered with the roles, temperatures and schemas this package expects', () => {
    expect(prompts.extract).toMatchObject({
      role: 'cheap',
      temperature: 0,
      schemaVersion: EXTRACT_CHUNK_SCHEMA_ID,
    })
    expect(prompts.outline).toMatchObject({
      role: 'smart',
      temperature: 0.3,
      schemaVersion: SYNTHESIZE_OUTLINE_SCHEMA_ID,
    })
    expect(prompts.module).toMatchObject({
      role: 'smart',
      temperature: 0.3,
      schemaVersion: SYNTHESIZE_MODULE_SCHEMA_ID,
    })
    for (const id of Object.values(PATHGEN_PROMPT_IDS)) {
      expect(prompts.snapshot[id]).toBe('1')
    }
    expect(prompts.extract.promptVersion).toBe('1')
  })

  it('render with an empty task and say what the task will contain', () => {
    for (const [id, prompt] of [
      [PATHGEN_PROMPT_IDS.extract, prompts.extract],
      [PATHGEN_PROMPT_IDS.outline, prompts.outline],
      [PATHGEN_PROMPT_IDS.module, prompts.module],
    ] as const) {
      const rendered = renderPrompt(id, { task: '' })
      expect(rendered.promptVersion).toBe(prompt.promptVersion)
      expect(rendered.text).not.toContain('{{task}}')
    }
    expect(prompts.extract.template).toContain('`source`')
    expect(prompts.extract.template).toContain('`chunk`')
    expect(prompts.extract.template).toContain('is_frontmatter_like')
    expect(prompts.outline.template).toContain('PREREQ_OF')
    expect(prompts.outline.template).toContain('`toc`')
    expect(prompts.module.template).toContain('2 to 5')
  })

  it('become a system message with the envelope paragraph exactly once', () => {
    const system = systemFor(prompts.extract.template)
    expect(system).not.toContain('{{task}}')
    expect(system.split(USER_CONTENT_INSTRUCTIONS)).toHaveLength(2)
    expect(systemFor(system)).toBe(system)
  })
})

describe('assertPathgenPrompts()', () => {
  it('accepts the bundle and rejects a wrong temperature, schema or template', () => {
    expect(assertPathgenPrompts(testPrompts)).toBe(testPrompts)
    expect(() =>
      assertPathgenPrompts({
        ...testPrompts,
        extract: { ...testPrompts.extract, temperature: 0.2 },
      }),
    ).toThrow('temperature 0')
    expect(() =>
      assertPathgenPrompts({
        ...testPrompts,
        outline: { ...testPrompts.outline, schemaVersion: 'other@9' },
      }),
    ).toThrow('declares schema "other@9"')
    expect(() =>
      assertPathgenPrompts({
        ...testPrompts,
        module: { ...testPrompts.module, template: 'no placeholder' },
      }),
    ).toThrow('no {{task}} placeholder')
  })

  it('pins P4 near §9’s 0.7, the way it already pins P1 and P5', () => {
    // P4's answers are parsed in `@retenia/activity-ai`, so this file checks no schema id for
    // it — which left its temperature as the one §9 number nothing guarded. At 0 the 2–3x
    // over-generation returns near-identical candidates; well above 1 the distractors stop
    // coming from the misconceptions they are supposed to be derived from.
    expect(() =>
      assertPathgenPrompts({
        ...testPrompts,
        activities: { ...testPrompts.activities, temperature: 0 },
      }),
    ).toThrow('must stay near')
    expect(() =>
      assertPathgenPrompts({
        ...testPrompts,
        activities: { ...testPrompts.activities, temperature: 1.4 },
      }),
    ).toThrow('must stay near')
  })
})
