import { render } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

beforeEach(() => {
  navigate.mockClear()
})

function stubApi() {
  let deepLinkListener: ((payload: unknown) => void) | undefined
  const api = {
    events: {
      on: vi.fn((name: string, listener: (payload: unknown) => void) => {
        if (name === 'app.deepLink') deepLinkListener = listener
        return vi.fn()
      }),
    },
  }
  vi.stubGlobal('api', api)
  window.api = api as unknown as typeof window.api

  return {
    fireDeepLink: (payload: unknown) => {
      if (deepLinkListener === undefined) throw new Error('no app.deepLink listener registered')
      act(() => deepLinkListener?.(payload))
    },
  }
}

const { SourceDeepLinkListener } = await import('./source-deep-link-listener')

describe('SourceDeepLinkListener', () => {
  it('navigates to the library with the source id and page', () => {
    const { fireDeepLink } = stubApi()
    render(<SourceDeepLinkListener />)

    fireDeepLink({ kind: 'source', id: '019213cd-0000-7000-8000-000000000001', page: 12 })

    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      to: '/library',
      search: { sourceId: '019213cd-0000-7000-8000-000000000001', page: 12 },
    })
  })

  it('navigates with a cfi instead of a page for an EPUB source', () => {
    const { fireDeepLink } = stubApi()
    render(<SourceDeepLinkListener />)

    fireDeepLink({
      kind: 'source',
      id: '019213cd-0000-7000-8000-000000000002',
      cfi: 'epubcfi(/6/4!/4/2/2)',
    })

    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      to: '/library',
      search: {
        sourceId: '019213cd-0000-7000-8000-000000000002',
        cfi: 'epubcfi(/6/4!/4/2/2)',
      },
    })
  })

  it('navigates with neither when the link carries no locator', () => {
    const { fireDeepLink } = stubApi()
    render(<SourceDeepLinkListener />)

    fireDeepLink({ kind: 'source', id: '019213cd-0000-7000-8000-000000000003' })

    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      to: '/library',
      search: { sourceId: '019213cd-0000-7000-8000-000000000003' },
    })
  })

  it('ignores a non-source deep link', () => {
    const { fireDeepLink } = stubApi()
    render(<SourceDeepLinkListener />)

    fireDeepLink({ kind: 'review' })

    expect(navigate).not.toHaveBeenCalled()
  })
})
