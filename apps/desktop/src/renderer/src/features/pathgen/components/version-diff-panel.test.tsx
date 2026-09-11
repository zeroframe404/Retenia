import type { VersionDiffDto } from '@retenia/ipc-contract'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import '../../../i18n'

/**
 * "Regenerar ruta crea v2 con un diff" (sub-phase 8.6): the presentational diff panel, over a
 * fixture with one lesson of each change kind.
 */

const DIFF: VersionDiffDto = {
  fromVersion: 1,
  toVersion: 2,
  lessons: [
    {
      change: 'unchanged',
      specId: 'L01',
      title: 'Cinemática',
      previousSpecId: 'L01',
      previousTitle: 'Cinemática',
      addedConcepts: [],
      removedConcepts: [],
      keptConcepts: ['c1'],
    },
    {
      change: 'changed',
      specId: 'L02',
      title: 'Dinámica avanzada',
      previousSpecId: 'L02',
      previousTitle: 'Dinámica',
      addedConcepts: ['c2'],
      removedConcepts: ['c5'],
      keptConcepts: [],
    },
    {
      change: 'added',
      specId: 'L03',
      title: 'Termodinámica',
      previousSpecId: null,
      previousTitle: null,
      addedConcepts: ['c4'],
      removedConcepts: [],
      keptConcepts: [],
    },
    {
      change: 'removed',
      specId: null,
      title: null,
      previousSpecId: 'L04',
      previousTitle: 'Óptica',
      addedConcepts: [],
      removedConcepts: ['c6'],
      keptConcepts: [],
    },
  ],
  concepts: { added: ['c2', 'c4'], removed: ['c5', 'c6'], kept: 1 },
  summary: { unchanged: 1, changed: 1, added: 1, removed: 1 },
  // c5 and c6 are deliberately absent, to exercise the id fallback.
  conceptNames: { c2: 'Fuerza neta', c4: 'Entropía' },
}

const { VersionDiffPanel } = await import('./version-diff-panel')

describe('VersionDiffPanel', () => {
  it('renders the summary counts', () => {
    render(<VersionDiffPanel diff={DIFF} />)

    expect(screen.getByTestId('version-diff-summary')).toHaveTextContent(
      '1 sin cambios · 1 cambiadas · 1 nuevas · 1 quitadas',
    )
  })

  it('renders one row per lesson, tagged with its change', () => {
    render(<VersionDiffPanel diff={DIFF} />)

    const rows = screen.getAllByTestId('version-diff-lesson')
    expect(rows).toHaveLength(4)
    expect(rows.map((row) => row.getAttribute('data-change'))).toEqual([
      'unchanged',
      'changed',
      'added',
      'removed',
    ])
  })

  it('resolves concept ids to their names, falling back to the id when unmapped', () => {
    render(<VersionDiffPanel diff={DIFF} />)

    // L02 (changed): addedConcepts=['c2'] -> mapped; removedConcepts=['c5'] -> unmapped, falls
    // back to the raw id.
    expect(screen.getByText('Suma: Fuerza neta')).toBeInTheDocument()
    expect(screen.getByText('Quita: c5')).toBeInTheDocument()
  })

  it('shows "Antes: …" only for a changed lesson whose title actually changed', () => {
    render(<VersionDiffPanel diff={DIFF} />)

    // L02 changed from "Dinámica" to "Dinámica avanzada".
    expect(screen.getByText('Antes: Dinámica')).toBeInTheDocument()
    // L01 is unchanged (same title before and after): no "Antes" line for it.
    expect(screen.queryByText('Antes: Cinemática')).not.toBeInTheDocument()
  })
})
