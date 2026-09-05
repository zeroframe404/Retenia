import { franc } from 'franc-min'

/**
 * Language detection for `SourceDoc.language`, via trigram frequency profiles
 * (`docs/spec/05-ingestion-rag.md` intro: "language (detected with a small n-gram
 * detector)"). `franc-min` is exactly that — Cavnar & Trenkle trigram distance against a
 * per-language profile — trimmed to the languages this app actually needs.
 */

/** ISO 639-3 (what `franc` returns) → BCP-47, for the six pronunciation languages
 *  (`docs/spec/01-decisions.md` §5) plus a few other common ones. Unmapped codes fall back
 *  to the 639-3 code itself, which is a reasonable extended language subtag even if not a
 *  proper primary one. */
const ISO_639_3_TO_BCP_47: Readonly<Record<string, string>> = {
  eng: 'en',
  spa: 'es',
  por: 'pt',
  fra: 'fr',
  deu: 'de',
  ita: 'it',
  nld: 'nl',
  rus: 'ru',
  jpn: 'ja',
  cmn: 'zh',
  arb: 'ar',
  kor: 'ko',
}

/** Below this many characters `franc` itself refuses to guess (returns `'und'`); kept as a
 *  named constant so callers can skip the call entirely for a title-sized string. */
export const MIN_DETECTABLE_LENGTH = 10

/** `null` when the text is too short or too ambiguous for `franc` to commit to a guess. */
export function detectLanguage(text: string): string | null {
  const code = franc(text, { minLength: MIN_DETECTABLE_LENGTH })
  if (code === 'und') return null
  return ISO_639_3_TO_BCP_47[code] ?? code
}
