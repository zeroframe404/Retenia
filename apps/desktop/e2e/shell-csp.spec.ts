import { expect, gotoReady, test } from './fixtures'

/**
 * What the shell itself trips against the production Content-Security-Policy, before any lesson
 * content is on screen.
 *
 * This exists because the baseline used to be four reports that nobody had traced, and two of
 * them were real breakage nobody could see: `font-src data:` was one KaTeX face Vite had inlined
 * as a `data:` URL (large delimiters fell back to a system font), and `script-src eval` was zod
 * probing for its JIT — harmless in itself, but a permanent false positive in the single loudest
 * signal this app has that something started executing content. Both are fixed at the source
 * (`electron.vite.config.ts`, `src/renderer/src/zod-runtime.ts`). Pinning what is left is what
 * keeps the next one from hiding in the noise.
 */
function collectViolations(): void {
  const violations: string[] = []
  ;(window as unknown as Record<string, unknown>).__shellViolations = violations
  document.addEventListener('securitypolicyviolation', (event) => {
    violations.push(`${event.effectiveDirective || event.violatedDirective} ${event.blockedURI}`)
  })
}

test('the shell loads with no unexplained CSP violation', async ({ window }) => {
  await window.addInitScript(collectViolations)
  await window.reload()
  await gotoReady(window)

  const violations = await window.evaluate(
    () => (window as unknown as { __shellViolations: string[] }).__shellViolations,
  )

  /*
   * Exactly Sonner's own stylesheet, and nothing else.
   *
   * Sonner ships its CSS twice: as `sonner/dist/styles.css`, which `packages/ui`'s `Toaster`
   * imports so the bundler puts it in the app's stylesheet, and as a `<style>` element it
   * injects into `document.head` at import time, which `style-src 'self'` blocks. The injected
   * copy is redundant — the assertion below proves the rules are live from our own stylesheet —
   * but it is baked into Sonner's published bundle and cannot be turned off from here.
   */
  expect(violations).toEqual(['style-src-elem inline', 'style-src-elem inline'])

  // The half that matters: Sonner's rules are applied, from a stylesheet the policy allows.
  const toasterPosition = await window.evaluate(() => {
    const probe = document.createElement('div')
    probe.setAttribute('data-sonner-toaster', '')
    document.body.append(probe)
    const position = getComputedStyle(probe).position
    probe.remove()
    return position
  })
  expect(toasterPosition).toBe('fixed')
})
