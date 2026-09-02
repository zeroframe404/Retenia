import { describe, expect, it } from 'vitest'
import { useAppStore } from './store'

describe('useAppStore', () => {
  it('starts ready', () => {
    expect(useAppStore.getState().ready).toBe(true)
  })
})
