/**
 * How two spellings of one concept are told to be the same: case, accents, punctuation and
 * a leading article are noise; the words are the signal. `Memoria de trabajo`, `memoria de
 * trabajo` and `la memoria de trabajo.` all normalise to `memoria de trabajo`; `MT` does not,
 * which is what the alias list and the embedding pass are for.
 */

const ARTICLES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'the', 'a', 'an'])

/** Keys shorter than this never match anything: `ai`, `ph` and `x` are not identities. */
export const MIN_KEY_CHARS = 3

/** Tokens at least this long are what the embedding pass blocks candidate pairs on. */
export const MIN_TOKEN_CHARS = 4

export function normalizeTerm(term: string): string {
  const folded = term
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  const tokens = folded
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .trim()
    .split(/\s+/)
    // A hyphen only joins letters: `working-memory` stays, `---` and `-wm-` do not.
    .map((token) => token.replace(/^-+|-+$/g, ''))
    .filter((token) => token !== '')
  while (tokens.length > 1 && ARTICLES.has(tokens[0] as string)) tokens.shift()
  return tokens.join(' ')
}

/** A normalised form usable as a matching key, or `null` when it is too short to mean much. */
export function matchKey(term: string): string | null {
  const normalized = normalizeTerm(term)
  return normalized.length >= MIN_KEY_CHARS ? normalized : null
}

/** The tokens of a normalised form that are long enough to block on. */
export function blockingTokens(normalized: string): string[] {
  return normalized.split(' ').filter((token) => token.length >= MIN_TOKEN_CHARS)
}
