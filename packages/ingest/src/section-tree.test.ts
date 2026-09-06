import { describe, expect, it } from 'vitest'
import { createSectionTree } from './section-tree'

describe('createSectionTree', () => {
  it('nests headings by level and pops back out for a shallower one', () => {
    const tree = createSectionTree(() => 'preamble', 'Untitled')
    tree.pushHeading('h1', 'Chapter 1', 1)
    tree.attach('b1')
    tree.pushHeading('h1.1', '1.1', 2)
    tree.attach('b2')
    tree.pushHeading('h1.1.1', '1.1.1', 3)
    tree.attach('b3')
    // Back to level 2: pops the level-3 section, stays nested under Chapter 1.
    tree.pushHeading('h1.2', '1.2', 2)
    tree.attach('b4')
    // Back to level 1: pops everything, becomes a sibling of Chapter 1.
    tree.pushHeading('h2', 'Chapter 2', 1)
    tree.attach('b5')

    expect(tree.roots.map((s) => s.title)).toEqual(['Chapter 1', 'Chapter 2'])
    const chapter1 = tree.roots[0]
    expect(chapter1?.blocks).toEqual(['b1'])
    expect(chapter1?.children.map((s) => s.title)).toEqual(['1.1', '1.2'])
    expect(chapter1?.children[0]?.blocks).toEqual(['b2'])
    expect(chapter1?.children[0]?.children.map((s) => s.title)).toEqual(['1.1.1'])
    expect(chapter1?.children[0]?.children[0]?.blocks).toEqual(['b3'])
    expect(chapter1?.children[1]?.blocks).toEqual(['b4'])
    expect(tree.roots[1]?.blocks).toEqual(['b5'])
  })

  it('collects pre-heading content into a synthetic preamble, first among the roots', () => {
    const tree = createSectionTree(() => 'preamble-id', 'My Document')
    tree.attach('intro-1')
    tree.attach('intro-2')
    tree.pushHeading('h1', 'Chapter 1', 1)
    tree.attach('b1')

    expect(tree.roots.map((s) => s.title)).toEqual(['My Document', 'Chapter 1'])
    expect(tree.roots[0]?.id).toBe('preamble-id')
    expect(tree.roots[0]?.blocks).toEqual(['intro-1', 'intro-2'])
  })

  it('creates no preamble section when every block has an enclosing heading', () => {
    const tree = createSectionTree(() => 'preamble-id', 'My Document')
    tree.pushHeading('h1', 'Chapter 1', 1)
    tree.attach('b1')

    expect(tree.roots).toHaveLength(1)
    expect(tree.roots[0]?.title).toBe('Chapter 1')
  })
})
