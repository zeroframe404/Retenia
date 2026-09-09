import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SecretInput } from './secret-input'

describe('SecretInput', () => {
  it('masks input by default', () => {
    render(<SecretInput preview={null} value="" onChange={() => {}} />)
    const input = document.querySelector('input')
    expect(input).toHaveAttribute('type', 'password')
  })

  it('shows the masked preview as a placeholder when nothing has been typed', () => {
    render(<SecretInput preview="••••wxyz" value="" onChange={() => {}} />)
    const input = document.querySelector('input')
    expect(input).toHaveAttribute('placeholder', '••••wxyz')
  })

  it('falls back to the given placeholder when there is no stored key', () => {
    render(<SecretInput preview={null} value="" onChange={() => {}} placeholder="sk-ant-…" />)
    const input = document.querySelector('input')
    expect(input).toHaveAttribute('placeholder', 'sk-ant-…')
  })

  it('drops the preview placeholder once the user starts typing', () => {
    render(<SecretInput preview="••••wxyz" value="sk-ant-abc" onChange={() => {}} />)
    const input = document.querySelector('input')
    expect(input).not.toHaveAttribute('placeholder', '••••wxyz')
  })

  it('the reveal toggle flips the field to plain text and back', async () => {
    const user = userEvent.setup()
    render(<SecretInput preview={null} value="sk-ant-abc" onChange={() => {}} />)
    const input = document.querySelector('input')
    expect(input).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Show key' }))
    expect(input).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: 'Hide key' }))
    expect(input).toHaveAttribute('type', 'password')
  })

  it('never renders the stored value itself — only the caller-supplied value crosses into the DOM', () => {
    render(<SecretInput preview="••••wxyz" value="" onChange={() => {}} />)
    const input = document.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('')
  })
})
