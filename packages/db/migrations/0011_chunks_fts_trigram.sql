-- 0011 — a second FTS5 index over `chunks`, tokenized for substrings rather than words.
--
-- `docs/spec/05-ingestion-rag.md` §4: "`chunks_fts` (FTS5, tokenizer
-- `unicode61 remove_diacritics 2` + trigram for Spanish)". One FTS5 table has exactly one
-- `tokenize=` clause, so "unicode61 ... + trigram" cannot be one table — it is `chunks_fts`
-- (migrations 0001, 0008) plus this second table, queried alongside it
-- (`src/search.ts`'s `searchChunksFtsTrigram`, merged into the fts branch by
-- `hybrid-search.ts`).
--
-- What a word tokenizer cannot reach is exactly what Spanish needs reached: "lula" typed
-- into a search box will never match a *word* "célula" under `unicode61`, because "lula" is
-- not a prefix of any token the tokenizer produced — it is a prefix only once you are already
-- inside the word. SQLite's own trigram tokenizer indexes every overlapping 3-character
-- window instead of whole tokens, which is what makes an infix match possible at all, and
-- its `remove_diacritics 1` option (verified against the bundled SQLite; it is the trigram
-- tokenizer's own option, distinct from `unicode61`'s `remove_diacritics 2`) folds "célula"
-- and "celula" onto the same trigrams the same way `chunks_fts` already does for whole words.
--
-- Same columns, same triggers, same backfill as 0008's rebuild of `chunks_fts` — deliberately
-- a parallel structure rather than a shared one, so the word index keeps its own ranking
-- undisturbed by trigram noise (a bare word query still prefers `chunks_fts`'s bm25 order;
-- the trigram table only ever contributes chunks the word index missed entirely — see
-- `mergeFtsHits` in `src/hybrid-search.ts`).
CREATE VIRTUAL TABLE `chunks_fts_trigram` USING fts5(
	`chunk_id` UNINDEXED,
	`source_id` UNINDEXED,
	`text`,
	`heading_path`,
	`context`,
	tokenize = 'trigram remove_diacritics 1'
);
--> statement-breakpoint
CREATE TRIGGER `chunks_fts_trigram_ai` AFTER INSERT ON `chunks`
WHEN new.`deleted_at` IS NULL
BEGIN
	INSERT INTO `chunks_fts_trigram` (`chunk_id`, `source_id`, `text`, `heading_path`, `context`)
	VALUES (new.`id`, new.`source_id`, new.`text`, new.`heading_path`, new.`context`);
END;
--> statement-breakpoint
CREATE TRIGGER `chunks_fts_trigram_au` AFTER UPDATE OF `source_id`, `text`, `heading_path`, `context`, `deleted_at` ON `chunks`
BEGIN
	DELETE FROM `chunks_fts_trigram` WHERE `chunk_id` = old.`id`;
	INSERT INTO `chunks_fts_trigram` (`chunk_id`, `source_id`, `text`, `heading_path`, `context`)
	SELECT new.`id`, new.`source_id`, new.`text`, new.`heading_path`, new.`context`
	WHERE new.`deleted_at` IS NULL;
END;
--> statement-breakpoint
-- Domain rows are never hard-deleted; this only keeps the index honest if one ever is.
CREATE TRIGGER `chunks_fts_trigram_ad` AFTER DELETE ON `chunks`
BEGIN
	DELETE FROM `chunks_fts_trigram` WHERE `chunk_id` = old.`id`;
END;
--> statement-breakpoint
INSERT INTO `chunks_fts_trigram` (`chunk_id`, `source_id`, `text`, `heading_path`, `context`)
SELECT `id`, `source_id`, `text`, `heading_path`, `context` FROM `chunks` WHERE `deleted_at` IS NULL;
