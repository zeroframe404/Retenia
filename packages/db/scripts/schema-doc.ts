import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderSchemaDoc } from '../src/schema-doc'

/**
 * Regenerates `docs/spec/07a-schema.md` from the shipped migrations.
 *
 *   pnpm --filter @retenia/db schema:doc
 *
 * Run it after every migration; `src/schema-doc.test.ts` fails while the committed document
 * is stale.
 */
const target = fileURLToPath(new URL('../../../docs/spec/07a-schema.md', import.meta.url))
writeFileSync(target, renderSchemaDoc())
console.log(`wrote ${target}`)
