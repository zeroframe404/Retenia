/**
 * The two ways a string is flattened before it goes into a prompt.
 *
 * Inside a `<user_content>` block nothing needs escaping — the envelope is what makes the
 * text data — so `oneLine` only collapses whitespace and caps the length. A string that sits
 * *outside* the envelope, in the header of a task, additionally has the envelope's tag name
 * made inert the way `wrapUserContent` does it, so that a title cannot open or close a block
 * from the header.
 */

const USER_CONTENT_TAG = /user_content/gi
/** The word joiner `wrapUserContent` uses: invisible, and no longer the tag name. */
const WORD_JOINER = '⁠'

export function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}

export function headerLine(text: string, max: number): string {
  return oneLine(text.replace(USER_CONTENT_TAG, `user${WORD_JOINER}_content`), max)
}
