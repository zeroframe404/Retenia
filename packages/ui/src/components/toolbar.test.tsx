import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Toolbar } from './toolbar'

describe('Toolbar', () => {
  it('exposes toolbar semantics', () => {
    render(<Toolbar start={<span>Start</span>} />)
    expect(screen.getByRole('toolbar')).toBeInTheDocument()
  })

  it('renders start, center and end content', () => {
    render(
      <Toolbar start={<span>Start</span>} end={<span>End</span>}>
        <span>Center</span>
      </Toolbar>,
    )
    expect(screen.getByText('Start')).toBeInTheDocument()
    expect(screen.getByText('Center')).toBeInTheDocument()
    expect(screen.getByText('End')).toBeInTheDocument()
  })
})
