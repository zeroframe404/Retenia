import { readFileSync, writeFileSync } from 'node:fs'
import type { BrowserWindow } from 'electron'
import { screen } from 'electron'

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

/** Read the bounds saved at `file`, falling back to `defaults` when the file is missing,
 * unreadable, or its position no longer fits any currently connected display. */
export function loadWindowState(
  file: string,
  defaults: { width: number; height: number },
): WindowState {
  const state = tryReadState(file)
  if (!state) {
    return { width: defaults.width, height: defaults.height, isMaximized: false }
  }
  return fitsAnyDisplay(state) ? state : { ...state, x: undefined, y: undefined }
}

function tryReadState(file: string): WindowState | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<WindowState>
    if (typeof raw.width !== 'number' || typeof raw.height !== 'number') {
      return null
    }
    return {
      x: typeof raw.x === 'number' ? raw.x : undefined,
      y: typeof raw.y === 'number' ? raw.y : undefined,
      width: raw.width,
      height: raw.height,
      isMaximized: raw.isMaximized === true,
    }
  } catch {
    return null
  }
}

/** A saved top-left corner counts as visible if it (plus a margin) lands inside some
 * display's work area — a monitor unplugged since the last run should not strand it. */
function fitsAnyDisplay(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) {
    return true
  }
  const { x, y } = state
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      x >= area.x && y >= area.y && x + 50 <= area.x + area.width && y + 50 <= area.y + area.height
    )
  })
}

/** Persist `window`'s bounds to `file` on every move/resize (debounced) and once more,
 * immediately, on close — so the final position is never lost to the debounce window. */
export function trackWindowState(window: BrowserWindow, file: string): void {
  let timer: ReturnType<typeof setTimeout> | undefined

  const save = () => {
    const isMaximized = window.isMaximized()
    const bounds = isMaximized ? window.getNormalBounds() : window.getBounds()
    try {
      writeFileSync(file, JSON.stringify({ ...bounds, isMaximized } satisfies WindowState))
    } catch {
      // Losing the saved position is not worth surfacing to the user.
    }
  }

  const scheduleSave = () => {
    clearTimeout(timer)
    timer = setTimeout(save, 500)
  }

  window.on('resize', scheduleSave)
  window.on('move', scheduleSave)
  window.on('close', () => {
    clearTimeout(timer)
    save()
  })
}
