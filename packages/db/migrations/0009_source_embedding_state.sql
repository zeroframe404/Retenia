-- 0009 — where each source stands in the vector index.
--
-- Sub-phase 6.3 (docs/spec/05-ingestion-rag.md §3: "store the `model_id` per embedding and
-- never mix spaces; reindex as a job"). Three columns on `sources` and one index.
--
-- Why these live on the source and not only on `embeddings`. The vec0 tables answer
-- "which vectors exist"; they cannot answer "is this source fully embedded, in which space,
-- and if not, why" without a scan and a join, and that question is asked on every start
-- (the reindex sweep), on every source card, and before every hybrid query. It is also a
-- different question from `sources.status`: a source can be `ready` — parsed, chunked,
-- readable, findable by BM25 — while its vectors are missing, queued behind a model
-- download, or in the space of a model the user has since switched away from.
--
-- `embedding_model_id` *is* the reindex trigger. The sweep asks for every source whose
-- value differs from the active provider's `modelId` and re-embeds those, dropping the old
-- vectors first. Comparing against the model, rather than keeping a "stale" flag, means
-- switching models and switching back cannot lose track of what is already correct.
--
-- Added with ALTER TABLE rather than drizzle-kit's table rebuild, for the same reason
-- migration 0008 gives: rebuilding a table in SQLite drops every trigger defined on it, and
-- `sources` carries the two soft-delete cascade triggers of migration 0001
-- (`sources_soft_delete_cascade`, `sources_undelete_cascade`) that take a deleted source's
-- units and chunks — and therefore its FTS5 and vec0 rows — out of retrieval with it.
-- Restating those on every column addition is exactly the kind of duplication that ends up
-- out of step. The named column-level CHECK below is accepted by ADD COLUMN and enforces
-- the enum under the same constraint name the Drizzle schema declares.
--
-- `src/migrator.ts` runs this file inside one transaction and verifies its hash on every
-- start; once applied it is never edited (docs/spec/00-conventions.md).

ALTER TABLE `sources` ADD `embedding_status` text DEFAULT 'pending' NOT NULL
	CONSTRAINT "sources_embedding_status"
	CHECK (`embedding_status` IN ('pending', 'running', 'ready', 'failed'));--> statement-breakpoint
ALTER TABLE `sources` ADD `embedding_model_id` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `embedding_error` text;--> statement-breakpoint

-- "Which sources still need embedding?" and "which are in another model's space?" are the
-- two queries the sweep runs at every start; both are this index, not a table scan.
CREATE INDEX `sources_embedding` ON `sources` (`embedding_status`,`embedding_model_id`);
