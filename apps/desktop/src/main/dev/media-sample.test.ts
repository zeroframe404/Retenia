import { beforeEach, describe, expect, it, vi } from 'vitest'

const readFileSync = vi.fn()
vi.mock('node:fs', () => ({ readFileSync }))

const { ensureDevMediaSample } = await import('./media-sample')

const content = Buffer.from('fake ogg bytes')
const sourceFile = '/resources/dev/sample.ogg'
const put = vi.fn()
const blobStore = { put, has: vi.fn(), path: vi.fn(), get: vi.fn(), delete: vi.fn() }

beforeEach(() => {
  readFileSync.mockReset().mockReturnValue(content)
  put.mockReset()
})

describe('ensureDevMediaSample', () => {
  it('puts the file into the blob store and returns its media:// url', async () => {
    put.mockResolvedValue({
      sha256: 'abc123',
      bytes: content.byteLength,
      mime: 'audio/ogg',
      ext: 'ogg',
    })

    const url = await ensureDevMediaSample(sourceFile, blobStore)

    expect(readFileSync).toHaveBeenCalledWith(sourceFile)
    expect(put).toHaveBeenCalledWith(content, 'audio/ogg')
    expect(url).toBe('media://blob/abc123.ogg')
  })

  it('respects a custom mime type', async () => {
    put.mockResolvedValue({
      sha256: 'def456',
      bytes: content.byteLength,
      mime: 'audio/mpeg',
      ext: 'mp3',
    })

    const url = await ensureDevMediaSample(sourceFile, blobStore, 'audio/mpeg')

    expect(put).toHaveBeenCalledWith(content, 'audio/mpeg')
    expect(url).toBe('media://blob/def456.mp3')
  })

  it('omits the extension when the mime maps to none', async () => {
    put.mockResolvedValue({
      sha256: 'ghi789',
      bytes: content.byteLength,
      mime: 'x/unknown',
      ext: null,
    })

    const url = await ensureDevMediaSample(sourceFile, blobStore, 'x/unknown')

    expect(url).toBe('media://blob/ghi789')
  })

  it('is idempotent by construction: `put` itself dedupes identical bytes', async () => {
    put.mockResolvedValue({
      sha256: 'abc123',
      bytes: content.byteLength,
      mime: 'audio/ogg',
      ext: 'ogg',
    })

    await ensureDevMediaSample(sourceFile, blobStore)
    await ensureDevMediaSample(sourceFile, blobStore)

    expect(put).toHaveBeenCalledTimes(2)
  })
})
