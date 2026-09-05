import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MermaidView } from './mermaid-view'

const THEME_STYLE = '<style>.node rect{fill:#ff0000}</style>'

/** Written into the layout container, never into the returned string. A test that looks for it
 *  anywhere in `document` is looking at what mermaid actually built here, not at what it gave
 *  back — the two are different guarantees and only one of them is "never in this document". */
const LAYOUT_MARKER = 'mermaid-layout-node'

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, chart: string, container?: HTMLElement) => {
      if (chart.includes('invalid')) throw new Error('Parse error')
      // Mermaid measures real text, so it needs a live container and really does build the
      // diagram inside it. The marker stands in for that work, so the tests below can assert
      // what is left in the page once the effect has settled.
      if (container) container.innerHTML = `<svg data-testid="${LAYOUT_MARKER}"></svg>`
      return { svg: `<svg data-testid="mermaid-svg">${THEME_STYLE}<text>${chart}</text></svg>` }
    }),
  },
}))

async function renderedDiagram(chart: string): Promise<HTMLImageElement> {
  render(<MermaidView chart={chart} />)
  await waitFor(() => {
    expect(screen.getByRole('img')).toBeInTheDocument()
  })
  return screen.getByRole('img') as HTMLImageElement
}

const decodeSrc = (image: HTMLImageElement) =>
  decodeURIComponent(image.src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))

