import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderSchemaDoc } from './schema-doc'

const DOC_PATH = fileURLToPath(new URL('../../../docs/spec/07a-schema.md', import.meta.url))

describe('docs/spec/07a-schema.md', () => {
  const rendered = renderSchemaDoc()

  it('is the generated listing of the migrated schema (run `pnpm --filter @retenia/db schema:doc`)', () => {
    const committed = readFileSync(DOC_PATH, 'utf8').replace(/\r\n/g, '\n')
    expect(committed).toBe(rendered)
  })

  it('assigns every table to a group', () => {
    expect(rendered).not.toContain('## Other')
  })

  it('documents the spec-mandated structures', () => {
    expect(rendered).toContain('### `cards`')
    expect(rendered).toContain('`cards_due` (`due`) WHERE `suspended = 0 AND deleted_at IS NULL`')
    expect(rendered).toContain('`rl_card` (`card_id`, `review`)')
    expect(rendered).toContain("tokenize = 'unicode61 remove_diacritics 2'")
    expect(rendered).toContain('embedding FLOAT[768]')
    expect(rendered).toContain('embedding INT8[768]')
    expect(rendered).toContain('`chunks_fts_ai`')
    expect(rendered).toContain('`chunks_embeddings_au`')
    expect(rendered).toContain('`chunks_embeddings_i8_au`')
    expect(rendered).toContain('`sources_soft_delete_cascade`')
    expect(rendered).toContain('`sources_undelete_cascade`')
    expect(rendered).toContain('| 0 | `0000_domain_schema` |')
    expect(rendered).toContain('| 1 | `0001_fts5_vec0_seed` |')
    expect(rendered).toContain('| 2 | `0002_embeddings_int8` |')
  })
})
