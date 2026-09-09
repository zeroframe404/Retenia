import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AiUnavailableNotice } from './ai-unavailable-notice'

describe('AiUnavailableNotice', () => {
  it('renders the given reason', () => {
    render(<AiUnavailableNotice reason="Add a key in Settings to use this." />)
    expect(screen.getByText('Add a key in Settings to use this.')).toBeInTheDocument()
  })
})
