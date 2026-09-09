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
})
