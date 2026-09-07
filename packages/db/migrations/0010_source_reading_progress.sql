-- 0010 — where the reader left off, and when.
--
-- Sub-phase 6.6 (`docs/spec/08-ux.md` §2: Home's "Continuar donde estaba"). Two columns on
-- `sources`: `last_locator` (`{ page }` for a PDF, `{ cfi }` for an EPUB) and `last_opened_at`,
-- written by `library.recordProgress` on every page turn/section change and read back by the
-- reader itself (resume) and by Home (the most recently opened sources).
--
-- Added with ALTER TABLE rather than drizzle-kit's table rebuild, for the same reason
-- migration 0009 gives: rebuilding a table in SQLite drops every trigger defined on it, and
-- `sources` carries the two soft-delete cascade triggers of migration 0001
-- (`sources_soft_delete_cascade`, `sources_undelete_cascade`) that take a deleted source's
-- units and chunks — and therefore its FTS5 and vec0 rows — out of retrieval with it. The
-- named column-level CHECK below is accepted by ADD COLUMN and enforces JSON validity under
-- the same constraint name the Drizzle schema declares.
--
-- `src/migrator.ts` runs this file inside one transaction and verifies its hash on every
-- start; once applied it is never edited (docs/spec/00-conventions.md).

ALTER TABLE `sources` ADD `last_locator` text
	CONSTRAINT "sources_last_locator_json"
	CHECK (`last_locator` IS NULL OR (json_valid(`last_locator`) AND json_type(`last_locator`) = 'object'));--> statement-breakpoint
ALTER TABLE `sources` ADD `last_opened_at` integer;--> statement-breakpoint

-- Home's "Continuar donde estaba": the most recently opened sources, oldest last.
CREATE INDEX `sources_last_opened` ON `sources` (`last_opened_at`);
