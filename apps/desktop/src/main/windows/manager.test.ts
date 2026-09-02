import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./window-state', () => ({
  loadWindowState: vi.fn(() => ({ width: 1100, height: 720, isMaximized: false })),
  trackWindowState: vi.fn(),
}))

type Listener = (...args: unknown[]) => void

class FakeBrowserWindow {
  static instances: FakeBrowserWindow[] = []
  private listeners = new Map<string, Listener[]>()
  webContents = { send: vi.fn() }
  loadURL = vi.fn(async () => {})
  maximize = vi.fn()
  show = vi.fn()
  private destroyed = false

  constructor(public opts: Record<string, unknown>) {
    FakeBrowserWindow.instances.push(this)
  }

  on(event: string, listener: Listener) {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
    return this
  }

  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }

  isDestroyed() {
    return this.destroyed
  }

  markDestroyed() {
    this.destroyed = true
  }

  isMaximized() {
    return false
  }

  getBounds() {
    return { x: 0, y: 0, width: 1100, height: 720 }
  }

  getNormalBounds() {
    return this.getBounds()
  }
}

const app = { getPath: vi.fn(() => '/fake/userData') }

vi.mock('electron', () => ({ app, BrowserWindow: FakeBrowserWindow }))

const { WindowKind, broadcast, buildLoadUrl, getWindows, openWindow } = await import('./manager')

beforeEach(() => {
  FakeBrowserWindow.instances = []
})

// `windowsByKind` lives at module scope, so a window left open in one test would otherwise
// leak into the next one's getWindows()/broadcast() results.
afterEach(() => {
  for (const window of FakeBrowserWindow.instances) {
    window.emit('closed')
  }
})

describe('buildLoadUrl', () => {
  it('adds kind and params as a query string', () => {
    expect(buildLoadUrl('app://retenia/index.html', WindowKind.Player, { lessonId: 'l1' })).toBe(
      'app://retenia/index.html?kind=player&lessonId=l1',
    )
  })

  it('works with no extra params', () => {
    expect(buildLoadUrl('app://retenia/index.html', WindowKind.Main, {})).toBe(
      'app://retenia/index.html?kind=main',
    )
  })
})

function open(kind: (typeof WindowKind)[keyof typeof WindowKind]) {
  return openWindow(
    kind,
    {},
    { preloadPath: '/fake/preload/index.cjs' },
  ) as unknown as FakeBrowserWindow
}

describe('openWindow', () => {
  it('creates a window per kind and registers it under getWindows(kind)', () => {
    const main = open(WindowKind.Main)
    expect(getWindows(WindowKind.Main)).toEqual([main])
    expect(getWindows(WindowKind.Player)).toEqual([])
  })

  it('loads the app index URL with the kind in the query string', () => {
    const window = open(WindowKind.Exam)
    expect(window.loadURL).toHaveBeenCalledWith('app://retenia/index.html?kind=exam')
  })

  it('shows the window once ready-to-show fires', () => {
    const window = open(WindowKind.Main)
    window.emit('ready-to-show')
    expect(window.show).toHaveBeenCalledOnce()
  })

  it('removes the window from getWindows once it closes', () => {
    const window = open(WindowKind.Player)
    expect(getWindows(WindowKind.Player)).toHaveLength(1)
    window.emit('closed')
    expect(getWindows(WindowKind.Player)).toHaveLength(0)
  })

  it('every open window across kinds shows up in getWindows() with no argument', () => {
    open(WindowKind.Main)
    open(WindowKind.Player)
    expect(getWindows()).toHaveLength(2)
  })
})

describe('broadcast', () => {
  it('sends the validated event payload to every open, non-destroyed window', () => {
    const a = open(WindowKind.Main)
    const b = open(WindowKind.Player)
    b.markDestroyed()

    broadcast('app.deepLink', { kind: 'review' })

    expect(a.webContents.send).toHaveBeenCalledWith('app.deepLink', { kind: 'review' })
    expect(b.webContents.send).not.toHaveBeenCalled()
  })
})
