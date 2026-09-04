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

  it('passes an already-resolvable URL through untouched', () => {
    for (const src of ['media://blob/0f3a.ogg', 'app://assets/x.png', 'data:image/png;base64,AA']) {
      expect(defaultResolveMedia({ id: 'm1', kind: 'image', src })).toBe(src)
    }
  })

  it('returns null for a ref that has no source yet (pending_media)', () => {
    expect(
      defaultResolveMedia({ id: 'm1', kind: 'image', generate: { by: 'image', prompt: 'x' } }),
    ).toBeNull()
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
