import type { Meta, StoryObj } from '@storybook/react-vite'

const PALETTES = [
  { name: 'brand', label: 'Brand (indigo)' },
  { name: 'teal', label: 'Teal (accent)' },
  { name: 'amber', label: 'Amber (warning)' },
  { name: 'red', label: 'Red (danger)' },
  { name: 'neutral', label: 'Neutral' },
] as const

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

const SEMANTIC_TOKENS = [
  'bg',
  'surface',
  'text',
  'muted',
  'border',
  'correct',
  'incorrect',
  'xp',
  'streak',
] as const

function PaletteRow({ name, label }: { name: string; label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted text-sm font-medium">{label}</p>
      <div className="flex overflow-hidden rounded-md">
        {STEPS.map((step) => (
          <div
            key={step}
            className="flex h-16 flex-1 flex-col items-center justify-end pb-1"
            style={{ backgroundColor: `var(--color-${name}-${step})` }}
          >
            <span
              className="text-[10px] font-medium"
              style={{ color: step >= 500 ? 'white' : 'black' }}
            >
              {step}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TokensPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <section className="flex flex-col gap-6">
        <h2 className="font-display text-xl font-semibold">Color palette</h2>
        {PALETTES.map((p) => (
          <PaletteRow key={p.name} {...p} />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl font-semibold">Semantic tokens</h2>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {SEMANTIC_TOKENS.map((token) => (
            <div key={token} className="border-border flex flex-col gap-2 rounded-md border p-3">
              <div
                className="border-border h-10 rounded border"
                style={{ backgroundColor: `var(--color-${token})` }}
              />
              <code className="text-xs">--color-{token}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl font-semibold">Type scale</h2>
        <div className="flex flex-col gap-2">
          <p className="font-sans text-xs">font-sans (Inter Variable) · text-xs</p>
          <p className="font-sans text-sm">font-sans (Inter Variable) · text-sm</p>
          <p className="font-sans text-base">font-sans (Inter Variable) · text-base</p>
          <p className="font-sans text-lg">font-sans (Inter Variable) · text-lg</p>
          <p className="font-display text-xl font-semibold">
            font-display (Nunito Variable) · text-xl
          </p>
          <p className="font-display text-2xl font-bold">
            font-display (Nunito Variable) · text-2xl
          </p>
          <p className="font-mono text-sm">font-mono (JetBrains Mono Variable) · const x = 42</p>
          <p className="text-base" style={{ fontFamily: 'Atkinson Hyperlegible' }}>
            Atkinson Hyperlegible · opt-in via TypographySettings' dyslexiaFont
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl font-semibold">Radii & shadow</h2>
        <div className="flex gap-4">
          <div className="bg-brand-100 size-16 rounded-sm" />
          <div className="bg-brand-100 size-16 rounded-md" />
          <div className="bg-brand-100 size-16 rounded-lg" />
          <div className="bg-surface size-16 rounded-lg shadow-soft" />
        </div>
      </section>
    </div>
  )
}

const meta = {
  title: 'Foundations/Tokens',
  render: () => <TokensPage />,
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
