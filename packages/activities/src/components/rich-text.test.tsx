import type { MediaRef } from '@retenia/activity-schema'
import { sampleChoice } from '@retenia/activity-schema/testing/samples'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ActivityHost } from '../host/activity-host'
import type { ResolveMediaPort } from '../host/ports'
import { splitMediaTokens } from './rich-text'

/**
 * `RichText` is exercised end to end through the host, because it reads the mounted activity's
 * `media[]` and the `resolveMedia` port from context.
 */

const IMAGE: MediaRef = { id: 'm1', kind: 'image', src: 'sha256:0f3a', alt: 'Una célula' }
const PENDING: MediaRef = { id: 'm2', kind: 'image', generate: { by: 'image', prompt: 'x' } }

function renderPrompt(prompt: string, media: MediaRef[], resolveMedia?: ResolveMediaPort) {
  const activity = { ...sampleChoice(), prompt, media }
  return render(
    <ActivityHost
      activity={activity}
      seed="rich-text"
      {...(resolveMedia ? { resolveMedia } : {})}
    />,
  )
}

describe('splitMediaTokens', () => {
  it('leaves text with no token as a single segment', () => {
    expect(splitMediaTokens('Hola **mundo**')).toEqual([
      { key: 't0', kind: 'text', text: 'Hola **mundo**' },
    ])
  })

  it('splits around a token, keeping the Markdown on both sides', () => {
    expect(splitMediaTokens('antes [[media:m1]] después')).toEqual([
      { key: 't0', kind: 'text', text: 'antes ' },
      { key: 'm6', kind: 'media', id: 'm1' },
      { key: 't18', kind: 'text', text: ' después' },
    ])
  })

  it('handles a token at either end, and two in a row', () => {
    expect(splitMediaTokens('[[media:a]][[media:b]]').map((s) => s.kind)).toEqual([
      'media',
      'media',
    ])
  })

  it('gives every segment a distinct key, so React never keys on the array index', () => {
    const segments = splitMediaTokens('a [[media:x]] b [[media:x]] c')
    expect(new Set(segments.map((segment) => segment.key)).size).toBe(segments.length)
  })
})

describe('<RichText/> media', () => {
  it('renders Markdown and KaTeX for a prompt with no media token', async () => {
    renderPrompt('El área es $\\pi r^2$ y **crece**.', [])
    expect(await screen.findByText('crece')).toBeInTheDocument()
  })

  it('resolves [[media:ID]] to an image through the resolveMedia port', async () => {
    renderPrompt('Mirá [[media:m1]] y elegí.', [IMAGE])
    const image = await screen.findByAltText('Una célula')
    expect(image).toHaveAttribute('src', 'media://blob/0f3a')
  })

  it('shows the pending placeholder when the media job has not run yet', async () => {
    renderPrompt('Mirá [[media:m2]].', [PENDING])
    expect(await screen.findByTestId('media-pending-m2')).toBeInTheDocument()
  })

  it('shows the pending placeholder when the host resolves nothing (Storybook, no blob store)', async () => {
    renderPrompt('Mirá [[media:m1]].', [IMAGE], () => null)
    expect(await screen.findByTestId('media-pending-m1')).toBeInTheDocument()
  })

  it('renders an audio reference as the play button, not as an image', async () => {
    renderPrompt('Escuchá [[media:m3]].', [{ id: 'm3', kind: 'audio', src: 'sha256:beef' }])
    expect(await screen.findByTestId('audio-button')).toBeEnabled()
  })

  it('renders nothing for a token whose id is in no media entry', async () => {
    renderPrompt('Mirá [[media:ghost]] acá.', [IMAGE])
    expect(await screen.findByText(/Mirá/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
