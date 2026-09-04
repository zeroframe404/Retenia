import { describe, expect, it } from 'vitest'
import {
  activityIdSchema,
  langSchema,
  MEDIA_TOKEN_PATTERN,
  mediaRefSchema,
  richTextSchema,
  shortIdSchema,
  sourceRefSchema,
} from './common'

describe('richTextSchema', () => {
  it('rejects the empty string', () => {
    expect(richTextSchema.safeParse('').success).toBe(false)
    expect(richTextSchema.safeParse('**bold** $x^2$ [[media:m1]]').success).toBe(true)
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
})

describe('MEDIA_TOKEN_PATTERN', () => {
  it('finds every [[media:ID]] token', () => {
    const ids = [
      ...'see [[media:m1]] and [[media:m-2]] not [[media:]]'.matchAll(MEDIA_TOKEN_PATTERN),
    ]
    expect(ids.map((m) => m[1])).toEqual(['m1', 'm-2'])
  })
})
