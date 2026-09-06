import { describe, expect, it } from 'vitest'
import { parseSnippet } from './snippet'

/**
 * FTS5's `snippet()` output is **source text** — the content of a file the user imported —
 * with two markers of ours inside it. Parsing it into runs, rather than handing it to
 * `innerHTML`, is the whole reason this module exists.
 */

describe('parseSnippet', () => {
  it('splits a passage into matched and unmatched runs', () => {
    expect(parseSnippet('El <b>corazón</b> bombea sangre.')).toEqual([
      { text: 'El ', match: false },
      { text: 'corazón', match: true },
      { text: ' bombea sangre.', match: false },
    ])
  })

  it('handles a passage with no markers at all — a purely semantic hit', () => {
    expect(parseSnippet('Las mitocondrias.')).toEqual([{ text: 'Las mitocondrias.', match: false }])
  })

  it('leaves any other markup as literal text', () => {
    // A chunk from a book about HTML really does contain `<script>`, and it must read as
    // `<script>` rather than becoming one.
    expect(parseSnippet('use <script>alert(1)</script> here')).toEqual([
      { text: 'use <script>alert(1)</script> here', match: false },
    ])
    expect(parseSnippet('<img src=x onerror=alert(1)>')).toEqual([
      { text: '<img src=x onerror=alert(1)>', match: false },
    ])
  })

  it('merges adjacent runs of the same kind, so a word is not split across spans', () => {
    expect(parseSnippet('<b>mito</b><b>condrias</b>')).toEqual([
      { text: 'mitocondrias', match: true },
    ])
  })

  it('drops empty runs rather than emitting them', () => {
    expect(parseSnippet('<b></b>hola')).toEqual([{ text: 'hola', match: false }])
    expect(parseSnippet('')).toEqual([])
  })

  it('survives unbalanced markers without styling the rest of the passage as a match', () => {
    // The depth can never go negative, so a stray `</b>` cannot flip the remainder.
    expect(parseSnippet('</b>todo el resto')).toEqual([{ text: 'todo el resto', match: false }])
    expect(parseSnippet('<b>abierto para siempre')).toEqual([
      { text: 'abierto para siempre', match: true },
    ])
  })

  it('keeps the ellipsis FTS5 puts at the edges of a snippet', () => {
    expect(
      parseSnippet('…el <b>corazón</b> bombea…')
        .map((run) => run.text)
        .join(''),
    ).toBe('…el corazón bombea…')
  })
})
