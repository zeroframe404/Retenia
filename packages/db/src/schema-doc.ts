import { hashMigration, loadMigrations, migrate } from './migrator'
import { DATABASE_PRAGMAS, IN_MEMORY, openDatabase } from './open-database'
import { EMBEDDING_DIMENSIONS, FTS_TOKENIZER } from './search'

/**
 * Renders `docs/spec/07a-schema.md` from a freshly migrated in-memory database: every
 * table, column, foreign key, index, CHECK and trigger as SQLite itself reports them.
 * `scripts/schema-doc.ts` writes the file; `schema-doc.test.ts` fails when the committed
 * document is stale, so the listing can never drift from the shipped migrations.
 */

interface ColumnInfo {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

interface ForeignKeyInfo {
  id: number
  seq: number
  table: string
  from: string
  to: string
}

interface IndexListRow {
  name: string
  unique: number
  origin: string
  partial: number
}

interface IndexInfoRow {
  seqno: number
  name: string | null
}

interface MasterRow {
  type: string
  name: string
  tbl_name: string
  sql: string | null
}

/** Tables grouped the way `src/schema/*.ts` is, for the reader; the generator lists any
 * table missing from this map under "Other" so nothing can be silently omitted. */
const TABLE_GROUPS: readonly { title: string; blurb: string; tables: readonly string[] }[] = [
  {
    title: 'Source library',
    blurb:
      'What the user loads, how it is split for citation and retrieval, what they mark on it (`src/schema/library.ts`).',
    tables: ['blobs', 'sources', 'source_units', 'chunks', 'annotations'],
  },
  {
    title: 'Search indexes (virtual tables)',
    blurb: `FTS5 over \`chunks\` and the sqlite-vec store. Created by the raw-SQL migrations, queried through \`src/search.ts\`. \`chunks_fts\` is kept in sync by triggers, including on soft delete; \`embeddings\` (exact \`float\`) and \`embeddings_i8\` (its quantized companion, what a KNN query scans) are derived data that the embedding job deletes and rebuilds, so they carry no audit columns (\`vec0\` has no NOT NULL/CHECK).`,
    tables: ['chunks_fts', 'embeddings', 'embeddings_i8'],
  },
  {
    title: 'Learning paths',
    blurb:
      'A path, its frozen versions, and the version-owned tree sections → modules → lessons → activities (`src/schema/paths.ts`).',
    tables: ['paths', 'path_versions', 'sections', 'modules', 'lessons', 'activities'],
  },
  {
    title: 'Exams and item bank',
    blurb:
      'Dated/mock/final/diagnostic exams, their items and attempts, and the generated item bank (`src/schema/exams.ts`).',
    tables: ['exams', 'item_bank', 'exam_items', 'exam_attempts'],
  },
  {
    title: 'Memory system',
    blurb:
      'Importance levels, FSRS parameters, knowledge items and cards. FSRS columns mirror `ts-fsrs` 1:1 (`src/schema/memory.ts`).',
    tables: ['importance_levels', 'scheduler_profiles', 'knowledge_items', 'cards'],
  },
  {
    title: 'Sessions, attempts and review log',
    blurb:
      'What the user did: lesson sessions, activity attempts and the append-only FSRS review log (`src/schema/sessions.ts`).',
    tables: ['lesson_sessions', 'attempts', 'review_logs'],
  },
  {
    title: 'Infrastructure',
    blurb:
      'Job queue, AI cost log, settings and the (v1-empty) sync outbox (`src/schema/system.ts`).',
    tables: ['jobs', 'ai_calls', 'settings', 'outbox'],
  },
  {
    title: 'Gamification',
    blurb: 'XP ledger, streaks and achievements (`src/schema/gamification.ts`).',
    tables: ['xp_events', 'streaks', 'achievements'],
  },
  {
    title: 'Migration bookkeeping',
    blurb:
      'Owned by `src/migrator.ts`, created on first open. The one table without the UUIDv7/audit set: it describes the schema, is never synced, and must exist before any migration runs.',
    tables: ['_migrations'],
  },
]

/** The internal tables FTS5 and vec0 create beside a virtual table (`embeddings_chunks`,
 *  `chunks_fts_data`…). Their prefixes also prefix real tables, so the real ones win. */
const VIRTUAL_TABLES = ['chunks_fts', 'embeddings', 'embeddings_i8']

function isShadowTable(name: string): boolean {
  if (VIRTUAL_TABLES.includes(name)) return false
  return VIRTUAL_TABLES.some((table) => name.startsWith(`${table}_`))
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function code(value: string): string {
  return `\`${value.replace(/`/g, '')}\``
}

