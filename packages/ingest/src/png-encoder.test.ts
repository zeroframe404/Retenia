import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { encodeBgraAsPng } from './png-encoder'

/** Decodes just enough of a PNG (assuming the one-IDAT-chunk shape `encodeBgraAsPng`
 *  produces) to get back the same filtered-scanline layout it started from — enough to
 *  verify the encoder round-trips without pulling in an image-decoding dependency. */
function decode(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let offset = 8
  let width = 0
  let height = 0
  let idat: Uint8Array | undefined

  while (offset < png.length) {
    const length = view.getUint32(offset)
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8))
    const data = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0)
      height = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4)
    }
    if (type === 'IDAT') idat = data
    offset += 12 + length
  }
  if (idat === undefined) throw new Error('no IDAT chunk')

  const raw = inflateSync(idat)
  const stride = width * 4
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + stride)
    rgba.set(raw.subarray(rowStart + 1, rowStart + 1 + stride), y * stride)
  }
  return { width, height, rgba }
}

describe('encodeBgraAsPng', () => {
  it('round-trips BGRA pixels as RGBA, swapping only the R/B channels', () => {
    const width = 2
    const height = 2
    // biome-ignore format: one row per pixel reads clearer than one long line
    const bgra = new Uint8Array([
      /* B    G    R    A   */
         10,  20, 200, 255, // pixel (0,0)
         30,  40, 210, 255, // pixel (1,0)
         50,  60, 220, 128, // pixel (0,1)
         70,  80, 230,   0, // pixel (1,1)
    ])

    const png = encodeBgraAsPng(bgra, width, height)
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])

    const decoded = decode(png)
    expect(decoded.width).toBe(width)
    expect(decoded.height).toBe(height)
    expect(Array.from(decoded.rgba)).toEqual([
      200, 20, 10, 255, 210, 40, 30, 255, 220, 60, 50, 128, 230, 80, 70, 0,
    ])
  })
})
