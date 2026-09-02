import { describe, expect, it } from 'vitest'
import type { ProviderPort } from './index'

describe('@retenia/ai ProviderPort', () => {
  it('is a structural port any provider adapter can implement', async () => {
    const echoProvider: ProviderPort = {
      role: 'cheap',
      id: 'echo-test-provider',
      complete: async (prompt) => prompt,
    }

    await expect(echoProvider.complete('hola')).resolves.toBe('hola')
    expect(echoProvider.role).toBe('cheap')
  })
})
