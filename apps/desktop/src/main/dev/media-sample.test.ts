import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const existsSync = vi.fn()
const mkdirSync = vi.fn()
const copyFileSync = vi.fn()
const readFileSync = vi.fn()

vi.mock('node:fs', () => ({ existsSync, mkdirSync, copyFileSync, readFileSync }))

const { ensureDevMediaSample } = await import('./media-sample')

const content = Buffer.from('fake ogg bytes')
const hash = createHash('sha256').update(content).digest('hex')
const blobsRoot = '/blobs'
const sourceFile = '/resources/dev/sample.ogg'

beforeEach(() => {
  existsSync.mockReset()
  mkdirSync.mockReset()
  copyFileSync.mockReset()
  readFileSync.mockReset().mockReturnValue(content)
})

describe('ensureDevMediaSample', () => {
  it('returns the media:// url keyed by the content hash', () => {
    existsSync.mockReturnValue(false)
    expect(ensureDevMediaSample(sourceFile, blobsRoot)).toBe(`media://blob/${hash}.ogg`)
  })

  it('copies the file into <blobsRoot>/<aa>/<hash>.ogg when the blob is missing', () => {
    existsSync.mockReturnValue(false)
    ensureDevMediaSample(sourceFile, blobsRoot)

    const dir = join(blobsRoot, hash.slice(0, 2))
    expect(mkdirSync).toHaveBeenCalledWith(dir, { recursive: true })
    expect(copyFileSync).toHaveBeenCalledWith(sourceFile, join(dir, `${hash}.ogg`))
  })

  it('is idempotent: does not copy again once the blob already exists', () => {
    existsSync.mockReturnValue(true)
    ensureDevMediaSample(sourceFile, blobsRoot)

    expect(copyFileSync).not.toHaveBeenCalled()
    expect(mkdirSync).not.toHaveBeenCalled()
  })

  it('respects a custom extension', () => {
    existsSync.mockReturnValue(false)
    expect(ensureDevMediaSample(sourceFile, blobsRoot, 'mp3')).toBe(`media://blob/${hash}.mp3`)
  })
})
