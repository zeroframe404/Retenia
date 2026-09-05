/**
 * Text recognition for a scanned page or an image source
 * (`docs/spec/05-ingestion-rag.md` §1, §2). A port because who runs it varies: local
 * Tesseract.js is the default everywhere (`packages/ingest`'s `createTesseractOcrProvider`),
 * cloud engines (Gemini Flash-Lite, Mistral OCR) land behind the same shape in `packages/ai`
 * once sub-phase 7.x wires providers, roles and per-call cost.
 */
export interface OcrResult {
  text: string
  /** 0–100. What a page/image scored is how `needsOcr` escalation is decided downstream. */
  confidence: number
}

export interface OcrOptions {
  /** BCP-47 or the engine's own language tag, when the caller already knows it. */
  language?: string
}

export interface OcrProvider {
  /** For the cost log and for "which engine produced this text". */
  readonly id: string
  recognize(input: Uint8Array, options?: OcrOptions): Promise<OcrResult>
}
