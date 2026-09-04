/**
 * The four v1 flashcard templates' field shapes (`docs/spec/04-path-generation.md`'s
 * `Flashcard.v1`, `docs/spec/03-activities.md`'s `flashcard_basic`/`flashcard_reverse`/
 * `cloze_typed`). Neither `packages/core` nor `packages/db` types `KnowledgeItem.fields`
 * beyond `JsonObject` yet, so this reads it defensively rather than trusting a shape the
 * server never validated — an AI-generated or imported item that is missing a field
 * degrades to an empty string instead of throwing.
 */

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export interface BasicFields {
  front: string
  back: string
}

/** `basic`/`type_in` read front→back; `reverse` swaps them at read time (`toBasicFields`'s
 *  `reverse` flag) rather than needing its own field names. */
export function toBasicFields(fields: unknown, reverse: boolean): BasicFields {
  const record =
    fields !== null && typeof fields === 'object' ? (fields as Record<string, unknown>) : {}
  const front = asString(record.front)
  const back = asString(record.back)
  return reverse ? { front: back, back: front } : { front, back }
}

export type ClozeSegment =
  | { kind: 'text'; text: string; start: number }
  | {
      kind: 'cloze'
      number: number
      answer: string
      hint: string | null
      active: boolean
      /** The match's offset in the source text — a stable, content-derived React key so
       *  the renderer never has to key off array position. */
      start: number
    }

const CLOZE_PATTERN = /\{\{c(\d+)::([^:}]*)(?:::([^}]*))?\}\}/g

/** `card.template` for a cloze card is `cloze:c<N>` — which of the text's `{{cN::…}}`
 *  blanks this particular sibling card tests. Defaults to 1 for a bare `cloze` template. */
export function activeClozeNumber(template: string): number {
  const match = /^cloze:c(\d+)$/.exec(template)
  return match ? Number(match[1]) : 1
}

/** Every distinct cloze number in the text, ascending — what the generator would turn into
 *  sibling cards (`docs/spec/02-memory-system.md`: "multiple clozes → sibling cards"). */
export function clozeNumbers(text: string): number[] {
  const numbers = new Set<number>()
  for (const match of text.matchAll(CLOZE_PATTERN)) numbers.add(Number(match[1]))
  return [...numbers].sort((a, b) => a - b)
}

/** Splits `cloze_text` into text/cloze segments. Only `activeNumber`'s blank is masked;
 *  every other cloze number's answer renders plainly, like Anki's own cloze siblings. */
export function parseClozeText(text: string, activeNumber: number): ClozeSegment[] {
  const segments: ClozeSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(CLOZE_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, index), start: cursor })
    }
    const number = Number(match[1])
    segments.push({
      kind: 'cloze',
      number,
      answer: match[2] ?? '',
      hint: match[3] && match[3].length > 0 ? match[3] : null,
      active: number === activeNumber,
      start: index,
    })
    cursor = index + match[0].length
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor), start: cursor })
  return segments
}

export function toClozeText(fields: unknown): string {
  const record =
    fields !== null && typeof fields === 'object' ? (fields as Record<string, unknown>) : {}
  return asString(record.cloze_text)
}

/** Exact-match fuzzy-grader stand-in (§4.4's "fuzzy grader from 5.1 when available; until
 *  then exact match"): case/whitespace-insensitive equality. */
export function matchesTypedAnswer(typed: string, expected: string): boolean {
  return typed.trim().toLowerCase() === expected.trim().toLowerCase()
}
