import { ACTIVITY_TYPES } from '@retenia/activity-schema'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, waitFor, within } from 'storybook/test'
import '../index'
import { activityCatalog } from '../testing/catalog'
import { ActivityHost } from './activity-host'

/**
 * The fixture catalogue of §5 of the sub-phase brief: **every** valid fixture of
 * `packages/activity-schema/fixtures/`, rendered through the real host.
 *
 * It is the visual half of the acceptance criterion "all fixtures render without runtime errors";
 * the enforcing half is `catalog.test.tsx`, which renders the same `activityCatalog()` under Vitest
 * and runs axe over each one. The story is where a human checks that they also *look* right — and
 * where the a11y addon runs axe again, in a real browser with the design system's CSS applied.
 */

const CATALOG = activityCatalog()

function FixtureCatalog() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 p-4" data-testid="fixture-catalog">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">Activity fixtures</h1>
        <p className="text-muted text-sm">
          {CATALOG.length} fixtures across {new Set(CATALOG.map((entry) => entry.type)).size} types
          and {new Set(CATALOG.map((entry) => entry.activity.family)).size} families.
        </p>
      </header>

      {CATALOG.map((entry) => (
        <section key={entry.id} className="border-border flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="flex flex-wrap items-baseline gap-2 text-sm font-semibold">
            <code>{entry.type}</code>
            <span className="text-muted font-normal">
              {entry.activity.family} · {ACTIVITY_TYPES[entry.type].category} ·{' '}
              {ACTIVITY_TYPES[entry.type].grader} · {entry.name}
            </span>
          </h2>
          {/* Storybook has no blob store and no `media://` handler, so an image reference
              resolves to nothing here and the fixture shows its pending-media placeholder —
              which is exactly what the app shows before a media job has run. */}
          <ActivityHost
            activity={entry.activity}
            seed="storybook-catalog"
            resolveMedia={() => null}
          />
        </section>
      ))}
    </div>
  )
}

const meta = {
  title: 'Activities/Fixtures',
  component: FixtureCatalog,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FixtureCatalog>

export default meta
type Story = StoryObj<typeof meta>

export const AllFixtures: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(CATALOG.length).toBeGreaterThan(0)

    const hosts = await canvas.findAllByTestId('activity-host')
    await expect(hosts).toHaveLength(CATALOG.length)

    // Renderers are one lazy chunk per family, so every host starts on its Suspense fallback;
    // the catalogue is only proven once the last of them has been replaced by a real renderer.
    await waitFor(
      async () => {
        await expect(canvas.queryAllByTestId('renderer-loading')).toHaveLength(0)
      },
      { timeout: 20_000 },
    )

    // Every fixture reached a real renderer: none fell back to "no renderer yet", and none threw
    // on the way (a renderer that throws leaves its host without a `renderer-*` child).
    await expect(canvas.queryAllByTestId('unsupported-type')).toHaveLength(0)
    await expect(canvasElement.querySelectorAll('[data-testid^="renderer-"]')).toHaveLength(
      CATALOG.length,
    )
  },
}
