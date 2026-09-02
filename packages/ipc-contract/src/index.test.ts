import { describe, expect, it } from 'vitest'
import { appPing, channelMap } from './index'

describe('@retenia/ipc-contract', () => {
  it('names channels as domain.action', () => {
    expect(appPing.channel).toBe('app.ping')
  })

  it('validates a well-formed payload', () => {
    const parsed = appPing.input.parse({ sentAt: '2026-09-02T00:00:00.000Z' })
    expect(parsed.sentAt).toBe('2026-09-02T00:00:00.000Z')
  })

  it('rejects a malformed payload', () => {
    expect(() => appPing.input.parse({ sentAt: 'not-a-date' })).toThrow()
  })

  it('registers the channel in the channel map', () => {
    expect(channelMap['app.ping']).toBe(appPing)
  })
})
