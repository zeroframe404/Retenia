import { join } from 'node:path'
import type { EventName, Events, InferEvent } from '@retenia/ipc-contract'
import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { emitEvent } from '../ipc/emit'
import { APP_INDEX_URL } from '../security/origins'
import { loadWindowState, trackWindowState } from './window-state'

export enum WindowKind {
  Main = 'main',
  /** A pop-out lesson/video player (sub-phase 9.x). */
  Player = 'player',
  /** A focused exam session window (sub-phase 10.x). */
  Exam = 'exam',
}

/** Extra data passed to the renderer through the load URL's query string. */
export type OpenWindowParams = Record<string, string>

interface WindowKindConfig {
  title: string
  defaults: { width: number; height: number }
  /** Only the main window's position survives across launches: a pop-out player or an
   * exam session is transient by nature and always opens centered on its owner. */
  persistBounds: boolean
}

const WINDOW_KIND_CONFIG: Record<WindowKind, WindowKindConfig> = {
  [WindowKind.Main]: {
    title: 'Retenia',
    defaults: { width: 1100, height: 720 },
    persistBounds: true,
  },
  [WindowKind.Player]: {
    title: 'Retenia — Player',
    defaults: { width: 900, height: 640 },
    persistBounds: false,
  },
  [WindowKind.Exam]: {
    title: 'Retenia — Exam',
    defaults: { width: 1000, height: 700 },
    persistBounds: false,
  },
}

const windowsByKind = new Map<WindowKind, Set<BrowserWindow>>()

export interface OpenWindowOptions {
  /** The Vite dev server origin, when one is serving the renderer. */
  devServerUrl?: string
  /** Where to persist window bounds; defaults to `app.getPath('userData')`. */
  userDataDir?: string
  preloadPath: string
}

/** `kind` plus `params` becomes the load URL's query string, so the renderer can tell
 * which window it is and what it was opened for (`?kind=player&lessonId=…`). */
export function buildLoadUrl(base: string, kind: WindowKind, params: OpenWindowParams): string {
  const search = new URLSearchParams({ kind, ...params }).toString()
  return `${base}?${search}`
}

export function openWindow(
  kind: WindowKind,
  params: OpenWindowParams = {},
  options: OpenWindowOptions,
): BrowserWindow {
  const config = WINDOW_KIND_CONFIG[kind]
  const userDataDir = options.userDataDir ?? app.getPath('userData')
  const stateFile = join(userDataDir, `window-state-${kind}.json`)

  const state = config.persistBounds
    ? loadWindowState(stateFile, config.defaults)
    : { width: config.defaults.width, height: config.defaults.height, isMaximized: false }

  const webPreferences: BrowserWindowConstructorOptions['webPreferences'] = {
    preload: options.preloadPath,
    // Non-negotiable per CLAUDE.md and docs/spec/07-architecture.md §4 — every window kind
    // gets the same posture, not just the main one.
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    webviewTag: false,
  }

  const window = new BrowserWindow({
    title: config.title,
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    show: false,
    autoHideMenuBar: true,
    webPreferences,
  })

  if (state.isMaximized) {
    window.maximize()
  }

  window.on('ready-to-show', () => window.show())

  if (config.persistBounds) {
    trackWindowState(window, stateFile)
  }

  const set = windowsByKind.get(kind) ?? new Set<BrowserWindow>()
  set.add(window)
  windowsByKind.set(kind, set)
  window.on('closed', () => set.delete(window))

  // An empty string (the e2e suite's way of forcing `app://` even in an unpackaged run)
  // must fall through to `APP_INDEX_URL` too, hence the truthy check rather than `??`.
  const base = options.devServerUrl ? options.devServerUrl : APP_INDEX_URL
  void window.loadURL(buildLoadUrl(base, kind, params))

  return window
}

/** Every open window, or just those of one `kind`. Closed windows are pruned as they close
 * (see the `'closed'` listener in `openWindow`), so this never returns a stale reference. */
export function getWindows(kind?: WindowKind): BrowserWindow[] {
  if (kind) {
    return [...(windowsByKind.get(kind) ?? [])]
  }
  return [...windowsByKind.values()].flatMap((set) => [...set])
}

/** Push an event to every open window. */
export function broadcast<K extends EventName>(name: K, payload: InferEvent<Events, K>): void {
  for (const window of getWindows()) {
    if (!window.isDestroyed()) {
      emitEvent(window.webContents, name, payload)
    }
  }
}
