/**
 * How the chunker measures a span (`docs/spec/04-path-generation.md` §3 stage 2: "chunk =
 * section; if > ~1,200 tokens, split by paragraphs; if < ~150, merge").
 *
 * Two implementations ship, and which one ran is part of `chunking_version` — a chunk
 * measured with a different tokenizer was cut at different boundaries, so changing this is a
 * reindex (`needsRechunk`), not a silent upgrade.
 *
 * The default is the **heuristic**: `ceil(chars / 4)`, the number every "how many tokens is
 * this?" estimate in the specs already uses. It is wrong by 10–20 % on Spanish prose and
 * more on code, which does not matter for a *boundary* decision — a 1,200-token ceiling that
 * lands at 1,050 or 1,400 real tokens still produces a chunk a model can read — and it costs
 * nothing to run over a 300-page book.
 *
 * `createCl100kTokenCounter()` is the accurate one, for when the count feeds a *cost*
 * estimate rather than a boundary (the contextualization job's "≈ USD 0.15 for this book").
 * It loads `js-tiktoken`'s rank table lazily — ~1.7 MB of data no ingestion run should pay
 * for unless it asked.
 */

/** Counts the tokens in a span of text. Pure and synchronous: the chunker calls it once per
 *  block and again per candidate split, and an async counter would make the whole chunker
 *  async for no gain. */
export type TokenCounter = (text: string) => number

/** Identifies the tokenizer inside `chunking_version`. */
export type TokenizerId = 'chars4' | 'cl100k'

/** Average characters per token, across the Spanish and English prose these sources are. */
const CHARS_PER_TOKEN = 4

/** `ceil(chars / 4)`. The default — see the note above on why an approximation is the right
 *  default for a boundary decision. */
export const countTokensByChars: TokenCounter = (text) => Math.ceil(text.length / CHARS_PER_TOKEN)

/**
 * The exact cl100k_base count, for cost estimates. Async because the rank table is loaded on
 * first use; the returned counter is synchronous like any other.
 */
export async function createCl100kTokenCounter(): Promise<TokenCounter> {
  const { getEncoding } = await import('js-tiktoken')
  const encoding = getEncoding('cl100k_base')
  return (text) => encoding.encode(text).length
}

/** The counters this package can build by id, so a settings row can name one. */
export async function createTokenCounter(id: TokenizerId): Promise<TokenCounter> {
  return id === 'cl100k' ? createCl100kTokenCounter() : countTokensByChars
}
