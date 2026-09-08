-- 0012 — the idempotent AI result cache.
--
-- Sub-phase 7.2 (docs/spec/04-path-generation.md §7: "every call has
-- `custom_id = hash(stage, input_ids, prompt_version)`; if a result exists, it is not
-- repeated (key with the Batch API and for resuming after closing the app)").
--
-- Why a second table rather than a column on `ai_calls`. They answer different questions and
-- have different lifetimes. `ai_calls` is the cost log: one row per *dispatched attempt*,
-- including the ones that failed, the ones that were retried and the ones whose output the
-- repair loop threw away, and it is append-only because it is what a monthly total is summed
-- from. This is the answer store: at most one live row per unit of work, holding the
-- completion that was accepted, replaced when the user asks for a regeneration, and safe to
-- purge wholesale when a model turns out to have been producing rubbish. Folding the two
-- together would mean either purging cost history to clear a cache, or keeping content
-- forever in a table whose documented rule is "never the content itself".
--
-- `output` is TEXT with no `json_valid` CHECK, unlike every other payload column in this
-- schema. That is deliberate: it holds the raw completion, which is JSON for a structured
-- call and prose for the contextualiser, and it is re-parsed and re-validated on every hit
-- rather than trusted. A `json_valid` constraint would exclude half the callers and would
-- still not make the other half's content trustworthy.
--
-- The unique index is partial on `deleted_at`, like every other live-unique index here, so a
-- purged entry does not block the row that replaces it.
--
-- `src/migrator.ts` runs this file inside one transaction and verifies its hash on every
-- start; once applied it is never edited (docs/spec/00-conventions.md).

CREATE TABLE `ai_results` (
	`id` text PRIMARY KEY NOT NULL,
	`custom_id` text NOT NULL,
	`stage` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text,
	`schema_version` text,
	`output` text NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	`last_hit_at` integer,
	`meta` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`device_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ai_results_custom_id_nonempty" CHECK(length("ai_results"."custom_id") > 0),
	CONSTRAINT "ai_results_stage_nonempty" CHECK(length("ai_results"."stage") > 0),
	CONSTRAINT "ai_results_cost_nonnegative" CHECK("ai_results"."cost_usd" >= 0),
	CONSTRAINT "ai_results_hits_nonnegative" CHECK("ai_results"."hits" >= 0),
	CONSTRAINT "ai_results_meta_json" CHECK("ai_results"."meta" IS NULL OR (json_valid("ai_results"."meta") AND json_type("ai_results"."meta") = 'object')),
	CONSTRAINT "ai_results_id_uuidv7" CHECK(length("ai_results"."id") = 36 AND substr("ai_results"."id", 15, 1) = '7'),
	CONSTRAINT "ai_results_version_positive" CHECK("ai_results"."version" >= 1),
	CONSTRAINT "ai_results_updated_after_created" CHECK("ai_results"."updated_at" >= "ai_results"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_results_custom_id_live` ON `ai_results` (`custom_id`) WHERE "ai_results"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `ai_results_stage` ON `ai_results` (`stage`,`created_at`);