import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const app = Object.assign(new EventEmitter(), {
  requestSingleInstanceLock: vi.fn(() => true),
  quit: vi.fn(),
  setAsDefaultProtocolClient: vi.fn(),
})

vi.mock('electron', () => ({ app }))

const { deepLinkFromArgv, registerDeepLinks } = await import('./register')

beforeEach(() => {
  app.removeAllListeners()
  app.requestSingleInstanceLock = vi.fn(() => true)
  app.quit = vi.fn()
  app.setAsDefaultProtocolClient = vi.fn()
})

describe('deepLinkFromArgv', () => {
  it('finds the retenia:// argument among the rest of argv', () => {
    expect(deepLinkFromArgv(['electron', '--flag', 'retenia://review', 'other'])).toBe(
      'retenia://review',
    )
  })

  it('returns undefined when there is none', () => {
    expect(deepLinkFromArgv(['electron', '--flag'])).toBeUndefined()
  })
})

describe('registerDeepLinks', () => {
  it('registers the protocol and returns true when the lock is acquired', () => {
    const onDeepLink = vi.fn()
    expect(registerDeepLinks({ onDeepLink })).toBe(true)
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('retenia')
    expect(app.quit).not.toHaveBeenCalled()
  })

  it('quits and returns false when another instance already holds the lock', () => {
    app.requestSingleInstanceLock = vi.fn(() => false)
    const onDeepLink = vi.fn()
    expect(registerDeepLinks({ onDeepLink })).toBe(false)
    expect(app.quit).toHaveBeenCalledOnce()
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled()
  })

  it('parses a deep link out of a second-instance argv and calls onDeepLink', () => {
    const onDeepLink = vi.fn()
    registerDeepLinks({ onDeepLink })

    app.emit('second-instance', {}, ['electron', 'retenia://review'])

    expect(onDeepLink).toHaveBeenCalledWith({ kind: 'review' })
  })

  it('calls onSecondInstance even when the argv carries no deep link', () => {
    const onDeepLink = vi.fn()
    const onSecondInstance = vi.fn()
    registerDeepLinks({ onDeepLink, onSecondInstance })

    app.emit('second-instance', {}, ['electron'])

    expect(onSecondInstance).toHaveBeenCalledOnce()
    expect(onDeepLink).not.toHaveBeenCalled()
  })

  it('ignores a second-instance argv that fails to parse', () => {
    const onDeepLink = vi.fn()
    registerDeepLinks({ onDeepLink })

    app.emit('second-instance', {}, ['electron', 'retenia://bogus'])

    expect(onDeepLink).not.toHaveBeenCalled()
  })

  it('parses open-url (macOS) and prevents the default', () => {
    const onDeepLink = vi.fn()
    registerDeepLinks({ onDeepLink })

    const event = { preventDefault: vi.fn() }
    app.emit('open-url', event, 'retenia://import?src=https%3A%2F%2Fexample.com%2Fbook.pdf')

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(onDeepLink).toHaveBeenCalledWith({
      kind: 'import',
      src: 'https://example.com/book.pdf',
    })
  })
})
