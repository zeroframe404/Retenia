import { crc32, deflateSync } from 'node:zlib'

/**
 * A minimal PNG encoder for raw BGRA pixel buffers — exactly what `@hyzyla/pdfium`'s
 * `page.render()` hands back (its own README points users at `sharp` for this, but that is
 * a native image library pulled in for one channel-swap-and-deflate; `node:zlib`'s built-in
 * `deflateSync`/`crc32` are all a spec-minimal PNG actually needs).
 *
 * Truecolor + alpha, 8-bit, no interlacing, one IDAT chunk. Good enough for a rendered PDF
 * page or a thumbnail; not a general-purpose PNG writer.
 */

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const out = new Uint8Array(4 + 4 + data.length + 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(typeBytes, 4)
  out.set(data, 8)

  const crcInput = new Uint8Array(4 + data.length)
  crcInput.set(typeBytes, 0)
  crcInput.set(data, 4)
  view.setUint32(8 + data.length, crc32(crcInput) >>> 0)
  return out
}

function ihdr(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13)
  const view = new DataView(data.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  data[8] = 8 // bit depth
  data[9] = 6 // color type: truecolor + alpha
  // compression (0), filter (0) and interlace (0) method are already zero-initialized.
  return data
}

/** BGRA → the per-scanline, filter-byte-prefixed RGBA layout PNG's IDAT stream holds. */
function toFilteredRgbaRows(bgra: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4
  const raw = new Uint8Array(height * (1 + stride))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + stride)
    raw[rowStart] = 0 // filter type: None
    for (let x = 0; x < width; x++) {
      const src = y * stride + x * 4
      const dest = rowStart + 1 + x * 4
      raw[dest] = bgra[src + 2] as number // R <- B
      raw[dest + 1] = bgra[src + 1] as number // G
      raw[dest + 2] = bgra[src] as number // B <- R
      raw[dest + 3] = bgra[src + 3] as number // A
    }
  }
  return raw
}

export function encodeBgraAsPng(bgra: Uint8Array, width: number, height: number): Uint8Array {
  const idat = deflateSync(toFilteredRgbaRows(bgra, width, height))
  const parts = [
    SIGNATURE,
    chunk('IHDR', ihdr(width, height)),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
