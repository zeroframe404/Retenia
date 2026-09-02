import type { IdGenerator } from '@retenia/core'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeSourceAnchor, ReaderPlaceholder } from './index'

const ids: IdGenerator = { next: () => 'anchor-1' }

describe('@retenia/readers', () => {
  it('creates a placeholder source anchor with a generated id', () => {
    expect(makeSourceAnchor(ids, 'pdf')).toEqual({ id: 'anchor-1', kind: 'pdf' })
  })

  it('renders a ui component for the given source kind', () => {
    render(<ReaderPlaceholder kind="pdf" />)
    expect(screen.getByRole('heading', { name: 'Reader: pdf' })).toBeInTheDocument()
  })
})
