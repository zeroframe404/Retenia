import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TopBar } from './top-bar'

const breadcrumbs = [{ label: 'Retenia' }, { label: 'Camino' }]

describe('TopBar', () => {
  it('renders the breadcrumb trail', () => {
    render(<TopBar breadcrumbs={breadcrumbs} onSearchClick={() => {}} searchLabel="Search" />)
    expect(screen.getByText('Retenia')).toBeInTheDocument()
    expect(screen.getByText('Camino')).toBeInTheDocument()
  })

  it('calls onSearchClick when the search trigger is clicked', () => {
    const onSearchClick = vi.fn()
    render(<TopBar breadcrumbs={breadcrumbs} onSearchClick={onSearchClick} searchLabel="Search" />)
    fireEvent.click(screen.getByTestId('open-command-palette'))
    expect(onSearchClick).toHaveBeenCalledOnce()
  })

  it('shows the XP badge by default and hides it when xpHidden (sober mode)', () => {
    const { rerender } = render(
      <TopBar
        breadcrumbs={breadcrumbs}
        onSearchClick={() => {}}
        searchLabel="Search"
        xpLabel="1,240 XP"
      />,
    )
    expect(screen.getByTestId('xp-badge')).toHaveTextContent('1,240 XP')

    rerender(
      <TopBar
        breadcrumbs={breadcrumbs}
        onSearchClick={() => {}}
        searchLabel="Search"
        xpLabel="1,240 XP"
        xpHidden
      />,
    )
    expect(screen.queryByTestId('xp-badge')).not.toBeInTheDocument()
  })
})
