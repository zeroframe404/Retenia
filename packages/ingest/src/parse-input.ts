/** What every parser in `src/parsers/` takes, besides the bytes' `ParseContext`. */
export interface ParseInput {
  bytes: Uint8Array
  /** Used when the format itself carries no better title (frontmatter, a document
   *  property…) — typically the imported file's name. */
  fallbackTitle: string
}
