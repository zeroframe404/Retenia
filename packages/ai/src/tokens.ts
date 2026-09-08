/**
 * How this layer guesses at a token count before a provider has counted for it.
 *
 * Two callers need a number the provider has not given yet: the cache pre-check, which has to
 * decide whether a prefix clears Anthropic's 1,024-token minimum *before* paying to find out,
 * and the batch estimator, which has to quote a price before anything is submitted.
 *
 * `ceil(chars / 4)` is the same heuristic `@retenia/ingest`'s chunker uses and the one every
 * "how many tokens is this?" figure in the specs is built on. It is redeclared here rather
 * than imported because the dependency edge runs ingest -> ai and never back
 * (`tooling/scripts/check-deps.mjs`), and duplicating four characters of arithmetic is a far
 * smaller cost than inverting that edge.
 *
 * Its error is ±10–20 % on Spanish prose — which is why `estimateBatch` reports a band rather
 * than a point, and why the cache pre-check applies a safety margin instead of trusting the
 * count at face value. A caller that needs the exact number passes `@retenia/ingest`'s
 * `createCl100kTokenCounter()` in; the seam exists on every function that counts.
 */

/** Counts the tokens in a span of text. Pure and synchronous, like the chunker's. */
export type TokenCounter = (text: string) => number

/** Average characters per token across the Spanish and English prose these prompts are. */
const CHARS_PER_TOKEN = 4

/**
 * The relative error the heuristic is assumed to have, in both directions.
 *
 * Used by the estimator to publish a band and by the cache pre-check to require a prefix
 * comfortably over the minimum rather than one that merely appears to clear it.
 */
export const TOKEN_ESTIMATE_TOLERANCE = 0.1

export const approximateTokens: TokenCounter = (text) => Math.ceil(text.length / CHARS_PER_TOKEN)
