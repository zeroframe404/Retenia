import { toast } from '@retenia/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import '../i18n'

/** Mirrors `features/library/library-page.test.tsx`'s pattern: `window.api` replaced with
 *  `vi.fn`s returning the envelope shape `invokeIpc` expects, `events.on` capturing the
 *  listener so a test can fire a deep link manually instead of going through main. */
function ok<T>(data: T) {
  return { ok: true as const, data }
}

function stubApi() {
  let deepLinkListener: ((payload: unknown) => void) | undefined
  const addSourceFromUrl = vi.fn(async () => ok({ sources: [] }))

  const api = {
    library: { addSourceFromUrl },
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
    addSourceFromUrl,
    fireDeepLink: (payload: unknown) => {
      if (deepLinkListener === undefined) throw new Error('no app.deepLink listener registered')
      act(() => deepLinkListener?.(payload))
    },
  }
}

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const { DeepLinkBanner } = await import('./deep-link-banner')

describe('DeepLinkBanner', () => {
  it('renders nothing until a deep link arrives', () => {
    stubApi()
    render(<DeepLinkBanner />, { wrapper })
    expect(screen.queryByTestId('deep-link')).not.toBeInTheDocument()
  })

  it('asks for confirmation before importing, without calling addSourceFromUrl yet', async () => {
    const { addSourceFromUrl, fireDeepLink } = stubApi()
    render(<DeepLinkBanner />, { wrapper })

    fireDeepLink({ kind: 'import', src: 'https://example.com/article' })

    expect(await screen.findByTestId('deep-link-import-confirm')).toBeInTheDocument()
    expect(screen.getByTestId('deep-link-import-url')).toHaveTextContent(
      'https://example.com/article',
    )
    expect(addSourceFromUrl).not.toHaveBeenCalled()
  })

  it('ignores a second import link that arrives while the first is still pending confirmation', async () => {
    const { addSourceFromUrl, fireDeepLink } = stubApi()
    render(<DeepLinkBanner />, { wrapper })

    fireDeepLink({ kind: 'import', src: 'https://example.com/benign-article' })
    expect(await screen.findByTestId('deep-link-import-url')).toHaveTextContent(
      'https://example.com/benign-article',
    )

    // A hostile page firing a second link while the user is still looking at the first must not
    // change what clicking "Import" actually approves.
    fireDeepLink({ kind: 'import', src: 'http://192.168.1.1/internal' })
    expect(screen.getByTestId('deep-link-import-url')).toHaveTextContent(
      'https://example.com/benign-article',
    )

    fireEvent.click(screen.getByTestId('deep-link-import-accept'))
    await waitFor(() =>
      expect(addSourceFromUrl).toHaveBeenCalledExactlyOnceWith({
        url: 'https://example.com/benign-article',
      }),
    )
  })

  it('starts the import only after the user clicks Import', async () => {
    const { addSourceFromUrl, fireDeepLink } = stubApi()
    render(<DeepLinkBanner />, { wrapper })

    fireDeepLink({ kind: 'import', src: 'https://example.com/article' })
    fireEvent.click(await screen.findByTestId('deep-link-import-accept'))

    await waitFor(() =>
      expect(addSourceFromUrl).toHaveBeenCalledExactlyOnceWith({
        url: 'https://example.com/article',
      }),
    )
    expect(screen.getByTestId('deep-link')).toHaveAttribute('data-deep-link-kind', 'import')
  })

  it('shows an error toast when the confirmed import fails, instead of failing silently', async () => {
    const { addSourceFromUrl, fireDeepLink } = stubApi()
    addSourceFromUrl.mockRejectedValueOnce(
      new Error('Refusing to fetch "http://192.168.1.1/": private address'),
    )
    const toastError = vi.spyOn(toast, 'error').mockImplementation(() => '')
    render(<DeepLinkBanner />, { wrapper })

    fireDeepLink({ kind: 'import', src: 'http://192.168.1.1/' })
    fireEvent.click(await screen.findByTestId('deep-link-import-accept'))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Refusing to fetch "http://192.168.1.1/": private address',
      ),
    )
    toastError.mockRestore()
  })

  it('discards the import when the user clicks Discard, without ever calling addSourceFromUrl', async () => {
    const { addSourceFromUrl, fireDeepLink } = stubApi()
    render(<DeepLinkBanner />, { wrapper })

    fireDeepLink({ kind: 'import', src: 'https://example.com/article' })
    fireEvent.click(await screen.findByTestId('deep-link-import-discard'))

    expect(screen.queryByTestId('deep-link-import-confirm')).not.toBeInTheDocument()
    expect(addSourceFromUrl).not.toHaveBeenCalled()
  })

  it('does not start an import for a non-import deep link', async () => {
    const { addSourceFromUrl, fireDeepLink } = stubApi()
    render(<DeepLinkBanner />, { wrapper })

    fireDeepLink({ kind: 'review' })

    expect(await screen.findByTestId('deep-link')).toHaveAttribute('data-deep-link-kind', 'review')
    expect(addSourceFromUrl).not.toHaveBeenCalled()
  })
})
