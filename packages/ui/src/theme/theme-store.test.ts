import { beforeEach, describe, expect, it } from 'vitest'
import { useThemeStore } from './theme-store'

beforeEach(() => {
  useThemeStore.setState({ preference: 'system', resolved: 'light' })
})

describe('useThemeStore', () => {
  it('starts with a system preference', () => {
    expect(useThemeStore.getState().preference).toBe('system')
  })

  it('setPreference updates only the preference', () => {
    useThemeStore.getState().setPreference('dark')
    expect(useThemeStore.getState()).toMatchObject({ preference: 'dark', resolved: 'light' })
  })

  it('setResolved updates only the resolved theme', () => {
    useThemeStore.getState().setResolved('dark')
    expect(useThemeStore.getState()).toMatchObject({ preference: 'system', resolved: 'dark' })
  })
})
