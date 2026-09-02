import type { IdGenerator } from '@retenia/core'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EditorPlaceholder, makeNoteBlock } from './index'

const ids: IdGenerator = { next: () => 'block-1' }

describe('@retenia/editor', () => {
  it('creates a placeholder note block with a generated id', () => {
    expect(makeNoteBlock(ids, 'hola')).toEqual({ id: 'block-1', text: 'hola' })
  })

  it('renders a ui component for the given text', () => {
    render(<EditorPlaceholder text="hola" />)
    expect(screen.getByRole('heading', { name: 'Note: hola' })).toBeInTheDocument()
  })
})
