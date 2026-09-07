import { describe, expect, it, vi } from 'vitest'
import { createFakeParseContext } from '../../test/fake-parse-context'
import { defaultFetchThumbnail, isAllowedThumbnailUrl, parseYouTubePage } from './parse-youtube'
import type { YouTubeEnvelope } from './types'

const BASE_ENVELOPE: YouTubeEnvelope = {
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  videoId: 'dQw4w9WgXcQ',
  fetchedAt: '2026-09-06T12:00:00.000Z',
  title: 'How spaced repetition works',
  author: 'Study Better',
  thumbnailUrl: null,
  transcript: [
    { startSec: 0, endSec: 2.5, text: 'Spaced repetition beats cramming.' },
    { startSec: 2.5, endSec: 5.8, text: 'Here is why it works.' },
  ],
  transcriptLanguage: 'en',
  transcriptUnavailableReason: null,
}

function envelopeInput(envelope: YouTubeEnvelope, fallbackTitle = 'https://youtu.be/dQw4w9WgXcQ') {
  return {
    bytes: new TextEncoder().encode(JSON.stringify(envelope)),
    fallbackTitle,
  }
}

describe('parseYouTubePage', () => {
  it('turns a transcript into timed blocks a citation can seek to', async () => {
    const ctx = createFakeParseContext()
    const doc = await parseYouTubePage(envelopeInput(BASE_ENVELOPE), ctx)

    expect(doc.kind).toBe('youtube')
    expect(doc.title).toBe('How spaced repetition works')
    expect(doc.language).toBe('en')
    expect(doc.meta.warnings).toEqual([])
    expect(doc.meta.origin).toEqual({
      url: BASE_ENVELOPE.url,
      fetchedAt: BASE_ENVELOPE.fetchedAt,
      author: 'Study Better',
      videoId: 'dQw4w9WgXcQ',
    })

    expect(doc.blocks).toHaveLength(2)
    expect(doc.blocks[0]).toMatchObject({
      type: 'paragraph',
      text: 'Spaced repetition beats cramming.',
      locator: { timeSec: 0 },
    })
    expect(doc.blocks[1]).toMatchObject({
      type: 'paragraph',
      text: 'Here is why it works.',
      locator: { timeSec: 2.5 },
    })

    expect(doc.sections).toHaveLength(1)
    expect(doc.sections[0]?.blocks).toEqual(doc.blocks.map((block) => block.id))
  })

  it('carries playlist provenance through to meta.origin when the envelope has it', async () => {
    const ctx = createFakeParseContext()
    const envelope: YouTubeEnvelope = {
      ...BASE_ENVELOPE,
      playlistId: 'PLabc123',
      playlistIndex: 2,
    }
    const doc = await parseYouTubePage(envelopeInput(envelope), ctx)

    expect(doc.meta.origin).toMatchObject({ playlistId: 'PLabc123', playlistIndex: 2 })
  })

  it('produces a warning and no blocks when no transcript is available', async () => {
    const ctx = createFakeParseContext()
    const envelope: YouTubeEnvelope = {
      ...BASE_ENVELOPE,
      transcript: null,
      transcriptLanguage: null,
      transcriptUnavailableReason: 'Captions are disabled for this video',
    }
    const doc = await parseYouTubePage(envelopeInput(envelope), ctx)

    expect(doc.blocks).toEqual([])
    expect(doc.meta.warnings).toEqual(['Captions are disabled for this video'])
  })

  it('falls back to a bilingual notice when no reason was given for the missing transcript', async () => {
    const ctx = createFakeParseContext()
    const envelope: YouTubeEnvelope = {
      ...BASE_ENVELOPE,
      transcript: [],
      transcriptLanguage: null,
      transcriptUnavailableReason: null,
    }
    const doc = await parseYouTubePage(envelopeInput(envelope), ctx)

    expect(doc.meta.warnings).toEqual([
      'sin transcripción disponible: subí el audio (no transcript is available; upload the audio)',
    ])
  })

  it('downloads the oEmbed thumbnail as a thumbnail asset', async () => {
    const ctx = createFakeParseContext()
    const envelope: YouTubeEnvelope = {
      ...BASE_ENVELOPE,
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    }
    const doc = await parseYouTubePage(envelopeInput(envelope), ctx, {
      fetchThumbnail: async (url) =>
        url === envelope.thumbnailUrl
          ? { bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' }
          : null,
    })

    expect(doc.assets).toHaveLength(1)
    expect(doc.assets[0]?.kind).toBe('thumbnail')
    expect(ctx.assets.has(doc.assets[0]?.blobSha256 ?? '')).toBe(true)
  })

  it('is not derailed by a failed thumbnail fetch', async () => {
    const ctx = createFakeParseContext()
    const envelope: YouTubeEnvelope = {
      ...BASE_ENVELOPE,
      thumbnailUrl: 'https://i.ytimg.com/broken.jpg',
    }
    const doc = await parseYouTubePage(envelopeInput(envelope), ctx, {
      fetchThumbnail: async () => null,
    })

    expect(doc.assets).toEqual([])
    expect(doc.blocks.length).toBeGreaterThan(0)
  })

  it('falls back to the video URL when oEmbed reported no title', async () => {
    const ctx = createFakeParseContext()
    const envelope: YouTubeEnvelope = { ...BASE_ENVELOPE, title: null }
    const fallbackTitle = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    const doc = await parseYouTubePage(envelopeInput(envelope, fallbackTitle), ctx)

    expect(doc.title).toBe(fallbackTitle)
  })

  it('detects the language from the transcript text when oEmbed gave none', async () => {
    const ctx = createFakeParseContext()
    const envelope: YouTubeEnvelope = {
      ...BASE_ENVELOPE,
      transcriptLanguage: null,
      transcript: [
        {
          startSec: 0,
          endSec: 4,
          text: 'La repetición espaciada es mejor que estudiar todo de una vez antes del examen.',
        },
      ],
    }
    const doc = await parseYouTubePage(envelopeInput(envelope), ctx)
    expect(doc.language).toBe('es')
  })
})

describe('isAllowedThumbnailUrl', () => {
  it.each([
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    'https://yt3.googleusercontent.com/abc',
    'https://www.youtube.com/img/thumb.jpg',
  ])('accepts a real YouTube thumbnail host (%s)', (url) => {
    expect(isAllowedThumbnailUrl(url)).toBe(true)
  })

  it.each([
    'http://i.ytimg.com/vi/x/hqdefault.jpg', // not https
    'https://evil.com/i.ytimg.com/vi/x.jpg', // path, not host
    'https://i.ytimg.com.evil.com/x.jpg', // suffix spoof
    'https://ytimg.com.evil.com/x.jpg',
    'not a url',
  ])('rejects anything else (%s)', (url) => {
    expect(isAllowedThumbnailUrl(url)).toBe(false)
  })
})

describe('defaultFetchThumbnail', () => {
  it('refuses a URL on a host oEmbed would never actually return', async () => {
    const fetchImpl = vi.fn()
    const result = await defaultFetchThumbnail('https://attacker.example/steal.jpg', fetchImpl)
    expect(result).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('streams the body and aborts once it exceeds the size cap, without buffering it all', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(1)
    const fetchImpl = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (let i = 0; i < 6; i += 1) controller.enqueue(chunk)
          controller.close()
        },
      })
      return new Response(stream, { status: 200 })
    })

    const result = await defaultFetchThumbnail(
      'https://i.ytimg.com/vi/x/hqdefault.jpg',
      fetchImpl as unknown as typeof fetch,
    )
    expect(result).toBeNull()
  })

  it('downloads a thumbnail under the cap from an allowed host', async () => {
    const fetchImpl = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
          controller.close()
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      })
    })

    const result = await defaultFetchThumbnail(
      'https://i.ytimg.com/vi/x/hqdefault.jpg',
      fetchImpl as unknown as typeof fetch,
    )
    expect(result?.mime).toBe('image/jpeg')
    expect(result?.bytes).toEqual(new Uint8Array([1, 2, 3]))
  })
})
