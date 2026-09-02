import { describe, expect, expectTypeOf, it } from 'vitest'
import type { AssertNoEventsDomain, InferInput, InferOutput } from './index'
import {
  channelNames,
  contract,
  defineContract,
  eventNames,
  events,
  ipcFail,
  ipcOk,
  isChannelName,
  isEventName,
} from './index'

describe('contract', () => {
  it('names every channel domain.action', () => {
    for (const name of channelNames) {
      expect(name).toMatch(/^[a-z][a-z0-9]*\.[a-z][A-Za-z0-9]*$/)
    }
  })

  it('declares the channels the app implements', () => {
    expect([...channelNames].sort()).toEqual([
      'app.devMediaSampleUrl',
      'app.getVersion',
      'app.ping',
    ])
    expect([...eventNames].sort()).toEqual(['app.deepLink', 'app.themeChanged'])
  })

  it('never declares a domain called "events"', () => {
    // A domain named `events` would collide with `api.events.on`. If this ever stops
    // resolving to `never`, the type below fails to compile.
    expectTypeOf<AssertNoEventsDomain<typeof contract>>().toBeNever()
  })
})

describe('app.ping', () => {
  const { input, output } = contract['app.ping']

  it('accepts an ISO timestamp', () => {
    expect(input.parse({ sentAt: '2026-09-02T00:00:00.000Z' })).toEqual({
      sentAt: '2026-09-02T00:00:00.000Z',
    })
  })

  it.each([
    ['a non-ISO string', { sentAt: 'not-a-date' }],
    ['a missing field', {}],
    ['a wrong type', { sentAt: 42 }],
    ['a non-object', 'nope'],
  ])('rejects %s', (_label, payload) => {
    expect(input.safeParse(payload).success).toBe(false)
  })

  it('validates the response too', () => {
    expect(
      output.safeParse({ sentAt: '2026-09-02T00:00:00.000Z', receivedAt: 'later' }).success,
    ).toBe(false)
  })

  it('infers its payload types', () => {
    expectTypeOf<InferInput<typeof contract, 'app.ping'>>().toEqualTypeOf<{ sentAt: string }>()
    expectTypeOf<InferOutput<typeof contract, 'app.ping'>>().toEqualTypeOf<{
      sentAt: string
      receivedAt: string
    }>()
  })
})

describe('app.getVersion', () => {
  it('takes no input', () => {
    expect(contract['app.getVersion'].input.safeParse(undefined).success).toBe(true)
    expectTypeOf<InferInput<typeof contract, 'app.getVersion'>>().toEqualTypeOf<void>()
  })

  it('requires all four version strings', () => {
    const { output } = contract['app.getVersion']
    expect(output.safeParse({ app: '1', electron: '2', chrome: '3', node: '4' }).success).toBe(true)
    expect(output.safeParse({ app: '1', electron: '2', chrome: '3' }).success).toBe(false)
  })
})

describe('app.themeChanged', () => {
  it('accepts only the two themes', () => {
    expect(events['app.themeChanged'].safeParse({ theme: 'dark' }).success).toBe(true)
    expect(events['app.themeChanged'].safeParse({ theme: 'sepia' }).success).toBe(false)
  })
})

describe('app.deepLink', () => {
  const schema = events['app.deepLink']

  it.each([
    { kind: 'import', src: 'https://example.com/book.pdf' },
    { kind: 'review' },
    { kind: 'authCallback', params: { code: 'abc' } },
  ])('accepts a %o payload', (payload) => {
    expect(schema.safeParse(payload).success).toBe(true)
  })

  it.each([
    ['an unknown kind', { kind: 'nope' }],
    ['import missing its src', { kind: 'import' }],
    ['authCallback with non-string params', { kind: 'authCallback', params: { code: 1 } }],
  ])('rejects %s', (_label, payload) => {
    expect(schema.safeParse(payload).success).toBe(false)
  })
})

describe('app.devMediaSampleUrl', () => {
  it('takes no input and returns a nullable url', () => {
    const { input, output } = contract['app.devMediaSampleUrl']
    expect(input.safeParse(undefined).success).toBe(true)
    expect(output.safeParse({ url: 'media://blob/abc.ogg' }).success).toBe(true)
    expect(output.safeParse({ url: null }).success).toBe(true)
    expect(output.safeParse({}).success).toBe(false)
  })
})

describe('isChannelName / isEventName', () => {
  it('accepts declared names', () => {
    expect(isChannelName('app.ping')).toBe(true)
    expect(isEventName('app.themeChanged')).toBe(true)
  })

  it.each(['app.notDeclared', 'cards.review', '', 'toString', '__proto__', 'constructor'])(
    'rejects %j',
    (name) => {
      expect(isChannelName(name)).toBe(false)
      expect(isEventName(name)).toBe(false)
    },
  )

  it('rejects non-strings', () => {
    expect(isChannelName(undefined)).toBe(false)
    expect(isChannelName({ 'app.ping': true })).toBe(false)
  })
})

describe('envelope', () => {
  it('wraps success and failure', () => {
    expect(ipcOk({ a: 1 })).toEqual({ ok: true, data: { a: 1 } })
    expect(ipcFail('INVALID_INPUT', 'bad')).toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'bad' },
    })
  })
})

describe('defineContract', () => {
  it('keeps channel names literal', () => {
    const declared = defineContract({ 'demo.action': contract['app.ping'] })
    expectTypeOf<keyof typeof declared>().toEqualTypeOf<'demo.action'>()
  })
})
