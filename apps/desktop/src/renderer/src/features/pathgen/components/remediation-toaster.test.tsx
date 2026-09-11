import type { PathgenRemediationEvent, RemediationDto } from '@retenia/ipc-contract'
import { act, render } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'

/**
 * The "desvío sugerido" toast (sub-phase 8.6, `docs/spec/04-path-generation.md` §11): the pure
 * `remediationReason`/`remediationToast` helpers, and one mount that checks the component wires
 * a `pathgen.remediation` push to `toast`.
 */

vi.mock('@retenia/ui', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
}))

const t = i18n.getFixedT('es-AR', 'path')

const BASE_REMEDIATION: RemediationDto = {
  id: '019213cd-0000-7000-8000-000000000100',
  pathVersionId: '019213cd-0000-7000-8000-000000000010',
  moduleId: '019213cd-0000-7000-8000-000000000030',
  conceptId: 'c1',
  conceptName: 'Vectores',
  misconceptionId: null,
  trigger: 'reinforcement_low',
  status: 'active',
  refusal: null,
  lessonId: '019213cd-0000-7000-8000-000000000200',
  specId: 'L07.r1',
  anchorLessonId: '019213cd-0000-7000-8000-000000000020',
  anchorSpecId: 'L07',
  position: 'after',
  title: null,
  lessonStatus: 'ready',
  estimatedMinutes: 8,
  reasons: { accuracy: 0.4, lapses: null, meanR: null, failures: null, context: null },
  revisitLessonId: null,
  boostedCards: 0,
  boostExpiresAt: null,
  createdAt: '2026-09-10T00:00:00.000Z',
  resolvedAt: null,
}

function remediation(overrides: Partial<RemediationDto> = {}): RemediationDto {
  return { ...BASE_REMEDIATION, ...overrides }
}

const { remediationReason, remediationToast, RemediationToaster } = await import(
  './remediation-toaster'
)

describe('remediationReason', () => {
  it('reinforcement_low: turns the accuracy fraction into a rounded percent', () => {
    const reason = remediationReason(t, remediation({ trigger: 'reinforcement_low' }))
    expect(reason).toContain('40')
    expect(reason).toContain('Vectores')
  })

  it('memory_lapses: carries the lapse count', () => {
    const reason = remediationReason(
      t,
      remediation({
        trigger: 'memory_lapses',
        reasons: { accuracy: null, lapses: 3, meanR: null, failures: null, context: null },
      }),
    )
    expect(reason).toContain('3')
    expect(reason).toContain('Vectores')
  })

  it('memory_retention: turns the mean retrievability fraction into a rounded percent', () => {
    const reason = remediationReason(
      t,
      remediation({
        trigger: 'memory_retention',
        reasons: { accuracy: null, lapses: null, meanR: 0.65, failures: null, context: null },
      }),
    )
    expect(reason).toContain('65')
    expect(reason).toContain('Vectores')
  })
})

describe('remediationToast', () => {
  it('inserted: kind info, title falls back to the concept name when there is no remediation title', () => {
    const event: PathgenRemediationEvent = {
      kind: 'inserted',
      remediation: remediation({ title: null, conceptName: 'Vectores' }),
    }
    const shown = remediationToast(t, event)
    expect(shown?.kind).toBe('info')
    expect(shown?.title).toBe(t('remediation.toastTitle', { title: 'Vectores' }))
    expect(shown?.description).toBe(remediationReason(t, event.remediation))
  })

  it("inserted: title prefers the remediation's own title over the concept name", () => {
    const event: PathgenRemediationEvent = {
      kind: 'inserted',
      remediation: remediation({ title: 'Repaso de vectores', conceptName: 'Vectores' }),
    }
    const shown = remediationToast(t, event)
    expect(shown?.title).toBe(t('remediation.toastTitle', { title: 'Repaso de vectores' }))
  })

  it('failed: kind error', () => {
    const event: PathgenRemediationEvent = {
      kind: 'failed',
      remediation: remediation({ conceptName: 'Vectores' }),
    }
    const shown = remediationToast(t, event)
    expect(shown).toEqual({
      kind: 'error',
      title: t('remediation.failed', { concept: 'Vectores' }),
    })
  })

  it('refused, trigger user_request: kind warning, the refusal sentence', () => {
    const event: PathgenRemediationEvent = {
      kind: 'refused',
      remediation: remediation({
        trigger: 'user_request',
        refusal: 'weekly_limit',
        conceptName: 'Vectores',
      }),
    }
    const shown = remediationToast(t, event)
    expect(shown).toEqual({
      kind: 'warning',
      title: t('remediation.refused.weekly_limit', { concept: 'Vectores' }),
    })
  })

  it("refused from a trigger other than user_request: null (the log's business, not a toast)", () => {
    const event: PathgenRemediationEvent = {
      kind: 'refused',
      remediation: remediation({ trigger: 'memory_lapses', refusal: 'weekly_limit' }),
    }
    expect(remediationToast(t, event)).toBeNull()
  })

  it('updated: null', () => {
    const event: PathgenRemediationEvent = { kind: 'updated', remediation: remediation() }
    expect(remediationToast(t, event)).toBeNull()
  })

  it('removed: null', () => {
    const event: PathgenRemediationEvent = { kind: 'removed', remediation: remediation() }
    expect(remediationToast(t, event)).toBeNull()
  })
})

describe('RemediationToaster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function stubApi() {
    let listener: ((payload: PathgenRemediationEvent) => void) | undefined
    const api = {
      events: {
        on: vi.fn((name: string, cb: (payload: PathgenRemediationEvent) => void) => {
          if (name === 'pathgen.remediation') listener = cb
          return vi.fn()
        }),
      },
    }
    vi.stubGlobal('api', api)
    window.api = api as unknown as typeof window.api
    return {
      fire: (event: PathgenRemediationEvent) => {
        if (listener === undefined) throw new Error('no pathgen.remediation listener registered')
        act(() => listener?.(event))
      },
    }
  }

  function wrapper({ children }: PropsWithChildren) {
    return <>{children}</>
  }

  it('shows a toast when a "pathgen.remediation" push announces an inserted detour', async () => {
    const { toast } = await import('@retenia/ui')
    const { fire } = stubApi()
    render(<RemediationToaster />, { wrapper })

    fire({
      kind: 'inserted',
      remediation: remediation({ title: null, conceptName: 'Vectores' }),
    })

    expect(toast).toHaveBeenCalledWith(
      t('remediation.toastTitle', { title: 'Vectores' }),
      expect.objectContaining({ description: expect.stringContaining('Vectores') }),
    )
  })
})
