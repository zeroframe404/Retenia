import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildCsp, RENDERER_PROVIDER_ORIGINS } from './csp'

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
    ["style-src 'self'"],
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

  it('never allows inline style', () => {
    expect(directive(csp, 'style-src')).not.toContain('unsafe-inline')
  })

  it('allows fetch() against a media:// blob, not just <audio>/<video> src', () => {
    expect(directive(csp, 'connect-src')).toContain('media:')
  })

  it('lets the renderer reach nothing but itself and its own blobs', () => {
    // Exact equality, not "does not contain anthropic": a future entry has to be added
    // deliberately, by someone who then has to say why in this test.
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' media:")
  })

  it('grants the renderer no provider and no local-inference origin', () => {
    // Every AI call runs in main, where the keys are, and `net.fetch` does not consult a
    // document policy. Ollama and LM Studio are reached from main and from the embedding
    // utility process. Granting the process that renders untrusted PDFs and pasted HTML an
    // egress no feature uses is only an exit.
    const connectSrc = directive(csp, 'connect-src')
    expect(RENDERER_PROVIDER_ORIGINS).toEqual([])
    expect(connectSrc).not.toMatch(/https?:\/\//)
    expect(connectSrc).not.toContain('11434')
    expect(connectSrc).not.toContain('1234')
  })

  it('takes the provider allowlist from its caller, for 11.2 Azure Speech', () => {
    // The seam survives: sub-phase 11.2 assesses pronunciation from the renderer, because
    // that is where the microphone stream lives, and will argue for exactly one origin.
    const csp = buildCsp({ providerOrigins: ['https://example.test'] })
    expect(directive(csp, 'connect-src')).toContain('https://example.test')
    expect(directive(csp, 'connect-src')).not.toContain('anthropic')
  })

  it('names no provider origin anywhere in the renderer bundle', () => {
    // If this ever fails, that origin genuinely belongs in `connect-src` — and adding it
    // is then a deliberate decision rather than a leftover.
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../renderer')
    const offenders: string[] = []
    for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue
      const file = path.join(entry.parentPath, entry.name)
      for (const [index, line] of readFileSync(file, 'utf-8').split('\n').entries()) {
        if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) continue
        if (/api\.anthropic\.com|generativelanguage|openrouter\.ai|:11434|:1234/.test(line)) {
          offenders.push(`${path.relative(root, file)}:${index + 1}: ${line.trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
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
  const csp = buildCsp({ devServerUrl })

  it('allows the inline React Fast Refresh preamble', () => {
    expect(directive(csp, 'script-src')).toContain("'unsafe-inline'")
  })

  it('allows inline style, for Vite CSS HMR', () => {
    expect(directive(csp, 'style-src')).toContain("'unsafe-inline'")
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
    expect(changed).toEqual(['script-src', 'style-src', 'connect-src'])
  })

  it('stays strict when no dev server is serving the renderer', () => {
    // `app.isPackaged` is false for any unpackaged run — an E2E launch, a packaged-build
    // smoke test — and those still serve the real `app://` renderer. Only the presence of
    // a dev server may relax the policy.
    expect(buildCsp({ devServerUrl: undefined })).toBe(buildCsp())
    expect(buildCsp({ devServerUrl: '' })).toBe(buildCsp())
    expect(directive(buildCsp({ devServerUrl: '' }), 'script-src')).not.toContain('unsafe-inline')
    expect(directive(buildCsp({ devServerUrl: '' }), 'style-src')).not.toContain('unsafe-inline')
  })
})
