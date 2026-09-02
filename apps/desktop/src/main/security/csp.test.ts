import { describe, expect, it } from 'vitest'
import { buildCsp, LOCAL_AI_ORIGINS, PROVIDER_ORIGINS } from './csp'

function directive(csp: string, name: string): string {
  const found = csp.split('; ').find((part) => part.startsWith(`${name} `) || part === name)
  if (!found) {
    throw new Error(`no "${name}" directive in: ${csp}`)
  }
  return found
}

describe('buildCsp (production)', () => {
  const csp = buildCsp()

  it.each([
    ["default-src 'self'"],
    ["script-src 'self' 'wasm-unsafe-eval'"],
    ["style-src 'self' 'unsafe-inline'"],
    ["img-src 'self' media: data: blob:"],
    ['media-src media: blob:'],
  ])('declares %s', (expected) => {
    expect(csp.split('; ')).toContain(expected)
  })

  it('never allows inline or remote script', () => {
    const scriptSrc = directive(csp, 'script-src')
    expect(scriptSrc).not.toContain('unsafe-inline')
    expect(scriptSrc).not.toContain('unsafe-eval"')
    expect(scriptSrc).not.toMatch(/https?:\/\//)
  })

  it('allows the local inference servers to be reached', () => {
    const connectSrc = directive(csp, 'connect-src')
    for (const origin of LOCAL_AI_ORIGINS) {
      expect(connectSrc).toContain(origin)
    }
  })

  it('allows every provider origin', () => {
    const connectSrc = directive(csp, 'connect-src')
    for (const origin of PROVIDER_ORIGINS) {
      expect(connectSrc).toContain(origin)
    }
    expect(PROVIDER_ORIGINS).toContain('https://api.anthropic.com')
    expect(PROVIDER_ORIGINS).toContain('https://*.speech.microsoft.com')
  })

  it('takes the provider allowlist from its caller, for settings-driven origins later', () => {
    const csp = buildCsp({ providerOrigins: ['https://example.test'] })
    expect(directive(csp, 'connect-src')).toContain('https://example.test')
    expect(directive(csp, 'connect-src')).not.toContain('anthropic')
  })

  it.each(['object-src', 'base-uri', 'form-action', 'frame-ancestors'])(
    'locks down %s, which does not fall back to default-src',
    (name) => {
      expect(directive(csp, name)).toBe(`${name} 'none'`)
    },
  )
})

describe('buildCsp (development)', () => {
  const devServerUrl = 'http://localhost:5173'
  const csp = buildCsp({ isDev: true, devServerUrl })

  it('allows the inline React Fast Refresh preamble', () => {
    expect(directive(csp, 'script-src')).toContain("'unsafe-inline'")
  })

  it('allows the HMR websocket and dev server', () => {
    const connectSrc = directive(csp, 'connect-src')
    expect(connectSrc).toContain('http://localhost:5173')
    expect(connectSrc).toContain('ws://localhost:5173')
  })

  it('relaxes nothing else', () => {
    const prod = buildCsp().split('; ')
    const dev = csp.split('; ')
    const changed = dev.filter((part, index) => part !== prod[index]).map((p) => p.split(' ')[0])
    expect(changed).toEqual(['script-src', 'connect-src'])
  })
})
