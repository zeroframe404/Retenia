-- Hand-written migration: what drizzle-kit cannot express.
--   1. `chunks_fts`  — FTS5 index over `chunks` (docs/spec/05-ingestion-rag.md §4) with
--      the triggers that keep it in sync, including on soft delete.
--   2. `embeddings`  — sqlite-vec `vec0` table, `float[768]`, partitioned by `source_id`,
--      plus the triggers that drop a chunk's vectors when the chunk goes away.
--   3. Soft-delete cascade from `sources` to its `source_units` and `chunks` (and back).
--   4. Seed of the five `importance_levels` (docs/spec/02-memory-system.md §7).
-- Applied once and never edited (docs/spec/00-conventions.md); `src/migrator.ts` verifies
-- its hash on every start.

-- 1. FTS5 ----------------------------------------------------------------------------------
-- A standalone (not "external content") table on purpose: an external-content FTS5 table
-- is keyed by the content table's rowid, and `chunks` has a TEXT primary key, so its rowid
-- is implicit and may be renumbered by VACUUM. Storing `chunk_id` here costs one extra
-- copy of the text (~1 MB per 300-page book) and keeps the index correct forever.
CREATE VIRTUAL TABLE `chunks_fts` USING fts5(
	`chunk_id` UNINDEXED,
	`source_id` UNINDEXED,
	`text`,
	`heading_path`,
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `chunks_fts_ai` AFTER INSERT ON `chunks`
WHEN new.`deleted_at` IS NULL
BEGIN
	INSERT INTO `chunks_fts` (`chunk_id`, `source_id`, `text`, `heading_path`)
	VALUES (new.`id`, new.`source_id`, new.`text`, new.`heading_path`);
END;
--> statement-breakpoint
-- Re-index on the columns that matter; a soft delete (`deleted_at` set) drops the entry
-- and an un-delete puts it back. Bumping `updated_at`/`version` alone does not touch FTS.
CREATE TRIGGER `chunks_fts_au` AFTER UPDATE OF `source_id`, `text`, `heading_path`, `deleted_at` ON `chunks`
BEGIN
	DELETE FROM `chunks_fts` WHERE `chunk_id` = old.`id`;
	INSERT INTO `chunks_fts` (`chunk_id`, `source_id`, `text`, `heading_path`)
	SELECT new.`id`, new.`source_id`, new.`text`, new.`heading_path`
	WHERE new.`deleted_at` IS NULL;
END;
--> statement-breakpoint
-- Domain rows are never hard-deleted; this only keeps the index honest if one ever is.
CREATE TRIGGER `chunks_fts_ad` AFTER DELETE ON `chunks`
BEGIN
	DELETE FROM `chunks_fts` WHERE `chunk_id` = old.`id`;
END;
--> statement-breakpoint

-- 2. sqlite-vec ----------------------------------------------------------------------------
-- `id` is a UUIDv7 like every other table. `source_id` is the partition key (a KNN query
-- with `source_id = ?` scans only that partition); `chunk_id` and `model_id` are metadata
-- columns, filterable in the same query. Derived data: rows are deleted and rebuilt by the
-- embedding job, not soft-deleted, and carry no audit columns (vec0 has no NOT NULL/CHECK).
-- (vec0 parses its column list itself and does not accept quoted identifiers.)
CREATE VIRTUAL TABLE embeddings USING vec0(
	id TEXT PRIMARY KEY,
	source_id TEXT PARTITION KEY,
	chunk_id TEXT,
	model_id TEXT,
	embedding FLOAT[768]
);
--> statement-breakpoint
-- A soft-deleted chunk must not come back from a KNN query any more than from FTS. Its
-- vectors are dropped here; an un-deleted chunk is re-embedded by the embedding job (it
-- looks for live chunks without a vector for the active model).
CREATE TRIGGER `chunks_embeddings_au` AFTER UPDATE OF `deleted_at` ON `chunks`
WHEN new.`deleted_at` IS NOT NULL AND old.`deleted_at` IS NULL
BEGIN
	DELETE FROM embeddings WHERE chunk_id = old.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `chunks_embeddings_ad` AFTER DELETE ON `chunks`
BEGIN
	DELETE FROM embeddings WHERE chunk_id = old.`id`;
END;
--> statement-breakpoint

-- 3. Source soft-delete cascade ------------------------------------------------------------
-- Units and chunks are derived from their source and have no life of their own: deleting
-- "the book" must take them out of search and retrieval too. Done in the database so the
-- invariant holds whoever performs the write. The cascade bumps `version` (a real change,
-- for a future sync) and never lowers `updated_at` below the row's own `created_at`.
-- Un-deleting the source restores exactly the rows the cascade deleted (same timestamp).
-- Knowledge items and annotations made from the source are *not* touched: cards survive
-- their source (docs/spec/02-memory-system.md §14 keeps `source_id` as provenance only).
CREATE TRIGGER `sources_soft_delete_cascade` AFTER UPDATE OF `deleted_at` ON `sources`
WHEN new.`deleted_at` IS NOT NULL AND old.`deleted_at` IS NULL
BEGIN
	UPDATE `source_units`
	   SET `deleted_at` = new.`deleted_at`,
	       `updated_at` = MAX(`updated_at`, new.`updated_at`),
	       `version` = `version` + 1
	 WHERE `source_id` = new.`id` AND `deleted_at` IS NULL;
	UPDATE `chunks`
	   SET `deleted_at` = new.`deleted_at`,
	       `updated_at` = MAX(`updated_at`, new.`updated_at`),
	       `version` = `version` + 1
	 WHERE `source_id` = new.`id` AND `deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `sources_undelete_cascade` AFTER UPDATE OF `deleted_at` ON `sources`
WHEN new.`deleted_at` IS NULL AND old.`deleted_at` IS NOT NULL
BEGIN
	UPDATE `source_units`
	   SET `deleted_at` = NULL,
	       `updated_at` = MAX(`updated_at`, new.`updated_at`),
	       `version` = `version` + 1
	 WHERE `source_id` = new.`id` AND `deleted_at` = old.`deleted_at`;
	UPDATE `chunks`
	   SET `deleted_at` = NULL,
	       `updated_at` = MAX(`updated_at`, new.`updated_at`),
	       `version` = `version` + 1
	 WHERE `source_id` = new.`id` AND `deleted_at` = old.`deleted_at`;
END;
--> statement-breakpoint

-- 4. Importance levels ---------------------------------------------------------------------
-- Fixed UUIDv7 ids (timestamp 2026-09-01T00:00:00Z) so every installation seeds identical
-- rows and a future sync sees one level, not one per device.
-- `new_per_day`: NULL = no per-level cap, reserved for `urgent` ("no cap, by date"); `high`
-- ("introduction priority") is introduced first but stays bounded at the top of the
-- standard 10–20 quota; `maintenance`/`paused` never introduce new items.
-- `desired_retention`/`max_interval_days` NULL = the level is out of the queue.
INSERT INTO `importance_levels`
	(`id`, `name`, `desired_retention`, `max_interval_days`, `order_rank`, `postpone_allowed`, `new_per_day`, `leech_threshold`, `leech_action`, `created_at`, `updated_at`, `deleted_at`, `device_id`, `version`)
VALUES
	('01a05a43-fc00-7b39-9bf2-1abab07b14b1', 'urgent',      0.95, 180,  1, 0, NULL, 8, 'warn',         1788220800000, 1788220800000, NULL, 'system', 1),
	('01a05a43-fc00-78a6-a8cd-9c6371180c59', 'high',        0.92, 365,  2, 1, 20,   8, 'warn_rewrite', 1788220800000, 1788220800000, NULL, 'system', 1),
	('01a05a43-fc00-7c63-8a92-f0365b35c610', 'normal',      0.90, 1825, 3, 1, 15,   8, 'edit',         1788220800000, 1788220800000, NULL, 'system', 1),
	('01a05a43-fc00-7161-90a0-e6fac947c502', 'maintenance', 0.85, 3650, 4, 1, 0,    8, 'suspend',      1788220800000, 1788220800000, NULL, 'system', 1),
	('01a05a43-fc00-7842-968e-f3e63015be7b', 'paused',      NULL, NULL, 5, 0, 0,    8, 'none',         1788220800000, 1788220800000, NULL, 'system', 1);
