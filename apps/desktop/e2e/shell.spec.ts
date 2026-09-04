import { callApiWith, expect, gotoReady, SECTIONS, screenshot, test } from './fixtures'

test.describe('shell navigation', () => {
  for (const id of SECTIONS) {
    test(`navigates to ${id} via the sidebar and renders it`, async ({ window }) => {
      await gotoReady(window)
      await window.getByTestId(`sidebar-item-${id}`).click()
      await expect(window.getByTestId(`screen-${id}`)).toBeVisible()
      await expect(window.getByTestId(`sidebar-item-${id}`)).toHaveAttribute('aria-current', 'page')
      await screenshot(window, `shell-${id}`)
    })
  }
})

test('command palette opens with Ctrl+K, filters, and "Start review" navigates', async ({
  window,
}) => {
  await gotoReady(window)
  await window.keyboard.press('Control+k')
  const input = window.getByTestId('command-palette-input')
  await expect(input).toBeVisible()

  // cmdk filters against the rendered (es-AR) label — "Empezar a repasar" — not an English query.
  await input.fill('repasar')
  await window.getByTestId('command-item-action.startReview').click()

  await expect(window.getByTestId('screen-review')).toBeVisible()
  await expect(input).not.toBeVisible()
})

test('toggles theme from the command palette', async ({ window }) => {
  await gotoReady(window)
  const html = window.locator('html')

  // One toggle only advances light -> dark -> system -> light; if the OS/test environment
  // already resolves "system" to "light", a single light -> "light" (explicit) step doesn't
  // change what's on screen. Two toggles always land on a different resolved theme than
  // whatever was showing before, however the run started.
  for (let i = 0; i < 2; i++) {
    await window.keyboard.press('Control+k')
    // "Cambiar tema" (es-AR) — cmdk filters against the rendered label, not an English query.
    await window.getByTestId('command-palette-input').fill('tema')
    await window.getByTestId('command-item-action.toggleTheme').click()
  }

  await expect.poll(() => html.getAttribute('data-theme')).toBe('dark')
})

test('opens the keyboard shortcuts sheet with Shift+? and lists the reserved shortcuts', async ({
  window,
}) => {
  await gotoReady(window)
  await window.keyboard.press('Shift+Slash')
  const sheet = window.getByTestId('shortcuts-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText('ctrl')
  await expect(sheet).toContainText('space')
  await expect(sheet).toContainText('esc')
})

test('density: switching to compact actually shrinks the shell chrome', async ({ window }) => {
  await gotoReady(window)
  const topBar = window.locator('header').first()
  const before = (await topBar.boundingBox())?.height

  await window.getByTestId('sidebar-item-settings').click()
  await window.getByTestId('screen-settings').getByText('Compacta').click()

  await expect(window.locator('[data-density="compact"]')).toBeVisible()
  await expect
    .poll(async () => (await topBar.boundingBox())?.height)
    .toBeLessThan(before ?? Number.POSITIVE_INFINITY)
})

test('sober mode hides the XP badge', async ({ window }) => {
  await gotoReady(window)
  await expect(window.getByTestId('xp-badge')).toBeVisible()

  await window.getByTestId('sidebar-item-settings').click()
  await window.getByTestId('screen-settings').getByText('Sobrio').click()

  await expect(window.getByTestId('xp-badge')).not.toBeVisible()
})

test('the review screen stays mounted (via Activity) when navigating away and back', async ({
  window,
}) => {
  await gotoReady(window)
  await callApiWith(window, ({ api, arg }) => api.memory.seedReviewDemo(arg), { count: 3 })

  await window.getByTestId('sidebar-item-review').click()
  await expect(window.getByTestId('screen-review')).toBeVisible()
  await expect(window.getByTestId('card-reveal')).toBeVisible()

  // Reveal the current card — local UI state a fresh mount would lose.
  await window.keyboard.press('Enter')
  await expect(window.getByTestId('card-back')).toBeVisible()

  await window.getByTestId('sidebar-item-home').click()
  await expect(window.getByTestId('screen-home')).toBeVisible()

  await window.getByTestId('sidebar-item-review').click()
  // A fresh mount would have reset `revealed` back to false and shown the front only.
  await expect(window.getByTestId('card-back')).toBeVisible()
})
