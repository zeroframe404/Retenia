import { describe, expect, it } from 'vitest'
import { loadPrompt, PROMPTS_ROOT, UnknownPromptError } from './prompt-files'

/**
 * The loader reads files off disk, so the one thing worth pinning is that an id cannot become a
 * path: sub-phase 7.2's versioned loader will plausibly take one from settings or the database.
 */
describe('loadPrompt()', () => {
  it('loads the registered prompts', () => {
    expect(loadPrompt('grade_long_text')).toContain('id: grade_long_text')
    expect(loadPrompt('explain_answer')).toContain('id: explain_answer')
  })

  it('cannot be made to traverse out of the prompts directory', () => {
    expect(PROMPTS_ROOT.endsWith('prompts')).toBe(true)
    expect(() => loadPrompt('../../../../etc/passwd' as Parameters<typeof loadPrompt>[0])).toThrow(
      UnknownPromptError,
    )
  })
})
