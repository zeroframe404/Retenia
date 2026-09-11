import type { Page } from '@playwright/test'
import type { SourceSummary } from '@retenia/ipc-contract'
import { callApiWith, expect, gotoReady, screenshot, test } from './fixtures'

/**
 * The prior-knowledge diagnostic through the screens a learner uses (sub-phase 8.5;
 * `docs/spec/04-path-generation.md` §13 steps 1–4): the wizard, the preview's "Confirmar
 * ruta", "¿Cómo empezás?" → "Ya sé parte", the self-assessment, the adaptive item loop with
 * its confidence picker, and the summary with "Avanzado" and "Deshacer".
 *
 * `pathgen-diagnostic.spec.ts` proves the stack underneath over the API; this one proves the
 * screens drive it, and leaves a screenshot of each in `e2e/__screenshots__/` for a human to
 * look at. Only the source is added through the API: the library's upload is its own suite.
 */

test.setTimeout(180_000)

const SOURCE_TEXT = [
  '# Cinemática',
  '',
  'La cinemática estudia el movimiento de los cuerpos sin considerar sus causas. La velocidad',
  'es el cambio de posición por unidad de tiempo, y la aceleración es el cambio de velocidad',
  'por unidad de tiempo. Un movimiento rectilíneo uniforme mantiene la velocidad constante,',
  'mientras que un movimiento uniformemente acelerado cambia la velocidad a un ritmo constante.',
].join('\n')

async function addReadySource(page: Page): Promise<SourceSummary> {
  const added = await callApiWith(
    page,
    ({ api, arg }) => api.library.addSourceFromText({ text: arg.text, title: arg.title }),
    { text: SOURCE_TEXT, title: 'Cinemática (e2e pantallas)' },
  )
  expect(added.ok).toBe(true)
  if (!added.ok) throw new Error('addSourceFromText failed')
  await expect
    .poll(
      async () => {
        const result = await callApiWith(
          page,
          ({ api, arg }) => api.library.getSource({ id: arg }),
          added.data.id,
        )
        return result.ok ? result.data.source?.status : undefined
      },
      { timeout: 20_000 },
    )
    .toBe('ready')
  return added.data
}

/** What the loop shows once an answer lands: the next item's number, or the summary. */
async function loopPosition(page: Page): Promise<string> {
  if (await page.getByTestId('diagnostic-result-page').isVisible()) return 'result'
  return (await page.getByTestId('diagnostic-item').getAttribute('aria-label')) ?? 'none'
}

