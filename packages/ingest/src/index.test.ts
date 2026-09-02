import { describe, expect, it } from 'vitest'
import type { PipelineStep } from './index'
import { runPipeline } from './index'

describe('@retenia/ingest runPipeline', () => {
  it('threads a value through each step in order', async () => {
    const upper: PipelineStep<string, string> = {
      name: 'upper',
      run: async (s) => s.toUpperCase(),
    }
    const exclaim: PipelineStep<string, string> = {
      name: 'exclaim',
      run: async (s) => `${s}!`,
    }

    const result = await runPipeline('hola', [upper, exclaim])
    expect(result).toBe('HOLA!')
  })
})
