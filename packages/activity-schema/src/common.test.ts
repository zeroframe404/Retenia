import { describe, expect, it } from 'vitest'
import {
  activityIdSchema,
  LABEL_MAX,
  langSchema,
  MEDIA_TOKEN_PATTERN,
  mediaRefSchema,
  PLAIN_TEXT_MAX,
  RICH_TEXT_MAX,
  richTextSchema,
  shortIdSchema,
  sourceRefSchema,
} from './common'

describe('richTextSchema', () => {
  it('rejects the empty string', () => {
    expect(richTextSchema.safeParse('').success).toBe(false)
    expect(richTextSchema.safeParse('**bold** $x^2$ [[media:m1]]').success).toBe(true)
  })

  it('caps one block at RICH_TEXT_MAX so a poisoned field cannot stall the KaTeX pass', () => {
    expect(richTextSchema.safeParse('a'.repeat(RICH_TEXT_MAX)).success).toBe(true)
    expect(richTextSchema.safeParse('a'.repeat(RICH_TEXT_MAX + 1)).success).toBe(false)
    expect(richTextSchema.safeParse('$x$'.repeat(RICH_TEXT_MAX)).success).toBe(false)
  })
})

describe('shortIdSchema', () => {
  it('accepts letters, digits, _ and - up to 64 characters', () => {
    expect(shortIdSchema.safeParse('opt-1_a').success).toBe(true)
    expect(shortIdSchema.safeParse('a'.repeat(64)).success).toBe(true)
    expect(shortIdSchema.safeParse('a'.repeat(65)).success).toBe(false)
    expect(shortIdSchema.safeParse('').success).toBe(false)
    expect(shortIdSchema.safeParse('with space').success).toBe(false)
    expect(shortIdSchema.safeParse('ñ').success).toBe(false)
  })
})

describe('langSchema', () => {
  it('accepts BCP-47 tags with a lower-case primary subtag', () => {
    for (const tag of ['es-AR', 'en', 'pt-BR', 'zh-Hant-TW', 'ast']) {
      expect(langSchema.safeParse(tag).success).toBe(true)
    }
    for (const tag of ['ES', 'e', 'es_AR', 'es-', 'english']) {
      expect(langSchema.safeParse(tag).success).toBe(false)
    }
  })
})

describe('activityIdSchema', () => {
  it('accepts only lower-case UUIDv7', () => {
    expect(activityIdSchema.safeParse('0192f000-0000-7000-8000-000000000001').success).toBe(true)
    expect(activityIdSchema.safeParse('0192F000-0000-7000-8000-000000000001').success).toBe(false)
    expect(activityIdSchema.safeParse('0192f000-0000-4000-8000-000000000001').success).toBe(false)
    expect(activityIdSchema.safeParse('01ARZ3NDEKTSV4RRFFQ69G5FAV').success).toBe(false)
  })
})

describe('mediaRefSchema', () => {
  const src = (value: string) => mediaRefSchema.safeParse({ id: 'm1', kind: 'image', src: value })

  it('accepts a resolved or a to-be-generated reference', () => {
    expect(mediaRefSchema.safeParse({ id: 'm1', kind: 'image', src: 'sha256:abc' }).success).toBe(
      true,
    )
    expect(
      mediaRefSchema.safeParse({ id: 'm2', kind: 'audio', generate: { by: 'tts', prompt: 'Hola' } })
        .success,
    ).toBe(true)
    expect(mediaRefSchema.safeParse({ id: 'm3', kind: 'gif' }).success).toBe(false)
    expect(
      mediaRefSchema.safeParse({ id: 'm4', kind: 'audio', generate: { by: 'whisper' } }).success,
    ).toBe(false)
  })

  it('accepts only a blob reference or the app’s own media:// protocol as `src`', () => {
    const hash = '0'.repeat(64)
    for (const value of [
      'sha256:abc',
      `sha256:${hash}`,
      `SHA256:${hash.toUpperCase()}`,
      `media://blob/${hash}`,
      `media://blob/${hash}.ogg`,
    ]) {
      expect(src(value).success, value).toBe(true)
    }
  })

  it('rejects every other scheme, a bare path and an over-long `src`', () => {
    for (const value of [
      'javascript:alert(1)',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'https://evil.test/tracker.png',
      'http://evil.test/tracker.png',
      'file:///etc/passwd',
      'C:\\Users\\me\\photo.png',
      '../../etc/passwd',
      'sha256:',
      'sha256:not-hex',
      'media://',
      ' sha256:abc',
      `media://blob/${'a'.repeat(LABEL_MAX)}`,
    ]) {
      expect(src(value).success, value).toBe(false)
    }
  })

  it('bounds the alt text and the generation prompt', () => {
    expect(
      mediaRefSchema.safeParse({ id: 'm1', kind: 'image', alt: 'x'.repeat(LABEL_MAX) }).success,
    ).toBe(true)
    expect(
      mediaRefSchema.safeParse({ id: 'm1', kind: 'image', alt: 'x'.repeat(LABEL_MAX + 1) }).success,
    ).toBe(false)
    expect(
      mediaRefSchema.safeParse({
        id: 'm1',
        kind: 'audio',
        generate: { by: 'tts', prompt: 'x'.repeat(PLAIN_TEXT_MAX + 1) },
      }).success,
    ).toBe(false)
  })
})

describe('sourceRefSchema', () => {
  it('accepts an offset span or a label', () => {
    expect(sourceRefSchema.safeParse({ docId: 'd1', span: { start: 0, end: 10 } }).success).toBe(
      true,
    )
    expect(sourceRefSchema.safeParse({ docId: 'd1', span: 'p. 112', quote: '…' }).success).toBe(
      true,
    )
    expect(sourceRefSchema.safeParse({ docId: '' }).success).toBe(false)
    expect(sourceRefSchema.safeParse({ docId: 'd1', span: { start: -1, end: 2 } }).success).toBe(
      false,
    )
  })

  it('bounds the locator and the quoted passage', () => {
    expect(sourceRefSchema.safeParse({ docId: 'd'.repeat(LABEL_MAX + 1) }).success).toBe(false)
    expect(
      sourceRefSchema.safeParse({ docId: 'd1', span: 'p'.repeat(LABEL_MAX + 1) }).success,
    ).toBe(false)
    expect(
      sourceRefSchema.safeParse({ docId: 'd1', quote: 'q'.repeat(PLAIN_TEXT_MAX + 1) }).success,
    ).toBe(false)
  })
})

describe('MEDIA_TOKEN_PATTERN', () => {
  it('finds every [[media:ID]] token', () => {
    const ids = [
      ...'see [[media:m1]] and [[media:m-2]] not [[media:]]'.matchAll(MEDIA_TOKEN_PATTERN),
    ]
    expect(ids.map((m) => m[1])).toEqual(['m1', 'm-2'])
  })
})
