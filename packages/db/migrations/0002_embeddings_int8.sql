-- Hand-written migration: the int8 companion of the vector index (sub-phase 3.3,
-- docs/spec/05-ingestion-rag.md §3, §4).
--
-- Why a second table. `embeddings` (FLOAT[768], migration 0001) stays the source of truth:
-- exact vectors, exact distances, nothing lost. `embeddings_i8` holds the same vectors
-- quantized to int8 and is what a KNN query actually scans. sqlite-vec is brute force (no
-- ANN), so a query reads every vector in the partition: at 50k chunks that is 147 MB of
-- float32 against 37 MB of int8. The int8 scan is the coarse pass; its top candidates are
-- then rescored against the exact float vectors by primary key, so the distances and the
-- order returned are the exact ones and only the *candidate set* is approximate.
-- `src/search.ts` records the measured cost and recall of the tradeoff.
--
-- Applied once and never edited (docs/spec/00-conventions.md); `src/migrator.ts` verifies
-- its hash on every start. Databases created before this migration keep their float
-- vectors and are backfilled by the embedding job, which writes both tables from now on.

-- Same id as the `embeddings` row it mirrors: the rescoring pass looks the exact vector up
-- by it. Same partition key and metadata columns, so a filtered query (`source_id IN (...)`,
-- `model_id = ...`) scans exactly the same subset in both tables.
-- (vec0 parses its column list itself and does not accept quoted identifiers.)
CREATE VIRTUAL TABLE embeddings_i8 USING vec0(
	id TEXT PRIMARY KEY,
	source_id TEXT PARTITION KEY,
	chunk_id TEXT,
	model_id TEXT,
	embedding INT8[768]
);
--> statement-breakpoint
-- The same guarantees migration 0001 gives `embeddings`: a soft-deleted chunk must not come
-- back from a KNN query, and a hard delete (which the domain never does) cannot leave the
-- index stale. Derived data: rows are deleted and rebuilt by the embedding job.
CREATE TRIGGER `chunks_embeddings_i8_au` AFTER UPDATE OF `deleted_at` ON `chunks`
WHEN new.`deleted_at` IS NOT NULL AND old.`deleted_at` IS NULL
BEGIN
	DELETE FROM embeddings_i8 WHERE chunk_id = old.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `chunks_embeddings_i8_ad` AFTER DELETE ON `chunks`
BEGIN
	DELETE FROM embeddings_i8 WHERE chunk_id = old.`id`;
END;
