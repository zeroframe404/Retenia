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

export function createTesseractOcrProvider(): OcrProvider {
  return {
    id: 'tesseract',
    recognize: async (input: Uint8Array, options?: OcrOptions): Promise<OcrResult> => {
      const lang = options?.language
        ? (BCP_47_TO_TESSERACT_LANG[options.language] ?? DEFAULT_LANG)
        : DEFAULT_LANG
      const worker = await createWorker(lang)
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
