import { fireEvent, render, screen } from '@testing-library/react'
import { HomeIcon, RouteIcon } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './sidebar'

const items = [
  { id: 'home', label: 'Hoy', icon: HomeIcon, active: true },
  { id: 'path', label: 'Camino', icon: RouteIcon, badge: 3 },
]

describe('Sidebar', () => {
  it('renders every item label and its badge when expanded', () => {
    render(
      <Sidebar
        items={items}
        collapsed={false}
        onToggleCollapsed={() => {}}
        onSelect={() => {}}
        collapseLabel="Collapse"
        expandLabel="Expand"
      />,
    )
    expect(screen.getByText('Hoy')).toBeInTheDocument()
    expect(screen.getByText('Camino')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('calls onSelect with the item id when clicked', () => {
    const onSelect = vi.fn()
    render(
      <Sidebar
        items={items}
        collapsed={false}
        onToggleCollapsed={() => {}}
        onSelect={onSelect}
        collapseLabel="Collapse"
        expandLabel="Expand"
      />,
    )
    fireEvent.click(screen.getByTestId('sidebar-item-path'))
    expect(onSelect).toHaveBeenCalledWith('path')
  })

  it('calls onToggleCollapsed and swaps the toggle label', () => {
    const onToggleCollapsed = vi.fn()
    render(
      <Sidebar
        items={items}
        collapsed={false}
        onToggleCollapsed={onToggleCollapsed}
        onSelect={() => {}}
        collapseLabel="Collapse"
        expandLabel="Expand"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(onToggleCollapsed).toHaveBeenCalledOnce()
  })

  it('marks the active item with aria-current', () => {
    render(
      <Sidebar
        items={items}
        collapsed={false}
        onToggleCollapsed={() => {}}
        onSelect={() => {}}
        collapseLabel="Collapse"
        expandLabel="Expand"
      />,
    )
    expect(screen.getByTestId('sidebar-item-home')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('sidebar-item-path')).not.toHaveAttribute('aria-current')
  })
})
