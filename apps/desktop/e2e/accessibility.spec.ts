import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, gotoReady, SECTIONS, test } from './fixtures'

/** `serious`/`critical` only: `moderate`/`minor` violations are worth tracking but would
 * make this suite flaky against axe's own rule-set churn — the two highest impact levels
 * are the ones that actually block a keyboard/screen-reader user (per the axe-core docs).
 */
const BLOCKING_IMPACTS = ['serious', 'critical']

/** Runs axe-core against the current page and asserts no serious/critical violations.
 *
 * `.setLegacyMode()`: axe-core-playwright's default `analyze()` technique opens an
 * auxiliary browser window to run its cross-frame scan, which needs a `Target.createTarget`
 * CDP call Electron's renderer target does not support ("Protocol error (Target.createTarget):
 * Not supported") — legacy mode skips that window and scans the given page/frame tree
 * directly instead (dequelabs/axe-core-npm's own `error-handling.md` documents this exact
 * case). The app has no cross-origin iframes, so legacy mode's one tradeoff (it can miss
 * violations inside cross-domain frames) does not apply here.
 */
async function expectNoBlockingViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).setLegacyMode().analyze()
  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.includes(v.impact ?? ''))
  expect(blocking, formatViolations(blocking)).toEqual([])
}

test.describe('accessibility (axe-core)', () => {
  for (const id of SECTIONS) {
    test(`route "${id}" has no serious/critical axe violations`, async ({ window }) => {
      await gotoReady(window)
      if (id !== 'home') {
        await window.getByTestId(`sidebar-item-${id}`).click()
        await expect(window.getByTestId(`screen-${id}`)).toBeVisible()
      }

      await expectNoBlockingViolations(window)
    })
  }

  test('the command palette has no serious/critical axe violations', async ({ window }) => {
    await gotoReady(window)
    await window.keyboard.press('Control+k')
    await expect(window.getByTestId('command-palette-input')).toBeVisible()

    await expectNoBlockingViolations(window)
  })

  test('the keyboard shortcuts sheet has no serious/critical axe violations', async ({
    window,
  }) => {
    await gotoReady(window)
    await window.keyboard.press('Shift+Slash')
    await expect(window.getByTestId('shortcuts-sheet')).toBeVisible()

    await expectNoBlockingViolations(window)
  })
})

/** axe violations serialize into Playwright's default failure output as `[object Object]` —
 * this turns each one into a readable one-liner (rule id, impact, the offending selectors)
 * so a CI failure says what actually broke instead of just "expected [] received [...]". */
function formatViolations(
  violations: {
    id: string
    impact?: string | null
    help: string
    nodes: { target: unknown[] }[]
  }[],
): string {
  return violations
    .map(
      (v) =>
        `\n- [${v.impact}] ${v.id}: ${v.help}\n  ${v.nodes.map((n) => JSON.stringify(n.target)).join('\n  ')}`,
    )
    .join('')
}
