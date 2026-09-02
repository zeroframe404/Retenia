import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Heatmap } from './heatmap'

const today = new Date().toISOString().slice(0, 10)

describe('Heatmap', () => {
  it('renders the accessible table fallback with every data point', () => {
    render(
      <Heatmap
        data={[
          { date: today, value: 5 },
          { date: '2020-01-01', value: 2 },
        ]}
        weeks={12}
        caption="Reviews per day"
      />,
    )
    expect(screen.getByText('Reviews per day')).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: today })).toBeInTheDocument()
  })

  it('exposes an accessible image labelled by the table caption region', () => {
    render(<Heatmap data={[]} weeks={12} caption="Reviews per day" />)
    expect(screen.getByRole('img')).toBeInTheDocument()
  })
})
