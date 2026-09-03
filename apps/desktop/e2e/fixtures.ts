import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  test as base,
  type ElectronApplication,
  _electron as electron,
  type Page,
} from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const mainEntry = path.join(here, '../out/main/index.js')
export const screenshotsDir = path.join(here, '__screenshots__')

type Fixtures = {
  electronApp: ElectronApplication
  window: Page
}

/**
 * Extends the base Playwright test with a fresh Electron launch per test: a temp `userData`
 * dir (so tests never touch a real profile, or each other) and `RETENIA_E2E=1` for app code
 * that needs to know it is running under e2e (disabling auto-update checks, telemetry, etc.).
 */
export const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright's fixture signature requires it.
  electronApp: async ({}, use) => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), 'retenia-e2e-'))

    const app = await launchApp(userDataDir)

    await use(app)

    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  },

  window: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  },
})

export { expect } from '@playwright/test'

/** The env every launch shares. Kept beside the fixture so a second, manual launch (see
 *  `launchApp`) cannot drift from it. */
function launchEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // `is.dev` is true for an unpackaged app, so the dev-server URL must be absent or the
    // window would try to load a Vite server that is not running instead of `app://`.
    ELECTRON_RENDERER_URL: '',
    NODE_ENV: 'production',
    RETENIA_E2E: '1',
  }
}

/**
 * Launch the app against a `userData` directory the caller owns.
 *
 * The `electronApp` fixture mints a fresh directory per test, which is what isolation wants
 * — but it makes "kill the app and start it again over the same database" impossible to
 * write. Orphan recovery is exactly that scenario, so it gets this instead.
 */
export async function launchApp(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    env: launchEnv(),
  })
}

/**
 * Calls `window.api.<namespace>.<method>(...)` inside the renderer and returns the result.
 * `fn` runs in the Electron page context, not this Node process — Playwright serializes it
 * over CDP, so it must not capture outer closures, only reference its `api` argument (same
 * rule as `page.evaluate`). `window.api` itself can't be passed as a plain `evaluate` arg (it
 * holds live functions, not JSON), so it's forwarded as a `JSHandle` instead — the one form
 * of arg Playwright hands to the page as the real live reference rather than a serialized copy.
 */
export async function callApi<T>(
  page: Page,
  fn: (api: Window['api']) => T | Promise<T>,
): Promise<T> {
  const apiHandle = await page.evaluateHandle(() => window.api)
  try {
    return await page.evaluate(fn, apiHandle)
  } finally {
    await apiHandle.dispose()
  }
}

/**
 * `callApi` for a call that needs a value from this file.
 *
 * `callApi`'s callback is serialized and re-evaluated in the page, so anything it closes over
 * here is `undefined` there — and only at runtime, as a `ReferenceError`, never at compile
 * time. Whenever a call is parameterised (a job id, a channel input built in Node), use this
 * and read the value off the callback's own argument instead.
 */
export async function callApiWith<T, A>(
  page: Page,
  fn: (context: { api: Window['api']; arg: A }) => T | Promise<T>,
  arg: A,
): Promise<T> {
  const apiHandle = await page.evaluateHandle(() => window.api)
  try {
    // Playwright resolves a JSHandle nested inside a plain-object argument, so the live
    // `window.api` and the serializable `arg` can travel together.
    return await page.evaluate(fn, { api: apiHandle, arg } as unknown as {
      api: Window['api']
      arg: A
    })
  } finally {
    await apiHandle.dispose()
  }
}

/** Saves a screenshot to `apps/desktop/e2e/__screenshots__/<name>.png`. */
export async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(screenshotsDir, `${name}.png`) })
}

/** The shell's sidebar sections, in `data-testid` order — the single list `shell.spec.ts`
 * and `accessibility.spec.ts` both walk. */
export const SECTIONS = [
  'home',
  'path',
  'review',
  'library',
  'exams',
  'languages',
  'notes',
  'statistics',
  'settings',
] as const

/** Navigates to the app and waits for the shell to be hydrated (sidebar rendered) before
 * returning — a global keyboard shortcut or route change fired immediately after `goto` can
 * race ahead of React mounting/registering `HotkeysProvider`'s scopes. */
export async function gotoReady(window: Page): Promise<void> {
  await window.goto('app://retenia/index.html')
  await window.getByTestId('sidebar-item-home').waitFor()
}