/** Strips drizzle-kit's `"table"."column"` qualifiers so expressions read as plain SQL. */
function unqualify(expression: string, table: string): string {
  return expression.replace(new RegExp(`"${table}"\\."([a-z0-9_]+)"`, 'g'), '$1').replace(/`/g, '')
}

/** Pulls `CONSTRAINT "name" CHECK(expr)` pairs out of a CREATE TABLE statement, honouring
 * nested parentheses inside `expr`. */
function parseChecks(createSql: string): { name: string; expression: string }[] {
  const checks: { name: string; expression: string }[] = []
  const marker = /CONSTRAINT "([^"]+)" CHECK\(/g
  let match = marker.exec(createSql)
  while (match !== null) {
    let depth = 1
    let i = marker.lastIndex
    while (i < createSql.length && depth > 0) {
      const ch = createSql[i]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      i++
    }
    checks.push({ name: match[1] as string, expression: createSql.slice(marker.lastIndex, i - 1) })
    match = marker.exec(createSql)
  }
  return checks
}

export function renderSchemaDoc(): string {
  const opened = openDatabase(IN_MEMORY)
  try {
    migrate(opened)
    const { sqlite } = opened

    const master = sqlite
      .prepare<[], MasterRow>(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
    const tables = master
      .filter((row) => row.type === 'table' && !isShadowTable(row.name))
      .map((row) => row.name)
    const triggers = master.filter((row) => row.type === 'trigger')
    const indexSql = new Map(
      master.filter((row) => row.type === 'index').map((row) => [row.name, row.sql]),
    )

    const grouped = new Set(TABLE_GROUPS.flatMap((group) => group.tables))
    const groups = [
      ...TABLE_GROUPS,
      {
        title: 'Other',
        blurb: 'Tables not yet assigned to a group in `src/schema-doc.ts`.',
        tables: tables.filter((name) => !grouped.has(name)),
      },
    ].filter((group) => group.tables.length > 0)

    const out: string[] = []
    const line = (text = '') => out.push(text)

    line('Generated by `pnpm --filter @retenia/db schema:doc` — do not edit by hand.')
    line()
    line('# Data schema (v1)')
    line()
    line(
      'The SQLite schema of `packages/db`, listed from a freshly migrated database so it matches the shipped migrations exactly. It implements the data layer of [`07-architecture.md`](07-architecture.md) §5, the memory model of [`02-memory-system.md`](02-memory-system.md) §14, the activity envelope of [`03-activities.md`](03-activities.md) §7 and the path schemas of [`04-path-generation.md`](04-path-generation.md) §8.',
    )
    line()
    line('## Conventions')
    line()
    line(
      "- **Ids** are UUIDv7 strings (`@retenia/core` `createUuidV7Generator`). Every domain table has `CHECK (length(id) = 36 AND substr(id, 15, 1) = '7')`, so a v4 id or an integer is rejected at the boundary.",
    )
    line(
      '- **Audit columns** on every domain table: `created_at`, `updated_at` (Unix ms), `deleted_at` (soft delete — nothing issues `DELETE`), `device_id`, `version` (starts at 1, incremented per update). `updated_at >= created_at` and `version >= 1` are CHECKed.',
    )
    line(
      "- **JSON** lives in `TEXT` columns guarded by `json_valid()`; where the shape is fixed, also by `json_type() = 'object'`/`'array'`. Drizzle parses/stringifies them (`text(…, { mode: 'json' })`).",
    )
    line(
      '- **Enumerations** are `TEXT`/`INTEGER` columns with `CHECK (… IN (…))`; the allowed values are exported as constants from `@retenia/db/schema` (`IMPORTANCE_LEVELS`, `CARD_STATES`, `REVIEW_CONTEXTS`, …).',
    )
    line(
      "- **Foreign keys** are declared everywhere a column holds another row's id and are enforced (`PRAGMA foreign_keys = ON`). No `ON DELETE` cascades: rows are soft-deleted, never removed (the one cascade is a soft one, see the triggers bullet).",
    )
    line(
      '- **Live-only unique indexes** (`… WHERE deleted_at IS NULL`) let a soft-deleted key be reused (`settings.key`, `scheduler_profiles.scope`, `streaks.kind`, `achievements.key`). There is deliberately no uniqueness on `cards(item_id, template)`: one skill may be rendered by several cards of the same shape, each with its own FSRS state.',
    )
    line(
      "- **FSRS parity**: the nine `cards` columns `due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, state, last_review` and the nine `review_logs` columns `rating, state, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, review` are `ts-fsrs`'s `Card`/`ReviewLog` verbatim. In `review_logs`, `state/due/stability/difficulty` are the values *before* the review (what `02-memory-system.md` §14 sketches as `*_before`). `elapsed_days` is deliberately absent from `cards` (`ts-fsrs@6` drops it) and is not range-checked on `review_logs`: ts-fsrs derives it from `last_review`, so an imported history or a clock step can make it negative, and a review must never be lost to a CHECK.",
    )
    line(
      '- **`review_logs` is append-only**: `CHECK (updated_at = created_at AND version = 1)` rejects any update except setting `deleted_at` when the parent card is soft-deleted.',
    )
    line(
      "- **Derived data follows soft deletes (triggers)**: `chunks_fts` mirrors `chunks` on insert, update, soft delete and un-delete; `embeddings` drops a chunk's vectors when the chunk is soft-deleted or deleted (an un-deleted chunk is re-embedded by the embedding job). Soft-deleting a `sources` row cascades to its `source_units` and `chunks` (bumping their `version`, never lowering `updated_at` below their own `created_at`), and un-deleting the source restores exactly the rows that cascade touched. Knowledge items and annotations made from a source are not touched: cards outlive their source.",
    )
    line(
      '- **Sync-ready**: UUIDv7 ids, soft deletes, `device_id`/`version` per row, an `outbox` that stays empty in v1, no `AUTOINCREMENT`.',
    )
    line()
    line('## Opening the database')
    line()
    line(
      '`openDatabase(path, { encryptionKey?, driver?, loadVec?, readonly?, busyTimeoutMs? })` (`src/open-database.ts`) applies, in order:',
    )
    line()
    line('```sql')
    for (const [name, value] of Object.entries(DATABASE_PRAGMAS)) line(`PRAGMA ${name} = ${value};`)
    line('```')
    line()
    line(
      `then loads sqlite-vec with \`db.loadExtension(getLoadablePath())\` and wraps the connection in Drizzle (\`drizzle-orm\` 0.45, \`better-sqlite3\` 13). Both drivers ship N-API prebuilds for win32/darwin/linux inside the npm package (no build step; \`allowBuilds\` lists them as \`false\` on purpose). \`better-sqlite3-multiple-ciphers\` is an optional dependency selected by \`driver: 'better-sqlite3-multiple-ciphers'\` or automatically when \`encryptionKey\` is given; the key comes from \`safeStorage\` in the main process and is applied as \`PRAGMA cipher = 'chacha20'; PRAGMA key = …\` before any other statement. Passing a key to the plain driver is an error rather than a silent no-op.`,
    )
    line()
    line(
      'Packaging note (Windows first): the `.node` binaries of both drivers and `sqlite-vec-windows-x64/vec0.dll` must be `asarUnpack`ed by electron-builder, and sqlite-vec resolves its binary with `import.meta.resolve`, so the main bundle has to keep it external.',
    )
    line()
    line('## Migrations')
    line()
    line(
      '`packages/db/migrations/NNNN_name.sql` — `drizzle-kit generate` output for the Drizzle tables, plus hand-written files (`drizzle-kit generate --custom`) for what Drizzle cannot express. `migrate(db)` (`src/migrator.ts`) runs on every app start: it creates `_migrations` if needed, applies each pending file inside its own transaction (a failing statement rolls the whole file back) and records `name`, `sha256`, `applied_at`, `duration_ms`.',
    )
    line()
    line(
      "**Applied migrations are immutable.** The migrator compares every recorded hash with the file on disk and refuses to start if one changed, refuses a database migrated further than the build knows (no silent downgrade), and refuses a pending file that sorts before an applied one. To change the schema, add a new file — never edit or delete an existing one (`docs/spec/00-conventions.md`; the repo's Claude hooks block edits under `migrations/`).",
    )
    line()
    line('| # | Migration | SHA-256 (prefix) | Contents |')
    line('|---|---|---|---|')
    const contents: Record<string, string> = {
      '0000_domain_schema': 'All Drizzle tables, indexes, foreign keys and CHECKs.',
      '0001_fts5_vec0_seed': `\`chunks_fts\` (FTS5, \`${FTS_TOKENIZER}\`) + sync triggers, \`embeddings\` (vec0, \`float[${EMBEDDING_DIMENSIONS}]\`, partition \`source_id\`), the vector-maintenance and source soft-delete cascade triggers, the five \`importance_levels\` rows.`,
      '0002_embeddings_int8': `\`embeddings_i8\` (vec0, \`int8[${EMBEDDING_DIMENSIONS}]\`, partition \`source_id\`): the quantized companion a KNN query scans, rescored against the exact float vectors, plus its maintenance triggers.`,
    }
    for (const [index, migration] of loadMigrations().entries()) {
      line(
        `| ${index} | ${code(migration.name)} | ${code(hashMigration(migration.sql).slice(0, 12))} | ${contents[migration.name] ?? ''} |`,
      )
    }
    line()

    line('## Tables')
    line()
    line('| Table | Group | Columns | Foreign keys | Indexes | Checks |')
    line('|---|---|---|---|---|---|')
    for (const group of groups) {
      for (const table of group.tables) {
        const columns = sqlite.pragma(`table_info('${table}')`) as ColumnInfo[]
        const fks = sqlite.pragma(`foreign_key_list('${table}')`) as ForeignKeyInfo[]
        const indexes = (sqlite.pragma(`index_list('${table}')`) as IndexListRow[]).filter(
          (index) => index.origin === 'c',
        )
        const create = master.find((row) => row.type === 'table' && row.name === table)?.sql ?? ''
        line(
          `| ${code(table)} | ${group.title} | ${columns.length} | ${fks.length} | ${indexes.length} | ${parseChecks(create).length} |`,
        )
      }
    }
    line()

    for (const group of groups) {
      line(`## ${group.title}`)
      line()
      line(group.blurb)
      line()
      for (const table of group.tables) {
        const create = master.find((row) => row.type === 'table' && row.name === table)
        line(`### ${code(table)}`)
        line()
        if (create?.sql?.includes('USING ')) {
          line('Virtual table — DDL as shipped:')
          line()
          line('```sql')
          line(create.sql)
          line('```')
        } else {
          const columns = sqlite.pragma(`table_info('${table}')`) as ColumnInfo[]
          const fks = sqlite.pragma(`foreign_key_list('${table}')`) as ForeignKeyInfo[]
          const fkByColumn = new Map(fks.map((fk) => [fk.from, `${fk.table}.${fk.to}`]))
          line('| Column | Type | Null | Default | Key |')
          line('|---|---|---|---|---|')
          for (const column of columns) {
            const key = [
              column.pk ? 'PK' : '',
              fkByColumn.has(column.name) ? `→ ${code(fkByColumn.get(column.name) as string)}` : '',
            ]
              .filter(Boolean)
              .join(' ')
            line(
              `| ${code(column.name)} | ${column.type.toLowerCase() || '—'} | ${column.notnull ? 'no' : 'yes'} | ${column.dflt_value === null ? '' : code(column.dflt_value)} | ${key} |`,
            )
          }
        }
        line()

        const indexes = (sqlite.pragma(`index_list('${table}')`) as IndexListRow[]).filter(
          (index) => index.origin === 'c',
        )
        if (indexes.length > 0) {
          line('Indexes:')
          line()
          for (const index of indexes) {
            const cols = (sqlite.pragma(`index_info('${index.name}')`) as IndexInfoRow[])
              .sort((a, b) => a.seqno - b.seqno)
              .map((row) => row.name ?? '<expr>')
            const where = / WHERE (.*)$/s.exec(indexSql.get(index.name) ?? '')?.[1]
            line(
              `- ${code(index.name)}${index.unique ? ' UNIQUE' : ''} (${cols.map(code).join(', ')})${where ? ` WHERE ${code(unqualify(where, table))}` : ''}`,
            )
          }
          line()
        }

        const checks = create?.sql ? parseChecks(create.sql) : []
        if (checks.length > 0) {
          line('Checks:')
          line()
          for (const check of checks) {
            line(`- ${code(check.name)}: ${code(escapeCell(unqualify(check.expression, table)))}`)
          }
          line()
        }

        const tableTriggers = triggers.filter((trigger) => trigger.tbl_name === table)
        if (tableTriggers.length > 0) {
          line('Triggers:')
          line()
          for (const trigger of tableTriggers) {
            const head = /^CREATE TRIGGER `?\w+`? (.*?)\n(?:WHEN|BEGIN)/s.exec(
              trigger.sql ?? '',
            )?.[1]
            line(`- ${code(trigger.name)}: ${head ? unqualify(head, table) : ''}`)
          }
          line()
        }
      }
    }

    return `${out.join('\n').trimEnd()}\n`
  } finally {
    opened.close()
  }
}
