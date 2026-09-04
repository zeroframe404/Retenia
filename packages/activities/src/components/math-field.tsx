import { lazy, Suspense } from 'react'

/**
 * A LaTeX input for the math types (`expression_input`, `matrix_input`, `calculated_variant` —
 * phase 3 of §6). MathLive is a ~700 kB web component that only those types need, so it is behind
 * `React.lazy`: importing `@retenia/activities` never pulls it into the first paint, and the
 * chunk is fetched the first time a math activity is rendered.
 *
 * The value is the LaTeX string; the CAS grader (math.js sampling, §10) parses it, not this
 * component.
 */

export interface MathFieldProps {
  value: string
  onChange: (latex: string) => void
  disabled?: boolean
  'aria-label'?: string
  placeholder?: string
}

const MathFieldImpl = lazy(async () => {
  const { default: Component } = await import('./math-field-impl')
  return { default: Component }
})

export function MathField(props: MathFieldProps) {
  return (
    <Suspense
      fallback={
        <div
          className="border-border bg-surface h-10 animate-pulse rounded-md border"
          data-testid="math-field-loading"
        />
      }
    >
      <MathFieldImpl {...props} />
    </Suspense>
  )
}