test('runs the diagnostic from the wizard to its summary, screen by screen', async ({ window }) => {
  await gotoReady(window)
  const source = await addReadySource(window)

  // --- §13 step 1: the wizard -------------------------------------------------------------
  await window.getByTestId('sidebar-item-path').click()
  await expect(window.getByTestId('pathgen-wizard')).toBeVisible()
  await window.getByTestId('wizard-goal').fill('Aprobar el parcial de cinemática')
  await window.getByTestId('wizard-level').fill('Principiante')
  await window.getByTestId('wizard-primary-source').selectOption(source.id)
  // The live estimate, P9's "Banco de preguntas" row included, is what the badge prices.
  await expect(window.getByTestId('wizard-estimate')).toBeVisible({ timeout: 10_000 })
  await screenshot(window, 'diagnostic-ui-01-wizard')

  await window.getByTestId('wizard-generate').click()

  // --- §13 step 3: the preview and "Confirmar ruta" -----------------------------------------
  await expect(window.getByTestId('pathgen-preview')).toBeVisible({ timeout: 60_000 })
  await screenshot(window, 'diagnostic-ui-02-preview')
  await window.getByTestId('preview-freeze').click()

  // --- §13 step 4: "¿Cómo empezás?" ---------------------------------------------------------
  await expect(window.getByTestId('diagnostic-entry')).toBeVisible({ timeout: 20_000 })
  await screenshot(window, 'diagnostic-ui-03-entry')
  // The bank is built at freeze; the self-assessment can be filled in while it is.
  await expect(window.getByTestId('diagnostic-bank-waiting')).toBeHidden({ timeout: 60_000 })
  await expect(window.getByTestId('diagnostic-bank-no-items')).toHaveCount(0)
  await expect(window.getByTestId('diagnostic-bank-failed')).toHaveCount(0)

  await window.getByTestId('diagnostic-partial').click()
  const form = window.getByTestId('self-assessment-form')
  await expect(form).toBeVisible()
  const know = form.getByRole('radio', { name: 'Lo sé' }).first()
  await know.click()
  await expect(know).toHaveAttribute('aria-checked', 'true')
  await screenshot(window, 'diagnostic-ui-04-self-assessment')

  const begin = window.getByTestId('diagnostic-begin')
  await expect(begin).toBeEnabled({ timeout: 60_000 })
  await begin.click()

  // --- §10 steps 2–7: the item loop ---------------------------------------------------------
  await expect(window.getByTestId('diagnostic-loop')).toBeVisible({ timeout: 20_000 })
  let asked = 0
  while ((await loopPosition(window)) !== 'result') {
    expect(asked).toBeLessThan(30)
    const before = await loopPosition(window)
    const host = window.getByTestId('activity-host')
    await expect(host).toBeVisible()
    // The fake keys option "a": answering it, sure, is what lets a module come out known —
    // and so gives the summary something to undo.
    await host.getByTestId('option-a').check()
    await host.getByTestId('confidence-picker').getByText('Seguro', { exact: true }).click()
    // The host is in test mode: no right or wrong is ever shown, only that nothing is graded.
    await expect(host.getByTestId('deferred-feedback')).toBeVisible()
    if (asked === 0) await screenshot(window, 'diagnostic-ui-05-item')
    await host.getByTestId('check-button').click()
    await expect.poll(() => loopPosition(window), { timeout: 20_000 }).not.toBe(before)
    asked += 1
  }
  expect(asked).toBeGreaterThan(0)

  // --- the summary --------------------------------------------------------------------------
  const result = window.getByTestId('diagnostic-result-page')
  await expect(result).toBeVisible()
  await screenshot(window, 'diagnostic-ui-06-result')

  await window.getByTestId('diagnostic-advanced').click()
  await expect(window.locator('[data-testid^="diagnostic-module-advanced-"]').first()).toBeVisible()
  await screenshot(window, 'diagnostic-ui-07-result-advanced')

  // Undo one module the diagnostic marked known, when it marked any: its badge must follow
  // the counts back to "Por estudiar".
  const revert = window
    .locator('[data-testid^="diagnostic-revert-"]:not([data-testid="diagnostic-revert-all"])')
    .first()
  if ((await revert.count()) > 0) {
    // The tile reads "<label><value>": the count is the number it ends with.
    const knownTile = window.getByTestId('diagnostic-stat-known')
    const known = Number((await knownTile.innerText()).match(/(\d+)\s*$/)?.[1] ?? Number.NaN)
    expect(known).toBeGreaterThan(0)
    // By the row's own id: the button this was found through disappears once it is used.
    const specId = ((await revert.getAttribute('data-testid')) ?? '').replace(
      'diagnostic-revert-',
      '',
    )
    const row = window.getByTestId(`diagnostic-module-${specId}`)
    await expect(row).toHaveAttribute('data-status', 'known')
    await revert.click()
    await expect(row).toHaveAttribute('data-status', 'unknown')
    await expect(row.getByText('Deshecho')).toBeVisible()
    await expect(knownTile).toHaveText(new RegExp(`\\D${known - 1}\\s*$`))
    await screenshot(window, 'diagnostic-ui-08-result-reverted')
  }

  await window.getByTestId('diagnostic-continue').click()
  await expect(result).toBeHidden()
  await screenshot(window, 'diagnostic-ui-09-after-result')
})