describe('MermaidView', () => {
  it('renders the diagram as a data: URL image, never as markup in this document', async () => {
    const image = await renderedDiagram('graph TD; A-->B;')

    // The invariant: the finished SVG reaches the screen through an image resource. An `<img>`
    // of a `data:` SVG is in the browser's secure static mode — no scripts, no external fetches,
    // no navigation — so the serialized diagram is never parsed into this origin's DOM.
    expect(image.tagName).toBe('IMG')
    expect(image.src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    expect(decodeSrc(image)).toContain('A-->B')
    expect(document.querySelector('[data-testid="mermaid-svg"]')).toBeNull()
  })

  it('leaves nothing of the layout pass behind in the document', async () => {
    // The narrower, honest half of the invariant: mermaid *does* build the diagram in a live
    // node here, so what has to hold is that the node is gone once the effect has settled. The
    // marker is written into the container mermaid was handed, so this assertion observes the
    // real layout work rather than the string that was returned.
    const mermaid = (await import('mermaid')).default
    await renderedDiagram('graph TD; A-->B;')
    const container = vi.mocked(mermaid.render).mock.calls.at(-1)?.[2] as HTMLElement

    // The marker really was built inside the container mermaid was handed — so the assertion
    // below has something it could find — and it is nowhere in the page afterwards.
    expect(container.querySelector(`[data-testid="${LAYOUT_MARKER}"]`)).not.toBeNull()
    expect(document.querySelector(`[data-testid="${LAYOUT_MARKER}"]`)).toBeNull()
  })

  it("keeps the diagram's own theme, which the renderer's style-src would drop anywhere else", async () => {
    // Mermaid puts a diagram's whole theme in an inline <style> inside the SVG. Inside an
    // `about:srcdoc` iframe — the previous presentation — that element is governed by the
    // embedder's `style-src 'self'` and is dropped; inside an image it is not subject to the
    // page's CSP at all. Losing it renders every diagram unstyled.
    expect(decodeSrc(await renderedDiagram('graph TD; A-->B;'))).toContain(THEME_STYLE)
  })

  it('gives mermaid an off-screen container of its own to lay out in', async () => {
    const mermaid = (await import('mermaid')).default
    await renderedDiagram('graph TD; A-->B;')

    const container = vi.mocked(mermaid.render).mock.calls.at(-1)?.[2] as HTMLElement | undefined
    expect(container).toBeInstanceOf(HTMLElement)
    // Passing a container is what keeps mermaid from building in `document.body`; off-screen and
    // aria-hidden is what keeps that work invisible to the eye and to a screen reader.
    expect(container?.getAttribute('aria-hidden')).toBe('true')
    expect(container?.style.position).toBe('absolute')
    expect(container?.style.left).toBe('-10000px')
  })

  it('removes the layout container once the diagram is drawn', async () => {
    const mermaid = (await import('mermaid')).default
    await renderedDiagram('graph TD; A-->B;')

    const container = vi.mocked(mermaid.render).mock.calls.at(-1)?.[2] as HTMLElement | undefined
    await waitFor(() => {
      expect(container?.isConnected).toBe(false)
    })
  })

  it('removes the layout container even when the diagram fails', async () => {
    const mermaid = (await import('mermaid')).default
    render(<MermaidView chart="invalid diagram" errorLabel="Could not render this diagram." />)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not render this diagram.')
    })

    const container = vi.mocked(mermaid.render).mock.calls.at(-1)?.[2] as HTMLElement | undefined
    expect(container?.isConnected).toBe(false)
  })

  it('names the diagram, and takes a caller-supplied name', async () => {
    expect(await renderedDiagram('graph TD; A-->B;')).toHaveAttribute('alt', 'Diagram')

    render(<MermaidView chart="graph TD; C-->D;" label="Ciclo del agua" />)
    await waitFor(() => {
      expect(screen.getByAltText('Ciclo del agua')).toBeInTheDocument()
    })
  })

  it('shows an error state when the diagram fails to render', async () => {
    render(<MermaidView chart="invalid diagram" errorLabel="Could not render this diagram." />)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not render this diagram.')
    })
  })

  it('configures mermaid once for the whole app, not once per mounted diagram', async () => {
    // `mermaid.initialize` writes a module-global config: called per mount, the last
    // diagram to mount would decide the security level for every diagram already on screen.
    vi.resetModules()
    vi.clearAllMocks()
    const mermaid = (await import('mermaid')).default
    const { MermaidView: FreshMermaidView } = await import('./mermaid-view')

    render(
      <>
        <FreshMermaidView chart="graph TD; A-->B;" />
        <FreshMermaidView chart="graph TD; C-->D;" />
        <FreshMermaidView chart="graph TD; E-->F;" />
      </>,
    )

    await waitFor(() => {
      expect(mermaid.render).toHaveBeenCalledTimes(3)
    })
    expect(mermaid.initialize).toHaveBeenCalledTimes(1)
    // Not 'sandbox': mermaid's sandbox path reads `contentDocument` of a `sandbox=""` iframe,
    // which is null under a real browser's opaque origin (see the note on `loadMermaid`).
    //
    // `htmlLabels: false` is asserted alongside it because `securityLevel` does not imply it:
    // mermaid defaults HTML labels on at every security level, and with them on each label is
    // written into the layout document with d3's `.html()` — an `innerHTML` sink fed by the
    // diagram source, filtered only by a DOMPurify pass that keeps `<img src>`.
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', htmlLabels: false }),
    )
  })

  describe('when mermaid itself fails to load', () => {
    afterEach(() => {
      vi.doUnmock('mermaid')
      vi.resetModules()
    })

    it('shows the error state instead of an unhandled rejection, and retries next time', async () => {
      // The module-level memo caches the *promise*, rejection included, so a failure that is not
      // cleared decides for the whole session: every later diagram awaits the same settled
      // rejection and sits on its loading skeleton forever.
      vi.resetModules()
      let attempts = 0
      vi.doMock('mermaid', () => {
        attempts += 1
        if (attempts === 1) throw new Error('chunk load failed')
        return {
          default: {
            initialize: vi.fn(),
            render: vi.fn(async () => ({ svg: '<svg><text>ok</text></svg>' })),
          },
        }
      })
      const { MermaidView: FreshMermaidView } = await import('./mermaid-view')

      render(<FreshMermaidView chart="graph TD; A-->B;" errorLabel="Could not render this." />)
      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Could not render this.')
      })

      render(<FreshMermaidView chart="graph TD; C-->D;" />)
      await waitFor(() => {
        expect(screen.getByRole('img')).toBeInTheDocument()
      })
      expect(attempts).toBe(2)
    })
  })
})
