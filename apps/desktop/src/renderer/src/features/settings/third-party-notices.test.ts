import { describe, expect, it } from 'vitest'
import { THIRD_PARTY_NOTICES } from './third-party-notices'

describe('THIRD_PARTY_NOTICES', () => {
  it('names every source-URL as an https link, and every entry a real SPDX licence', () => {
    for (const notice of THIRD_PARTY_NOTICES) {
      expect(notice.sourceUrl).toMatch(/^https:\/\//)
      expect(notice.license.length).toBeGreaterThan(0)
      expect(notice.detail.length).toBeGreaterThan(0)
    }
  })

  it('carries the two LGPL obligations docs/dev/sidecars.md records: ffmpeg and libvips', () => {
    const lgpl = THIRD_PARTY_NOTICES.filter((notice) => notice.license === 'LGPL-3.0-or-later')
    expect(lgpl.map((notice) => notice.name).sort()).toEqual(['ffmpeg', 'libvips'])
  })

  it('has no duplicate names', () => {
    const names = THIRD_PARTY_NOTICES.map((notice) => notice.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
