import { describe, expect, it } from 'vitest'
import { clearHighlightMarks, markRange } from './epub-highlight-dom'

function withParagraph(html: string): HTMLParagraphElement {
  const p = document.createElement('p')
  p.innerHTML = html
  document.body.appendChild(p)
  return p
}

describe('markRange', () => {
  it('wraps a plain-text selection in one <mark>', () => {
    const p = withParagraph('La consolidación de la memoria ocurre durante el sueño.')
    const textNode = p.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 3) // "consolidación"
    range.setEnd(textNode, 16)

    markRange(range, 'h1', 'yellow')

    const marks = p.querySelectorAll('mark.retenia-highlight')
    expect(marks).toHaveLength(1)
    expect(marks[0]?.textContent).toBe('consolidación')
    expect((marks[0] as HTMLElement).dataset.highlightId).toBe('h1')
    expect(p.textContent).toBe('La consolidación de la memoria ocurre durante el sueño.')
  })

  it('wraps a selection that crosses inline markup in more than one <mark>', () => {
    const p = withParagraph('el efecto de <em>espaciamiento</em> distribuye los repasos')
    const range = document.createRange()
    const textStart = p.firstChild as Text // "el efecto de "
    const em = p.querySelector('em') as HTMLElement
    const afterEm = em.nextSibling as Text // " distribuye los repasos"

    range.setStart(textStart, 3) // "efecto de "
    range.setEnd(afterEm, 12) // " distribuye "

    markRange(range, 'h2', 'green')

    const marks = p.querySelectorAll('mark.retenia-highlight')
    expect(marks.length).toBeGreaterThanOrEqual(2)
    expect(marks[0]?.getAttribute('data-highlight-id')).toBe('h2')
    // The full text is unchanged — only wrapped, not rewritten.
    expect(p.textContent).toBe('el efecto de espaciamiento distribuye los repasos')
  })

  it('applies the requested color as the mark’s background', () => {
    const p = withParagraph('texto de prueba')
    const textNode = p.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 5)

    markRange(range, 'h3', 'rgb(255, 0, 0)')

    const mark = p.querySelector('mark') as HTMLElement
    expect(mark.style.backgroundColor).toBe('rgb(255, 0, 0)')
  })
})

describe('clearHighlightMarks', () => {
  it('removes one highlight’s marks and leaves the text intact', () => {
    const p = withParagraph('texto de prueba con dos resaltados distintos aquí')
    const textNode = p.firstChild as Text
    const first = document.createRange()
    first.setStart(textNode, 0)
    first.setEnd(textNode, 5)
    markRange(first, 'h1', 'yellow')

    // `markRange` splits the original text node into `["", <mark>, " de prueba…"]` — the
    // leading empty text node is an artifact of `Range.surroundContents`, not something this
    // module controls, so the test finds the *last* text node rather than assuming a position.
    const secondTarget = Array.from(p.childNodes).findLast(
      (node): node is Text => node.nodeType === Node.TEXT_NODE,
    )
    if (secondTarget === undefined) throw new Error('expected a remaining text node')
    const second = document.createRange()
    second.setStart(secondTarget, 0)
    second.setEnd(secondTarget, 3)
    markRange(second, 'h2', 'green')

    expect(p.querySelectorAll('mark')).toHaveLength(2)

    clearHighlightMarks(p, 'h1')

    const remaining = p.querySelectorAll('mark')
    expect(remaining).toHaveLength(1)
    expect((remaining[0] as HTMLElement).dataset.highlightId).toBe('h2')
    expect(p.textContent).toBe('texto de prueba con dos resaltados distintos aquí')
  })

  it('removes every highlight when no id is given', () => {
    const p = withParagraph('uno dos tres')
    const textNode = p.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 3)
    markRange(range, 'h1', 'yellow')

    clearHighlightMarks(p)
    expect(p.querySelectorAll('mark')).toHaveLength(0)
    expect(p.textContent).toBe('uno dos tres')
  })
})
