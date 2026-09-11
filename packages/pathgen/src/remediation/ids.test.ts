import { describe, expect, it } from 'vitest'
import {
  isCoreLessonSpecId,
  isRemediationSpecId,
  parseRemediationSpecId,
  remediationSpecId,
} from './ids'

describe('remediationSpecId()', () => {
  it('mints L07.r1 when nothing is taken yet', () => {
    expect(remediationSpecId('L07', [])).toBe('L07.r1')
  })

  it('mints the next number after the highest taken id of that anchor', () => {
    expect(remediationSpecId('L07', ['L07.r1', 'L07.r3'])).toBe('L07.r4')
  })

  it('ignores ids anchored to other lessons, including a prefix look-alike', () => {
    expect(remediationSpecId('L07', ['L08.r5', 'L070.r2'])).toBe('L07.r1')
  })

  it.each(['L07.r1', 'S01M1.reinf', 'C02', ''])(
    'throws RangeError for a non-core anchor %j',
    (anchor) => {
      expect(() => remediationSpecId(anchor, [])).toThrow(RangeError)
    },
  )
})

describe('parseRemediationSpecId()', () => {
  it('parses the anchor and number of a remediation id', () => {
    expect(parseRemediationSpecId('L07.r12')).toEqual({ anchor: 'L07', n: 12 })
  })

  it.each(['L07', 'L07.r0', 'L07.r', 'X07.r1'])('returns null for %j', (specId) => {
    expect(parseRemediationSpecId(specId)).toBeNull()
  })
})

describe('isRemediationSpecId() / isCoreLessonSpecId()', () => {
  it('recognises a remediation id and rejects a core id', () => {
    expect(isRemediationSpecId('L07.r1')).toBe(true)
    expect(isRemediationSpecId('L07')).toBe(false)
  })

  it('recognises a core lesson id and rejects a remediation id', () => {
    expect(isCoreLessonSpecId('L07')).toBe(true)
    expect(isCoreLessonSpecId('L07.r1')).toBe(false)
  })
})
