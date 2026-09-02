import { beforeEach, describe, expect, it } from 'vitest'
import { useChromeStore } from './chrome-store'

beforeEach(() => {
  useChromeStore.setState({
    sidebarCollapsed: false,
    processingTrayCollapsed: false,
    recentCommandIds: [],
  })
})

describe('useChromeStore', () => {
  it('toggles sidebarCollapsed and processingTrayCollapsed independently', () => {
    useChromeStore.getState().toggleSidebarCollapsed()
    expect(useChromeStore.getState().sidebarCollapsed).toBe(true)
    expect(useChromeStore.getState().processingTrayCollapsed).toBe(false)

    useChromeStore.getState().toggleProcessingTrayCollapsed()
    expect(useChromeStore.getState().processingTrayCollapsed).toBe(true)
  })

  it('records a command at the front, de-duplicating an earlier entry', () => {
    const { recordCommand } = useChromeStore.getState()
    recordCommand('a')
    recordCommand('b')
    recordCommand('a')
    expect(useChromeStore.getState().recentCommandIds).toEqual(['a', 'b'])
  })

  it('keeps only the most recent 5 commands', () => {
    const { recordCommand } = useChromeStore.getState()
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      recordCommand(id)
    }
    expect(useChromeStore.getState().recentCommandIds).toEqual(['f', 'e', 'd', 'c', 'b'])
  })
})
