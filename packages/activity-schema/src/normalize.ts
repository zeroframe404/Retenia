/**
 * The one text normalization every fuzzy comparison in the activity engine starts from
 * (`docs/spec/03-activities.md` §2, FUZ: "Unicode normalization"; §10: `normalize → exact → …`).
 *
 * It lives in the schema package rather than the graders because the validation rules need it
 * too — "the answer cannot appear in the stem" (§11) is a normalized substring test — and the
 * two must agree on what "the same text" means.
 *
 * Idempotent by construction (`normalizeText(normalizeText(s)) === normalizeText(s)`), which the
 * graders' property tests check: lower-casing happens *before* diacritics are stripped, because
 * some upper-case letters lower-case into a base letter plus a combining mark (`İ` → `i̇`) and
 * a second pass would otherwise strip what the first one produced.
 */

export interface NormalizeOptions {
  /** Keep case. Default `false`: comparisons are case-insensitive. */
  caseSensitive?: boolean
  /** Strip combining marks (`café` → `cafe`). Default `true`. */
  ignoreDiacritics?: boolean
  /** Trim and collapse runs of whitespace to one space. Default `true`. */
  collapseWhitespace?: boolean
  /** Apply Unicode NFKC first (`ﬁ` → `fi`, full-width → ASCII). Default `true`. */
  nfkc?: boolean
}

/** Typographic characters an answer is never wrong for typing the plain way. */
const FOLDS: readonly (readonly [RegExp, string])[] = [
  [/[‘’‚‛′]/gu, "'"],
  [/[“”„‟″]/gu, '"'],
  [/[‐-―−]/gu, '-'],
  [/…/gu, '...'],
]

export function normalizeText(input: string, options: NormalizeOptions = {}): string {
  const {
    caseSensitive = false,
    ignoreDiacritics = true,
    collapseWhitespace = true,
    nfkc = true,
  } = options

  let text = nfkc ? input.normalize('NFKC') : input.normalize('NFC')
  if (!caseSensitive) text = text.toLowerCase()
  if (ignoreDiacritics)
    text = text
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .normalize('NFC')
  for (const [pattern, replacement] of FOLDS) text = text.replace(pattern, replacement)
  if (collapseWhitespace) text = text.replace(/\s+/gu, ' ').trim()
  return text
}
