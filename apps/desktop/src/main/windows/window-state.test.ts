import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsState = new Map<string, string>()
const readFileSync = vi.fn((file: string) => {
  const content = fsState.get(file)
  if (content === undefined) {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  }
  return content
})
const writeFileSync = vi.fn((file: string, data: string) => {
  fsState.set(file, data)
})

vi.mock('node:fs', () => ({ readFileSync, writeFileSync }))

let displays: Array<{ workArea: { x: number; y: number; width: number; height: number } }> = []
const getAllDisplays = vi.fn(() => displays)
vi.mock('electron', () => ({ screen: { getAllDisplays } }))

const { loadWindowState, trackWindowState } = await import('./window-state')

const FILE = 'C:/Users/test/AppData/Roaming/Retenia/window-state-main.json'
const DEFAULTS = { width: 1100, height: 720 }

beforeEach(() => {
  fsState.clear()
  readFileSync.mockClear()
  writeFileSync.mockClear()
  displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]
})

describe('loadWindowState', () => {
  it('falls back to the defaults when the file does not exist', () => {
    expect(loadWindowState(FILE, DEFAULTS)).toEqual({
      width: 1100,
      height: 720,
      isMaximized: false,
    })
  })

  it('falls back to the defaults when the file is corrupt JSON', () => {
    fsState.set(FILE, '{not json')
    expect(loadWindowState(FILE, DEFAULTS)).toEqual({
      width: 1100,
      height: 720,
      isMaximized: false,
    })
  })

  it('falls back to the defaults when width/height are missing', () => {
    fsState.set(FILE, JSON.stringify({ x: 10, y: 10 }))
    expect(loadWindowState(FILE, DEFAULTS)).toEqual({
      width: 1100,
      height: 720,
      isMaximized: false,
    })
  })

  it('restores a saved position that still fits a display', () => {
    fsState.set(
      FILE,
      JSON.stringify({ x: 100, y: 100, width: 1200, height: 800, isMaximized: true }),
    )
    expect(loadWindowState(FILE, DEFAULTS)).toEqual({
      x: 100,
      y: 100,
      width: 1200,
      height: 800,
      isMaximized: true,
    })
  })

  it('drops a saved position that no longer fits any display, keeping width/height', () => {
    fsState.set(
      FILE,
      JSON.stringify({ x: 3000, y: 3000, width: 1200, height: 800, isMaximized: false }),
    )
    expect(loadWindowState(FILE, DEFAULTS)).toEqual({
      x: undefined,
      y: undefined,
      width: 1200,
      height: 800,
      isMaximized: false,
    })
  })

  it('accepts a position on a second display', () => {
    displays = [
      { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
      { workArea: { x: 1920, y: 0, width: 1920, height: 1080 } },
    ]
    fsState.set(
      FILE,
      JSON.stringify({ x: 2000, y: 100, width: 1200, height: 800, isMaximized: false }),
    )
    expect(loadWindowState(FILE, DEFAULTS)).toMatchObject({ x: 2000, y: 100 })
  })
})

interface FakeWindow {
  on: (event: string, listener: (...args: unknown[]) => void) => void
  isMaximized: () => boolean
  getBounds: () => { x: number; y: number; width: number; height: number }
  getNormalBounds: () => { x: number; y: number; width: number; height: number }
  emit: (event: string) => void
}

function fakeWindow(bounds = { x: 5, y: 5, width: 800, height: 600 }): FakeWindow {
  const listeners = new Map<string, Array<() => void>>()
  const maximized = false
  return {
    on(event, listener) {
      const list = listeners.get(event) ?? []
      list.push(listener as () => void)
      listeners.set(event, list)
    },
    isMaximized: () => maximized,
    getBounds: () => bounds,
    getNormalBounds: () => bounds,
    emit(event) {
      for (const listener of listeners.get(event) ?? []) listener()
    },
  }
}

describe('trackWindowState', () => {
  it('saves bounds after a resize, debounced', async () => {
    vi.useFakeTimers()
    const window = fakeWindow()
    trackWindowState(window as unknown as import('electron').BrowserWindow, FILE)

    window.emit('resize')
    expect(writeFileSync).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)
    expect(JSON.parse(fsState.get(FILE) ?? '{}')).toEqual({
      x: 5,
      y: 5,
      width: 800,
      height: 600,
      isMaximized: false,
    })
    vi.useRealTimers()
  })

  it('coalesces rapid move+resize into a single write', async () => {
    vi.useFakeTimers()
    const window = fakeWindow()
    trackWindowState(window as unknown as import('electron').BrowserWindow, FILE)

    window.emit('move')
    await vi.advanceTimersByTimeAsync(100)
    window.emit('resize')
    await vi.advanceTimersByTimeAsync(500)

    expect(writeFileSync).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('saves immediately on close, even mid-debounce', () => {
    const window = fakeWindow()
    trackWindowState(window as unknown as import('electron').BrowserWindow, FILE)

    window.emit('resize')
    window.emit('close')

    expect(writeFileSync).toHaveBeenCalledOnce()
  })
})
