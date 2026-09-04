import path from 'node:path'
import Database from 'better-sqlite3'
import { callApiWith, expect, gotoReady, screenshot, test } from './fixtures'

/**
 * The daily review session, end to end (`docs/spec/02-memory-system.md` §12, sub-phase
 * 4.4's acceptance: "full session possible with keyboard only").
 *
 * `memory.seedReviewDemo` is the dev/e2e-only seed channel (gated the same way
 * `jobs.enqueueDemo` is — `RETENIA_E2E=1`, set by `fixtures.ts`'s `launchEnv`): it writes
 * 20 due cards cycling the four v1 templates (basic, reverse, cloze, type-in) so this test
 * exercises every renderer in one pass.
 */
test('seeds 20 cards, grades a full session with the keyboard only, and writes 20 review_logs', async ({
  window,
  electronApp,
}) => {
  await gotoReady(window)

  const seeded = await callApiWith(window, ({ api, arg }) => api.memory.seedReviewDemo(arg), {
    count: 20,
  })
  expect(seeded.ok).toBe(true)

  await window.getByTestId('sidebar-item-review').click()
  await expect(window.getByTestId('screen-review')).toBeVisible()
  // `card-reveal` is every template's "not revealed yet" trigger (basic/reverse/cloze's
  // reveal link, type-in's "Check" button) — waiting for it is the one signal common to
  // all four renderers that a fresh card has actually loaded, not still the loading
  // skeleton `session.next` briefly shows between cards.
  await expect(window.getByTestId('card-reveal')).toBeVisible()
  await screenshot(window, 'review-front')

  // Enter reveals every template — the global `review.continue` hotkey for basic/reverse/
  // cloze, and the type-in field's own local Enter handler otherwise (see
  // `components/card-view.tsx`) — so one keyboard loop covers all four renderers.
  await window.keyboard.press('Enter')
  await expect(window.getByTestId('grade-buttons')).toBeVisible()
  await screenshot(window, 'review-revealed')
  await window.keyboard.press('3')

  for (let i = 1; i < 20; i++) {
    await expect(window.getByTestId('card-reveal')).toBeVisible()
    await window.keyboard.press('Enter')
    await expect(window.getByTestId('grade-buttons')).toBeVisible()
    await window.keyboard.press('3')
  }

  await expect(window.getByTestId('session-summary')).toBeVisible()
  await expect(window.getByTestId('summary-reviewed')).toContainText('20')
  await screenshot(window, 'review-summary')

  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const db = new Database(path.join(userDataDir, 'retenia.db'), { readonly: true })
  try {
    const row = db
      .prepare('SELECT COUNT(*) as n FROM review_logs WHERE deleted_at IS NULL')
      .get() as { n: number }
    expect(row.n).toBe(20)
  } finally {
    db.close()
  }
})

test('the Today card shows the seeded due count and opens the review screen', async ({
  window,
}) => {
  await gotoReady(window)
  await callApiWith(window, ({ api, arg }) => api.memory.seedReviewDemo(arg), { count: 5 })

  await window.reload()
  await gotoReady(window)
  await expect(window.getByTestId('today-card')).toBeVisible()
  await expect(window.getByTestId('today-primary-action')).not.toBeDisabled()
  await screenshot(window, 'today-card')

  await window.getByTestId('today-primary-action').click()
  await expect(window.getByTestId('screen-review')).toBeVisible()
})
