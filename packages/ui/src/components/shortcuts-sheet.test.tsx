import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SHORTCUTS } from '../shortcuts'
import { ShortcutsSheet } from './shortcuts-sheet'

const translate = (key: string) => `t:${key}`

describe('ShortcutsSheet', () => {
  it('renders nothing when closed', () => {
    render(
      <ShortcutsSheet
        open={false}
        onOpenChange={() => {}}
        shortcuts={SHORTCUTS}
        translate={translate}
      />,
    )
    expect(screen.queryByText('t:shortcuts.title')).not.toBeInTheDocument()
  })

  it('lists every shortcut, translated, grouped by scope, when open', () => {
    render(
      <ShortcutsSheet open onOpenChange={() => {}} shortcuts={SHORTCUTS} translate={translate} />,
    )
    expect(screen.getByText('t:shortcuts.title')).toBeInTheDocument()
    expect(screen.getByText('t:shortcuts.scopeGlobal')).toBeInTheDocument()
    expect(screen.getByText('t:shortcuts.scopeReview')).toBeInTheDocument()
    for (const shortcut of SHORTCUTS) {
      expect(screen.getByText(`t:${shortcut.description}`)).toBeInTheDocument()
    }
  })

  it('renders each key combo as separate Kbd parts', () => {
    render(
      <ShortcutsSheet open onOpenChange={() => {}} shortcuts={SHORTCUTS} translate={translate} />,
    )
    expect(screen.getAllByText('ctrl').length).toBeGreaterThan(0)
    expect(screen.getByText('k')).toBeInTheDocument()
  })
})
