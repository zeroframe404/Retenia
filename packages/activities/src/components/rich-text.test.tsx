import type { MediaRef } from '@retenia/activity-schema'
import { sampleChoice } from '@retenia/activity-schema/testing/samples'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ActivityHost } from '../host/activity-host'
import type { ResolveMediaPort } from '../host/ports'
import { splitMediaTokens, toPlainText } from './rich-text'

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

/**
 * §7's "code is inert" reaches the media layer: a lesson or a QA gate quoting `[[media:ID]]` as
 * an example must see the token, not an element. Splitting on it would also cut the fence across
 * two independent `MarkdownView` documents and leave the first one unterminated.
 */
describe('splitMediaTokens inside code', () => {
  const single = (source: string) =>
    expect(splitMediaTokens(source)).toEqual([{ key: 't0', kind: 'text', text: source }])

  it('leaves a token inside a backtick fence in the text, fence intact', () => {
    single('Así se escribe:\n\n```md\n[[media:m1]]\n```\n')
  })

  it('leaves a token inside a tilde fence in the text', () => {
    single('~~~\n[[media:m1]]\n~~~\n')
  })

  it('leaves a token inside an unterminated fence in the text', () => {
    single('```\n[[media:m1]]\n')
  })

  it('leaves a token inside a fence nested in a blockquote or a list item', () => {
    single('> ```\n> [[media:m1]]\n> ```\n')
    single('- item\n\n  ```\n  [[media:m1]]\n  ```\n')
  })

  it('leaves a token inside a code span in the text', () => {
    single('Escribí `[[media:m1]]` en el prompt.')
    single('Con doble backtick: ``[[media:m1]]`` también.')
  })

  it('still resolves a token outside the fence in the same document', () => {
    const source = 'Mirá [[media:m1]].\n\n```\n[[media:m2]]\n```\n'
    expect(splitMediaTokens(source).map((segment) => segment.kind)).toEqual([
      'text',
      'media',
      'text',
    ])
    expect(splitMediaTokens(source).at(-1)).toMatchObject({
      kind: 'text',
      text: '.\n\n```\n[[media:m2]]\n```\n',
    })
  })

  it('does not treat a lone backtick as opening a span that swallows the rest', () => {
    expect(splitMediaTokens("don't `worry — [[media:m1]] sigue vivo").map((s) => s.kind)).toEqual([
      'text',
      'media',
      'text',
    ])
  })

  it('does not let a code span cross a blank line', () => {
    expect(splitMediaTokens('`abre\n\n[[media:m1]]\n\ncierra`').map((s) => s.kind)).toEqual([
      'text',
      'media',
      'text',
    ])
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

  it('renders a token inside a fenced block as literal code, not as an image', async () => {
    const { container } = renderPrompt('Se escribe así:\n\n```md\n[[media:m1]]\n```\n', [IMAGE])
    await screen.findByText(/Se escribe así/)
    expect(container.querySelector('pre')?.textContent).toContain('[[media:m1]]')
    expect(screen.queryByAltText('Una célula')).not.toBeInTheDocument()
  })

  it('renders a token inside backticks as literal code, not as an image', async () => {
    renderPrompt('Escribí `[[media:m1]]` en el prompt.', [IMAGE])
    expect(await screen.findByText('[[media:m1]]')).toBeInTheDocument()
    expect(screen.queryByAltText('Una célula')).not.toBeInTheDocument()
  })
})

describe('toPlainText', () => {
  it.each([
    ['**She**', 'She', 'strong emphasis'],
    ['El *río* Paraná', 'El río Paraná', 'inline emphasis'],
    ['~~no~~ sí', 'no sí', 'strikethrough'],
    ['$H_2O$', 'H_2O', 'inline math delimiters'],
    ['$$E = mc^2$$', 'E = mc^2', 'display math delimiters'],
    ['Escribí `const x` acá', 'Escribí const x acá', 'a code span'],
    ['[París](https://example.test)', 'París', 'a link, keeping its text'],
    ['![Una célula](media://blob/abc)', 'Una célula', 'an image, keeping its alt'],
    ['Mirá [[media:m1]] acá', 'Mirá acá', 'a media reference'],
    ['## Título', 'Título', 'a heading marker'],
    ['- primero', 'primero', 'a list marker'],
    ['> citado', 'citado', 'a blockquote marker'],
  ])('reduces %s to %s (%s)', (source, expected) => {
    expect(toPlainText(source)).toBe(expected)
  })

  it('leaves an underscore Markdown would not emphasize where it is', () => {
    // `snake_case` and `H_2O` are the common shape in lesson content; stripping every `_` would
    // rename them in the announcement and in every `aria-label`.
    expect(toPlainText('el archivo snake_case_name.ts')).toBe('el archivo snake_case_name.ts')
  })

  it('drops a fenced block whole — there is no prose in it to read out', () => {
    expect(toPlainText('Antes\n\n```ts\nconst x = 1\n```\n\nDespués')).toBe('Antes Después')
  })

  it('keeps text it does not recognize rather than guessing', () => {
    expect(toPlainText('2 < 3 & 4 > 1')).toBe('2 < 3 & 4 > 1')
  })
})
