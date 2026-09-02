import { beforeEach, describe, expect, it } from 'vitest'
import { useSoundSettingsStore } from './sound-settings-store'

beforeEach(() => {
  useSoundSettingsStore.setState({ volume: 0.7, muted: false })
})

describe('useSoundSettingsStore', () => {
  it('defaults to a moderate volume, unmuted', () => {
    expect(useSoundSettingsStore.getState()).toMatchObject({ volume: 0.7, muted: false })
  })

  it('setVolume clamps to 0-1', () => {
    useSoundSettingsStore.getState().setVolume(1.5)
    expect(useSoundSettingsStore.getState().volume).toBe(1)

    useSoundSettingsStore.getState().setVolume(-1)
    expect(useSoundSettingsStore.getState().volume).toBe(0)
  })

  it('setMuted toggles independently of volume', () => {
    useSoundSettingsStore.getState().setMuted(true)
    expect(useSoundSettingsStore.getState()).toMatchObject({ volume: 0.7, muted: true })
  })
})
