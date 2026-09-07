import { describe, expect, it, vi } from 'vitest'
import type { TranscriptResponse } from 'youtube-transcript'
import { fetchYouTubePlaylist, fetchYouTubeVideo } from './youtube-fetch'

const VIDEO_ID = 'dQw4w9WgXcQ'

function fakeOembedFetch(body: Record<string, unknown> | null, ok = true) {
  return vi.fn(
    async () => new Response(body ? JSON.stringify(body) : null, { status: ok ? 200 : 404 }),
  )
}

describe('fetchYouTubeVideo', () => {
  it('combines oEmbed metadata with a transcript in the preferred language', async () => {
    const fetchImpl = fakeOembedFetch({
      title: 'How spaced repetition works',
      author_name: 'Study Better',
      thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    })
    const cues: TranscriptResponse[] = [
      { text: 'Hola.', offset: 0, duration: 1.2, lang: 'es' },
      { text: 'Repetición espaciada.', offset: 1.2, duration: 2, lang: 'es' },
    ]
    const fetchTranscript = vi.fn(async (_id: string, config?: { lang?: string }) => {
      if (config?.lang === 'es') return cues
      throw new Error('language not available')
    })

    const envelope = await fetchYouTubeVideo(VIDEO_ID, { fetchImpl, fetchTranscript })

    expect(envelope.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(envelope.title).toBe('How spaced repetition works')
    expect(envelope.author).toBe('Study Better')
    expect(envelope.thumbnailUrl).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    expect(envelope.transcriptLanguage).toBe('es')
    expect(envelope.transcript).toEqual([
      { startSec: 0, endSec: 1.2, text: 'Hola.' },
      { startSec: 1.2, endSec: 3.2, text: 'Repetición espaciada.' },
    ])
    expect(envelope.transcriptUnavailableReason).toBeNull()
    // Only the preferred language was tried once "es" succeeded.
    expect(fetchTranscript).toHaveBeenCalledOnce()
  })

  it('falls back from es to en when Spanish captions do not exist', async () => {
    const fetchImpl = fakeOembedFetch({ title: 'A video' })
    const fetchTranscript = vi.fn(async (_id: string, config?: { lang?: string }) => {
      if (config?.lang === 'en') {
        return [
          { text: 'Hello.', offset: 0, duration: 1, lang: 'en' },
        ] satisfies TranscriptResponse[]
      }
      throw new Error('language not available')
    })

    const envelope = await fetchYouTubeVideo(VIDEO_ID, { fetchImpl, fetchTranscript })

    expect(envelope.transcriptLanguage).toBe('en')
    expect(fetchTranscript).toHaveBeenCalledTimes(2)
  })

  it('falls back to any available track when neither es nor en exist', async () => {
    const fetchImpl = fakeOembedFetch({ title: 'A video' })
    const fetchTranscript = vi.fn(async (_id: string, config?: { lang?: string }) => {
      if (config?.lang !== undefined) throw new Error('language not available')
      return [
        { text: 'Bonjour.', offset: 0, duration: 1, lang: 'fr' },
      ] satisfies TranscriptResponse[]
    })

    const envelope = await fetchYouTubeVideo(VIDEO_ID, { fetchImpl, fetchTranscript })

    expect(envelope.transcriptLanguage).toBe('fr')
    expect(fetchTranscript).toHaveBeenCalledTimes(3)
  })

  it('records why the transcript is unavailable rather than failing the whole import', async () => {
    const fetchImpl = fakeOembedFetch({ title: 'A video' })
    const fetchTranscript = vi.fn(async () => {
      throw new Error('Transcript is disabled on this video')
    })

    const envelope = await fetchYouTubeVideo(VIDEO_ID, { fetchImpl, fetchTranscript })

    expect(envelope.transcript).toBeNull()
    expect(envelope.transcriptLanguage).toBeNull()
    expect(envelope.transcriptUnavailableReason).toBe('Transcript is disabled on this video')
    // The video's own metadata still came through.
    expect(envelope.title).toBe('A video')
  })

  it('is not derailed by an oEmbed response larger than the size cap', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(97)
    const fetchImpl = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (let i = 0; i < 6; i += 1) controller.enqueue(chunk)
          controller.close()
        },
      })
      return new Response(stream, { status: 200 })
    })
    const fetchTranscript = vi.fn(
      async () =>
        [{ text: 'Hi.', offset: 0, duration: 1, lang: 'en' }] satisfies TranscriptResponse[],
    )

    const envelope = await fetchYouTubeVideo(VIDEO_ID, { fetchImpl, fetchTranscript })

    expect(envelope.title).toBeNull()
    expect(envelope.transcript).not.toBeNull()
  })

  it('is not derailed by a failed oEmbed request', async () => {
    const fetchImpl = fakeOembedFetch(null, false)
    const fetchTranscript = vi.fn(
      async () =>
        [{ text: 'Hi.', offset: 0, duration: 1, lang: 'en' }] satisfies TranscriptResponse[],
    )

    const envelope = await fetchYouTubeVideo(VIDEO_ID, { fetchImpl, fetchTranscript })

    expect(envelope.title).toBeNull()
    expect(envelope.author).toBeNull()
    expect(envelope.thumbnailUrl).toBeNull()
    expect(envelope.transcript).not.toBeNull()
  })
})

describe('fetchYouTubePlaylist', () => {
  it('parses video ids and titles out of the public playlist Atom feed', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>abc12345678</yt:videoId>
    <title>Lesson 1: Intro</title>
  </entry>
  <entry>
    <yt:videoId>def98765432</yt:videoId>
    <title>Lesson 2: Practice &amp; Review</title>
  </entry>
</feed>`
    const fetchImpl = vi.fn(async () => new Response(xml, { status: 200 }))

    const videos = await fetchYouTubePlaylist('PLabc123', { fetchImpl })

    expect(videos).toEqual([
      { videoId: 'abc12345678', title: 'Lesson 1: Intro' },
      { videoId: 'def98765432', title: 'Lesson 2: Practice & Review' },
    ])
  })

  it('returns an empty list for a playlist with no entries', async () => {
    const xml = '<feed xmlns="http://www.w3.org/2005/Atom"></feed>'
    const fetchImpl = vi.fn(async () => new Response(xml, { status: 200 }))

    expect(await fetchYouTubePlaylist('PLempty', { fetchImpl })).toEqual([])
  })

  it('throws for a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }))
    await expect(fetchYouTubePlaylist('PLmissing', { fetchImpl })).rejects.toThrow(/404/)
  })

  it('rejects a feed response larger than the size cap without buffering it all', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(97)
    const fetchImpl = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (let i = 0; i < 6; i += 1) controller.enqueue(chunk)
          controller.close()
        },
      })
      return new Response(stream, { status: 200 })
    })

    await expect(fetchYouTubePlaylist('PLhuge', { fetchImpl })).rejects.toThrow(/larger than/)
  })
})
