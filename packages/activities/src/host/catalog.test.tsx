import { MVP_TYPES } from '@retenia/activity-schema'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import axe, { type Result } from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import '../index'
import { activityCatalog, type CatalogEntry } from '../testing/catalog'
import { ActivityHost } from './activity-host'

/**
 * The two acceptance criteria of this sub-phase that are about the *catalogue* rather than the
 * machine:
 *
 * 1. every fixture of `packages/activity-schema/fixtures/` renders without a runtime error;
 * 2. axe reports no critical violations.
 *
 * They are enforced here rather than only in the Storybook `Fixtures` story, so CI fails on a
 * regression without anyone opening a browser. The story renders the same catalogue, from the same
 * `activityCatalog()`.
 */

const CATALOG = activityCatalog()

/** `critical` is the acceptance bar; `serious` is tracked too, because it is what actually blocks
 *  a keyboard or screen-reader user and the app's own E2E suite already gates on both. */
const BLOCKING_IMPACTS = new Set(['critical', 'serious'])

function formatViolations(violations: Result[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n    ${violation.nodes
          .map((node) => node.target.join(' '))
          .join('\n    ')}`,
    )
    .join('\n')
}

async function auditBlockingViolations(container: HTMLElement): Promise<Result[]> {
  const results = await axe.run(container, {
    rules: {
      // `region` wants every node inside a landmark, which is a page-level concern: an activity is
      // mounted inside the lesson player's `<main>` and has no landmark of its own to give.
      region: { enabled: false },
      // jsdom loads no stylesheet, so every element here is black-on-transparent and the rule
      // measures nothing (it also drives axe into `canvas`, which jsdom does not implement).
      // Real contrast is gated by `tooling/scripts/contrast-check.mjs` over the design tokens and
      // by Storybook's a11y addon, which runs in a browser with the CSS applied.
      'color-contrast': { enabled: false },
    },
  })
  return results.violations.filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ''))
}

describe('the fixture catalogue', () => {
  afterEach(cleanup)

  it('is not empty and covers every MVP type', () => {
    expect(CATALOG.length).toBeGreaterThan(0)
    const covered = new Set(CATALOG.map((entry) => entry.type))
    expect([...MVP_TYPES].filter((type) => !covered.has(type))).toEqual([])
  })

  it.each(CATALOG.map((entry): [string, CatalogEntry] => [entry.id, entry]))(
    'renders %s without a runtime error',
    async (_id, entry) => {
      render(<ActivityHost activity={entry.activity} seed="catalog" />)

      const host = await screen.findByTestId('activity-host')
      expect(host).toHaveAttribute('data-type', entry.type)
      // The family renderer resolved: the lazy chunk arrived and mounted, rather than the host
      // falling back to "no renderer yet".
      expect(await screen.findByTestId(`renderer-${entry.activity.family}`)).toBeInTheDocument()
      expect(screen.queryByTestId('unsupported-type')).not.toBeInTheDocument()
    },
  )

  it.each(CATALOG.map((entry): [string, CatalogEntry] => [entry.id, entry]))(
    'has no critical or serious axe violation: %s',
    async (_id, entry) => {
      const { container } = render(<ActivityHost activity={entry.activity} seed="catalog" />)
      await screen.findByTestId(`renderer-${entry.activity.family}`)

      const violations = await auditBlockingViolations(container)
      expect(violations, formatViolations(violations)).toEqual([])
    },
    20_000,
  )
})

describe('accessibility of the states a fixture does not reach on its own', () => {
  afterEach(cleanup)

  const withExtras = CATALOG.find((entry) => entry.type === 'mcq_single') as CatalogEntry

  it('is clean with a hint open, a feedback panel and an explanation', async () => {
    const activity = {
      ...withExtras.activity,
      hints: ['Pensá en el río.'],
      explanation: 'Porque es la capital desde 987.',
      grading: { ...withExtras.activity.grading, maxAttempts: 2 },
    }
    const { container } = render(<ActivityHost activity={activity} seed="catalog" />)
    await screen.findByTestId('renderer-choice')

    screen.getByTestId('hint-button').click()
    screen.getByTestId('check-button').click()
    await screen.findByTestId('feedback-panel')
    screen.getByTestId('explain-button').click()
    await screen.findByTestId('explanation')

    const violations = await auditBlockingViolations(container)
    expect(violations, formatViolations(violations)).toEqual([])
  })

  it('is clean in test mode, where the timer is on screen and the UI locks', async () => {
    const { container } = render(
      <ActivityHost activity={withExtras.activity} mode="test" seed="catalog" />,
    )
    await screen.findByTestId('renderer-choice')
    expect(screen.getByTestId('activity-timer')).toBeInTheDocument()

    const violations = await auditBlockingViolations(container)
    expect(violations, formatViolations(violations)).toEqual([])
  })

  it('is clean with an item picked up, when every drop zone grows its place button', async () => {
    const pairs = CATALOG.find((entry) => entry.type === 'matching_pairs') as CatalogEntry
    const { container } = render(<ActivityHost activity={pairs.activity} seed="catalog" />)
    await screen.findByTestId('renderer-pairs')

    container.querySelector<HTMLElement>('[data-testid^="draggable-"]')?.click()
    await waitFor(() => expect(container.querySelector('[data-place-zone]')).not.toBeNull())

    const violations = await auditBlockingViolations(container)
    expect(violations, formatViolations(violations)).toEqual([])
  })
})
