import { beforeEach, describe, expect, it } from 'vitest'
import { useTypographySettingsStore } from './typography-store'

beforeEach(() => {
  useTypographySettingsStore.setState({ fontSize: 16, lineHeight: 1.5, dyslexiaFont: false })
})

describe('useTypographySettingsStore', () => {
  it('starts at the defaults', () => {
    expect(useTypographySettingsStore.getState()).toMatchObject({
      fontSize: 16,
      lineHeight: 1.5,
      dyslexiaFont: false,
    })
  })

  it('setFontSize clamps to the 14-20px range', () => {
    useTypographySettingsStore.getState().setFontSize(18)
    expect(useTypographySettingsStore.getState().fontSize).toBe(18)

    useTypographySettingsStore.getState().setFontSize(999)
    expect(useTypographySettingsStore.getState().fontSize).toBe(20)

    useTypographySettingsStore.getState().setFontSize(-5)
    expect(useTypographySettingsStore.getState().fontSize).toBe(14)
  })

  it('setLineHeight clamps to the 1.2-2 range', () => {
    useTypographySettingsStore.getState().setLineHeight(1.8)
    expect(useTypographySettingsStore.getState().lineHeight).toBe(1.8)

    useTypographySettingsStore.getState().setLineHeight(10)
    expect(useTypographySettingsStore.getState().lineHeight).toBe(2)

    useTypographySettingsStore.getState().setLineHeight(0)
    expect(useTypographySettingsStore.getState().lineHeight).toBe(1.2)
  })

  it('setDyslexiaFont toggles the font option', () => {
    useTypographySettingsStore.getState().setDyslexiaFont(true)
    expect(useTypographySettingsStore.getState().dyslexiaFont).toBe(true)
  })

  it('reset restores the defaults', () => {
    useTypographySettingsStore.getState().setFontSize(20)
    useTypographySettingsStore.getState().setDyslexiaFont(true)
    useTypographySettingsStore.getState().reset()
    expect(useTypographySettingsStore.getState()).toMatchObject({
      fontSize: 16,
      lineHeight: 1.5,
      dyslexiaFont: false,
    })
  })
})
