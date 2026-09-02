import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useGamificationProfileStore } from './gamification-store'
import { useGamificationProfile } from './use-gamification-profile'

beforeEach(() => {
  useGamificationProfileStore.setState({ profile: 'arcade' })
})

describe('useGamificationProfileStore', () => {
  it('defaults to arcade', () => {
    expect(useGamificationProfileStore.getState().profile).toBe('arcade')
  })

  it('setProfile switches to sober', () => {
    useGamificationProfileStore.getState().setProfile('sober')
    expect(useGamificationProfileStore.getState().profile).toBe('sober')
  })
})

describe('useGamificationProfile', () => {
  it('reflects the store value and updates on change', () => {
    const { result, rerender } = renderHook(() => useGamificationProfile())
    expect(result.current).toBe('arcade')

    useGamificationProfileStore.getState().setProfile('sober')
    rerender()
    expect(result.current).toBe('sober')
  })
})
