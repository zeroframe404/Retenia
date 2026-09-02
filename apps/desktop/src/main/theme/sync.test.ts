import { beforeEach, describe, expect, it, vi } from 'vitest'

let shouldUseDarkColors = false
const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
const nativeTheme = {
  themeSource: 'system' as 'system' | 'light' | 'dark',
  get shouldUseDarkColors() {
    return shouldUseDarkColors
  },
  on(event: string, listener: (...args: unknown[]) => void) {
    const set = listeners.get(event) ?? new Set()
    set.add(listener)
    listeners.set(event, set)
  },
  off(event: string, listener: (...args: unknown[]) => void) {
    listeners.get(event)?.delete(listener)
  },
}

function emit(event: string): void {
  for (const listener of listeners.get(event) ?? []) listener()
}

vi.mock('electron', () => ({ nativeTheme }))

const { initThemeSync, resolveTheme } = await import('./sync')

beforeEach(() => {
  shouldUseDarkColors = false
  nativeTheme.themeSource = 'system'
  listeners.clear()
})

describe('resolveTheme', () => {
  it('reflects nativeTheme.shouldUseDarkColors', () => {
    shouldUseDarkColors = false
    expect(resolveTheme()).toBe('light')
    shouldUseDarkColors = true
    expect(resolveTheme()).toBe('dark')
  })
})

describe('initThemeSync', () => {
  it('sets themeSource and reports the resolved theme immediately', () => {
    shouldUseDarkColors = true
    const onChange = vi.fn()

    initThemeSync('dark', onChange)

    expect(nativeTheme.themeSource).toBe('dark')
    expect(onChange).toHaveBeenCalledWith('dark')
  })

  it('reports again whenever nativeTheme fires "updated" (OS switch or app.setTheme)', () => {
    const onChange = vi.fn()
    initThemeSync('system', onChange)
    onChange.mockClear()

    shouldUseDarkColors = true
    emit('updated')

    expect(onChange).toHaveBeenCalledWith('dark')
  })

  it('the returned disposer stops further notifications', () => {
    const onChange = vi.fn()
    const stop = initThemeSync('system', onChange)
    onChange.mockClear()

    stop()
    emit('updated')

    expect(onChange).not.toHaveBeenCalled()
  })
})
