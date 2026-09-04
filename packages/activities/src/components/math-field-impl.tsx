import { MathfieldElement } from 'mathlive'
import { useEffect, useRef } from 'react'
import type { MathFieldProps } from './math-field'

/**
 * The MathLive half of `MathField`, in its own module so `React.lazy` gets a chunk boundary.
 * Never import this file directly — import `./math-field`.
 *
 * MathLive is a custom element, so it is driven imperatively rather than through JSX props; that
 * also keeps `mathlive`'s types out of the package's public surface.
 */
export default function MathFieldImpl({
  value,
  onChange,
  disabled = false,
  placeholder,
  'aria-label': ariaLabel,
}: MathFieldProps) {
  const hostRef = useRef<HTMLSpanElement>(null)
  const fieldRef = useRef<MathfieldElement | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const field = new MathfieldElement()
    // The virtual keyboard is a floating panel that steals focus and traps Tab; a desktop app with
    // a physical keyboard does not need it, and it is an accessibility hazard inside an exam.
    field.mathVirtualKeyboardPolicy = 'manual'
    field.className = 'border-border bg-surface block w-full rounded-md border px-3 py-2 text-sm'
    field.addEventListener('input', () => onChangeRef.current(field.value))
    host.append(field)
    fieldRef.current = field
    return () => {
      field.remove()
      fieldRef.current = null
    }
  }, [])

  useEffect(() => {
    const field = fieldRef.current
    if (!field) return
    if (field.value !== value) field.value = value
    field.readOnly = disabled
    if (ariaLabel !== undefined) field.setAttribute('aria-label', ariaLabel)
    if (placeholder !== undefined) field.setAttribute('placeholder', placeholder)
  }, [ariaLabel, disabled, placeholder, value])

  return <span ref={hostRef} data-testid="math-field" className="block w-full" />
}
