import { mkdir } from 'node:fs/promises'
import type { OcrOptions, OcrProvider, OcrResult } from '@retenia/core'
import { createWorker } from 'tesseract.js'

/**
 * The default `OcrProvider`: local, offline, printed-text recognition
 * (`docs/spec/05-ingestion-rag.md` §1: "Images with text → Tesseract.js"). Cloud engines
 * (Gemini Flash-Lite, Mistral OCR) are a later, opt-in `OcrProvider` implementation in
 * `packages/ai` (sub-phase 7.x) — this one never leaves the machine.
 *
 * A worker is spun up and torn down per call rather than kept warm: this provider is only
 * ever used from inside a job that processes one image (or one flagged PDF page) at a time,
 * so there is no steady stream of calls to amortize a long-lived worker's memory over.
 *
 * `cacheDir`, when given, becomes tesseract.js's `cachePath` — the directory it writes a
 * downloaded `<lang>.traineddata` into (and reads it back from, on every call after the
 * first). Left unset, tesseract.js caches at `./<lang>.traineddata`, relative to whatever
 * `process.cwd()` happens to be for the job worker — not a directory this app owns, backs
 * up, or can rely on being writable. Callers pass a subdirectory of the model store
 * (`<userData>/models/tesseract`) instead, so the download survives restarts in the one
 * place the app already treats as its model cache. The first recognition in a language
 * still reaches the network — `langPath` is left unset, so a cache miss falls back to
 * tesseract.js's own CDN, per its own resolution order — only the cache location changes.
 */

/** BCP-47 → the traineddata code Tesseract ships under, for the app's supported languages
 *  (`docs/spec/01-decisions.md` §5). Anything else falls back to English. */
const BCP_47_TO_TESSERACT_LANG: Readonly<Record<string, string>> = {
  en: 'eng',
  es: 'spa',
  pt: 'por',
  fr: 'fra',
  de: 'deu',
  it: 'ita',
}

const DEFAULT_LANG = 'eng'

export interface TesseractOcrProviderOptions {
  /** Directory tesseract.js caches `<lang>.traineddata` in. Created if it does not exist.
   *  Omit only in a context with no stable directory to offer (a unit test) — production
   *  callers pass `<userData>/models/tesseract`. */
  cacheDir?: string
}

export function createTesseractOcrProvider(options: TesseractOcrProviderOptions = {}): OcrProvider {
  const { cacheDir } = options
  return {
    id: 'tesseract',
    recognize: async (input: Uint8Array, ocrOptions?: OcrOptions): Promise<OcrResult> => {
      const lang = ocrOptions?.language
        ? (BCP_47_TO_TESSERACT_LANG[ocrOptions.language] ?? DEFAULT_LANG)
        : DEFAULT_LANG
      if (cacheDir !== undefined) await mkdir(cacheDir, { recursive: true })
      const worker = await createWorker(
        lang,
        undefined,
        cacheDir === undefined ? undefined : { cachePath: cacheDir },
      )
      try {
        const {
          data: { text, confidence },
        } = await worker.recognize(Buffer.from(input))
        return { text: text.trim(), confidence }
      } finally {
        await worker.terminate()
      }
    },
  }
}
