import { describe, expect, it } from 'vitest'
import { canonicalWatchUrl, parseYouTubeUrl } from './youtube-url'

describe('parseYouTubeUrl', () => {
  it('parses a standard watch URL', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      kind: 'video',
      videoId: 'dQw4w9WgXcQ',
    })
  })

  it('parses a youtu.be short link', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toEqual({
      kind: 'video',
      videoId: 'dQw4w9WgXcQ',
    })
  })

  it('parses a youtu.be link with a trailing query string', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=42')).toEqual({
      kind: 'video',
      videoId: 'dQw4w9WgXcQ',
    })
  })

  it('parses a Shorts URL', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toEqual({
      kind: 'video',
      videoId: 'dQw4w9WgXcQ',
    })
  })

  it('parses an embed URL', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toEqual({
      kind: 'video',
      videoId: 'dQw4w9WgXcQ',
    })
  })

  it('parses a mobile (m.) host the same as the desktop one', () => {
    expect(parseYouTubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      kind: 'video',
      videoId: 'dQw4w9WgXcQ',
    })
  })

  it('treats a watch URL with both v= and list= as the video, not the playlist', () => {
    expect(
      parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123&index=3'),
    ).toEqual({ kind: 'video', videoId: 'dQw4w9WgXcQ' })
  })

  it('parses a bare playlist URL', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/playlist?list=PLabc123')).toEqual({
      kind: 'playlist',
      playlistId: 'PLabc123',
    })
  })

  it('parses a watch URL with list= but no v= as the playlist', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?list=PLabc123')).toEqual({
      kind: 'playlist',
      playlistId: 'PLabc123',
    })
  })

  it('rejects a non-YouTube URL', () => {
    expect(parseYouTubeUrl('https://vimeo.com/12345')).toBeNull()
  })

  it('rejects a YouTube URL with no recognizable video or playlist', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/')).toBeNull()
    expect(parseYouTubeUrl('https://www.youtube.com/results?search_query=fsrs')).toBeNull()
  })

  it('rejects a malformed URL rather than throwing', () => {
    expect(parseYouTubeUrl('not a url')).toBeNull()
  })

  it('rejects a non-http(s) scheme', () => {
    expect(parseYouTubeUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('canonicalWatchUrl', () => {
  it('builds the canonical watch URL for a video id', () => {
    expect(canonicalWatchUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })
})
