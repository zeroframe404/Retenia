import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPrompt, PROMPT_IDS, PROMPTS_ROOT } from './prompts/registry'
import {
  BUNDLED_PROMPT_FILES,
  bundledPromptReader,
  MissingBundledPromptError,
} from './prompts-bundled'

/**
 * The bundle and the disk have to agree, or the packaged app runs a prompt the tests never
 * saw — and `prompt_version` in a manifest would name a file whose text nobody can produce.
 *
 * `migrations-bundled.test.ts` makes the same assertion about the SQL, for the same reason.
 */
describe('the bundled prompts', () => {
  it('picked up every registered prompt', () => {
    for (const id of PROMPT_IDS) {
      // Every registered prompt has at least its version 1 on disk.
      expect(Object.keys(BUNDLED_PROMPT_FILES)).toContain(`${id}/1.md`)
    }
    expect(Object.keys(BUNDLED_PROMPT_FILES).length).toBeGreaterThanOrEqual(PROMPT_IDS.length)
  })

  it('carries the same bytes the disk does', () => {
    for (const [file, text] of Object.entries(BUNDLED_PROMPT_FILES)) {
      expect(text, file).toBe(readFileSync(join(PROMPTS_ROOT, file), 'utf-8'))
    }
  })

  it('loads a prompt to the same value through either reader', () => {
    for (const id of PROMPT_IDS) {
      const fromDisk = loadPrompt(id)
      const fromBundle = loadPrompt(id, undefined, bundledPromptReader)
      expect(fromBundle.template, id).toBe(fromDisk.template)
      expect(fromBundle.frontmatter, id).toEqual(fromDisk.frontmatter)
      expect(fromBundle.promptVersion, id).toBe(fromDisk.promptVersion)
    }
  })

  it('names the file the glob missed, rather than returning undefined text', () => {
    expect(() => bundledPromptReader('not_a_prompt/1.md')).toThrow(MissingBundledPromptError)
    expect(() => bundledPromptReader('not_a_prompt/1.md')).toThrow(/did not pick it up/)
  })
})
