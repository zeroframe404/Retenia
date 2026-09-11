import type { DiagnosticSession } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { diagnosticRemediationSignals, remediationItemIds } from './diagnostic-remediations'

/** The diagnostic's confident misconceptions becoming §11 triggers (sub-phase 8.6). */

/** `result` is JSON off a row; the fixtures deliberately include what a row should not hold. */
const session = (result: unknown) => ({
  id: 'session-1',
  pathVersionId: 'version-1',
  result: result as DiagnosticSession['result'],
})

const RESULT = {
  actions: [
    { kind: 'mark_completed', moduleId: 'm1' },
    {
      kind: 'insert_remediation',
      moduleId: 'm2',
      itemId: 'item-1',
      conceptIds: ['c1', 7, 'c2'],
      misconceptionId: 'X001',
    },
    { kind: 'insert_remediation', moduleId: 'm3', itemId: 'item-2', conceptIds: ['c3'] },
    'junk',
  ],
}

describe('diagnosticRemediationSignals', () => {
  it('turns each insert_remediation action into a confident, wrong answer', () => {
    const signals = diagnosticRemediationSignals(
      session(RESULT),
      new Map([['item-1', '¿Qué mide la velocidad?']]),
    )
    expect(signals).toEqual([
      {
        kind: 'confident_error',
        pathVersionId: 'version-1',
        context: 'diagnostic',
        conceptIds: ['c1', 'c2'],
        misconceptionId: 'X001',
        confidence: 'sure',
        correct: false,
        itemId: 'item-1',
        moduleId: 'm2',
        sessionId: 'session-1',
        error: { stem: '¿Qué mide la velocidad?', chosen: null, correct: null },
      },
      {
        kind: 'confident_error',
        pathVersionId: 'version-1',
        context: 'diagnostic',
        conceptIds: ['c3'],
        misconceptionId: null,
        confidence: 'sure',
        correct: false,
        itemId: 'item-2',
        moduleId: 'm3',
        sessionId: 'session-1',
        error: null,
      },
    ])
  })

  it('reads nothing out of a session with no result or no actions', () => {
    expect(diagnosticRemediationSignals(session(null), new Map())).toEqual([])
    expect(diagnosticRemediationSignals(session({ actions: 'x' }), new Map())).toEqual([])
  })

  it('names the item ids whose stems the signals need', () => {
    expect(remediationItemIds(session(RESULT))).toEqual(['item-1', 'item-2'])
    expect(remediationItemIds(session(null))).toEqual([])
  })
})
