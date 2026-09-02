import type { IdGenerator } from '@retenia/core'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ActivityHostPlaceholder, makeActivityPlaceholder } from './index'

const ids: IdGenerator = { next: () => 'activity-1' }

describe('@retenia/activities', () => {
  it('creates a placeholder activity type with a generated id', () => {
    expect(makeActivityPlaceholder(ids, 'cloze')).toEqual({ id: 'activity-1', family: 'cloze' })
  })

  it('renders a ui component for the given family', () => {
    render(<ActivityHostPlaceholder family="cloze" />)
    expect(screen.getByRole('heading', { name: 'Activity family: cloze' })).toBeInTheDocument()
  })
})
