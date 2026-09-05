import { sampleChoice } from '@retenia/activity-schema/testing/samples'
import { describe, expect, it } from 'vitest'
import {
  defaultResolveMedia,
  ExplainAnswerUnavailableError,
  noopSpeak,
  staticExplainAnswer,
} from './ports'

describe('defaultResolveMedia', () => {
  it('turns a content-addressed reference into a media:// blob URL', () => {
    expect(defaultResolveMedia({ id: 'm1', kind: 'image', src: 'sha256:0f3a' })).toBe(
      'media://blob/0f3a',
    )
  })

  it('is case-insensitive about the prefix and keeps the hash as authored', () => {
    expect(defaultResolveMedia({ id: 'm1', kind: 'image', src: 'SHA256:AB12' })).toBe(
      'media://blob/AB12',
    )
  })

  it('passes an already-resolved app URL through untouched', () => {
    for (const src of ['media://blob/0f3a.ogg', 'blob:app://retenia/6a1f-4d2e']) {
      expect(defaultResolveMedia({ id: 'm1', kind: 'image', src })).toBe(src)
    }
  })

  it('returns null for a ref that has no source yet (pending_media)', () => {
    expect(
      defaultResolveMedia({ id: 'm1', kind: 'image', generate: { by: 'image', prompt: 'x' } }),
    ).toBeNull()
  })

  // `src` is model-written or comes from an imported deck, and whatever comes back here is put
  // straight on an `<img>`/`<video>`/`Audio`. Anything outside the allow-list has to resolve to
  // `null` — the `pending_media` placeholder — rather than become a request.
  it.each([
    ['a remote beacon', 'https://attacker.example/px.gif?d=lesson-opened'],
    ['a plain http URL', 'http://attacker.example/x.png'],
    ['a protocol-relative URL', '//attacker.example/x.png'],
    [
      'an uppercase scheme, since scheme matching is case-insensitive',
      'HTTPS://attacker.example/x',
    ],
    ['a local file', 'file:///etc/passwd'],
    ['a javascript: URL', 'javascript:alert(1)'],
    [
      'an inline SVG, which img-src data: would otherwise render',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    ],
    ['a data: image of any type', 'data:image/png;base64,AA'],
    ['the renderer’s own bundle origin', 'app://assets/x.png'],
    ['a bare filesystem path', 'C:\\Users\\me\\evil.png'],
    ['a scheme smuggled behind leading whitespace', ' media://blob/0f3a'],
    ['a hash that is not hex', 'sha256:zzzz'],
  ])('refuses %s', (_label, src) => {
    expect(defaultResolveMedia({ id: 'm1', kind: 'image', src })).toBeNull()
  })
})

describe('staticExplainAnswer', () => {
  const base = { response: null, result: null, lang: 'es-AR' }

  it('returns the activity’s authored explanation', async () => {
    const activity = { ...sampleChoice(), explanation: 'Porque sí.' }
    await expect(staticExplainAnswer({ activity, ...base })).resolves.toBe('Porque sí.')
  })

  it('rejects when there is nothing authored and no tutor is wired', async () => {
    await expect(staticExplainAnswer({ activity: sampleChoice(), ...base })).rejects.toBeInstanceOf(
      ExplainAnswerUnavailableError,
    )
  })
})

describe('noopSpeak', () => {
  it('resolves without doing anything, so an AudioButton is inert rather than broken', async () => {
    await expect(noopSpeak({ text: 'hola', lang: 'es-AR' })).resolves.toBeUndefined()
  })
})
