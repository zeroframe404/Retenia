import { describe, expect, it } from 'vitest'
import { createLocalProfile } from '../local'
import { bindLanguageModel } from './bind'

describe('bindLanguageModel: openai-compatible', () => {
  it("builds a model against the profile's baseURL with the given key", () => {
    const profile = createLocalProfile({
      id: 'ollama',
      baseURL: 'http://127.0.0.1:11434/v1',
      models: ['qwen3.5:9b'],
    })
    const model = bindLanguageModel(profile, 'qwen3.5:9b', '')
    expect(typeof model).toBe('object')
  })

  it('refuses to build a model for a profile with no baseURL', () => {
    const profile = createLocalProfile({ id: 'ollama', baseURL: '', models: ['m'] })
    // Deliberately reconstruct without baseURL to exercise the construction-bug guard.
    const broken = { ...profile, baseURL: undefined }
    expect(() => bindLanguageModel(broken, 'm', '')).toThrow(/has no baseURL/)
  })
})
