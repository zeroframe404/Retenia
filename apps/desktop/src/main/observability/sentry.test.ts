import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const init = vi.fn()
vi.mock('@sentry/electron/main', () => ({
  init,
  IPCMode: { Classic: 1, Protocol: 2, Both: 3 },
}))

const { initSentryMain } = await import('./sentry')

const originalDsn = process.env.SENTRY_DSN

beforeEach(() => {
  init.mockClear()
})

afterEach(() => {
  process.env.SENTRY_DSN = originalDsn
})

describe('initSentryMain', () => {
  it('does nothing when telemetry is disabled', () => {
    process.env.SENTRY_DSN = 'https://example.ingest.sentry.io/1'
    initSentryMain(false)
    expect(init).not.toHaveBeenCalled()
  })

  it('does nothing when no DSN is configured, even if enabled', () => {
    delete process.env.SENTRY_DSN
    initSentryMain(true)
    expect(init).not.toHaveBeenCalled()
  })

  it('initializes with sendDefaultPii off when enabled and a DSN is present', () => {
    process.env.SENTRY_DSN = 'https://example.ingest.sentry.io/1'
    initSentryMain(true)
    expect(init).toHaveBeenCalledOnce()
    const options = init.mock.calls[0]?.[0]
    expect(options.dsn).toBe('https://example.ingest.sentry.io/1')
    expect(options.sendDefaultPii).toBe(false)
  })

  it('scrubs user and request data from an event', () => {
    process.env.SENTRY_DSN = 'https://example.ingest.sentry.io/1'
    initSentryMain(true)
    const options = init.mock.calls[0]?.[0]
    const event = options.beforeSend({
      user: { id: '1', email: 'a@b.com' },
      request: { url: 'https://example.com' },
    })
    expect(event.user).toBeUndefined()
    expect(event.request).toBeUndefined()
  })

  it('disables the classic and protocol IPC transports, so no sentry-ipc bridge is opened', () => {
    process.env.SENTRY_DSN = 'https://example.ingest.sentry.io/1'
    initSentryMain(true)
    const options = init.mock.calls[0]?.[0]
    expect(options.ipcMode).toBe(0)
    expect(options.getSessions()).toEqual([])
  })

  it('filters the PreloadInjection integration out of the defaults', () => {
    process.env.SENTRY_DSN = 'https://example.ingest.sentry.io/1'
    initSentryMain(true)
    const options = init.mock.calls[0]?.[0]
    const defaults = [{ name: 'PreloadInjection' }, { name: 'ElectronContext' }]
    expect(options.integrations(defaults)).toEqual([{ name: 'ElectronContext' }])
  })

  it('drops console and http breadcrumbs, keeps the rest', () => {
    process.env.SENTRY_DSN = 'https://example.ingest.sentry.io/1'
    initSentryMain(true)
    const options = init.mock.calls[0]?.[0]
    expect(options.beforeBreadcrumb({ category: 'console' })).toBeNull()
    expect(options.beforeBreadcrumb({ category: 'http' })).toBeNull()
    expect(options.beforeBreadcrumb({ category: 'navigation' })).toEqual({
      category: 'navigation',
    })
  })
})
