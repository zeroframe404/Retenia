import { expect, gotoReady, screenshot, test } from './fixtures'

/**
 * Settings → Scheduler (`docs/spec/08-ux.md` §2, `02-memory-system.md` §6, §7, §16).
 *
 * The screenshot this captures is sub-phase 4.6's acceptance artefact. It is taken in the
 * "never optimised" state on purpose: a real training run needs thousands of seeded reviews,
 * and what the criterion asks to see is the screen — the retention sliders with their
 * simulated cost, the easy-day picker, and the model card offering to optimise.
 */
test.describe('Settings → Scheduler', () => {
  test('renders the scheduler section and screenshots it', async ({ window }) => {
    await gotoReady(window)
    await window.getByTestId('sidebar-item-settings').click()

    const section = window.getByTestId('settings-scheduler')
    await expect(section).toBeVisible()

    // The four levels §7 gives a target retention to. `paused` has none — it is out of the
    // queue entirely — so it has no slider.
    for (const level of ['urgent', 'high', 'normal', 'maintenance']) {
      await expect(window.getByTestId(`scheduler-level-${level}`)).toBeVisible()
    }
    await expect(window.getByTestId('scheduler-level-paused')).toHaveCount(0)

    // §13's "model quality and the date of the last optimization", before there is one.
    await expect(window.getByTestId('scheduler-model-quality')).toBeVisible()

    await screenshot(window, 'settings-scheduler')
  })

  /**
   * §7's promise, end to end: the cost of a retention is on screen next to the control that
   * sets it, and it is a *simulated* number — so moving the slider up moves it up.
   */
  test('shows what a target retention costs, and updates as it changes', async ({ window }) => {
    await gotoReady(window)
    await window.getByTestId('sidebar-item-settings').click()

    const row = window.getByTestId('scheduler-level-normal')
    const cost = row.locator('p')
    const before = await cost.innerText()
    expect(before).toMatch(/\d/)

    // Nudge the slider up a few percent with the keyboard — every control on this screen
    // has to be reachable without a pointer (`docs/spec/08-ux.md` §1.4).
    const thumb = row.getByRole('slider')
    await thumb.focus()
    for (let step = 0; step < 5; step += 1) await thumb.press('ArrowRight')

    await expect(cost).not.toHaveText(before)
  })
})
