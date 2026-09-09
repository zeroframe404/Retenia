-- 0014 — path generation: the run ledger and the per-chunk extraction store.
--
-- Sub-phase 8.1 (docs/spec/04-path-generation.md §3 stages 3–5: extraction per chunk with a
-- cheap model in batch, graph and outline synthesis with a strong model, deterministic
-- sequencing in code; §7: "every call has `custom_id = hash(stage, input_ids, prompt_version)`;
-- if a result exists, it is not repeated").
--
-- `generation_runs` is the ledger of one press of "Generate with AI": the configuration and
-- its hash, the status (which is the stage), where the run had got to, the estimate it was
-- quoted, what it has cost, the manifest so far and its warnings. `status = 'blocked_budget'`
-- is a pause, not an end: the run's own cost cap (or the monthly one) stopped it before the
-- next paid call, and "continue anyway" resumes it.
--
-- `extractions` holds the validated P1 output of one chunk, keyed by the same `custom_id` the
-- raw completion sits under in `ai_results`. Two tables for one answer, on purpose: `ai_results`
-- is purgeable text for any call; this is the parsed, chunk-addressed document consolidation
-- reads, and the reason a re-run over the same book makes no P1 call. `custom_id` is built from
-- the chunk's identity and the prompt and schema versions — never the run — so any later run
-- reuses the row, and `run_id` only records which run first produced it.
--
-- What is deliberately NOT a table is the draft. It is an unfrozen `path_versions` row —
-- `spec` holds the `PathDraft.v1`, `frozen_at IS NULL` says "still editable" — so the freeze of
-- sub-phase 8.2 is a timestamp on the same row rather than a copy.
--
-- `src/migrator.ts` runs this file inside one transaction and verifies its hash on every
-- start; once applied it is never edited (docs/spec/00-conventions.md).

CREATE TABLE `extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`source_id` text NOT NULL,
	`chunk_id` text NOT NULL,
	`chunk_key` text,
	`chunk_hash` text NOT NULL,
	`custom_id` text NOT NULL,
	`prompt_version` text NOT NULL,
	`schema_version` text NOT NULL,
	`provider` text,
	`model` text NOT NULL,
	`output` text NOT NULL,
	`concept_count` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`device_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `generation_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chunk_id`) REFERENCES `chunks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "extractions_custom_id_nonempty" CHECK(length("extractions"."custom_id") > 0),
	CONSTRAINT "extractions_chunk_hash_sha256" CHECK(length("extractions"."chunk_hash") = 64),
	CONSTRAINT "extractions_output_json" CHECK(json_valid("extractions"."output") AND json_type("extractions"."output") = 'object'),
	CONSTRAINT "extractions_concept_count_nonnegative" CHECK("extractions"."concept_count" >= 0),
	CONSTRAINT "extractions_input_tokens_nonnegative" CHECK("extractions"."input_tokens" >= 0),
	CONSTRAINT "extractions_output_tokens_nonnegative" CHECK("extractions"."output_tokens" >= 0),
	CONSTRAINT "extractions_cached_tokens_nonnegative" CHECK("extractions"."cached_tokens" >= 0),
	CONSTRAINT "extractions_cost_nonnegative" CHECK("extractions"."cost_usd" >= 0),
	CONSTRAINT "extractions_id_uuidv7" CHECK(length("extractions"."id") = 36 AND substr("extractions"."id", 15, 1) = '7'),
	CONSTRAINT "extractions_version_positive" CHECK("extractions"."version" >= 1),
	CONSTRAINT "extractions_updated_after_created" CHECK("extractions"."updated_at" >= "extractions"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extractions_custom_id_live` ON `extractions` (`custom_id`) WHERE "extractions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `extractions_chunk` ON `extractions` (`chunk_id`);--> statement-breakpoint
CREATE INDEX `extractions_source` ON `extractions` (`source_id`);--> statement-breakpoint
CREATE INDEX `extractions_run` ON `extractions` (`run_id`);--> statement-breakpoint
CREATE TABLE `generation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`path_id` text NOT NULL,
	`path_version_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`config` text NOT NULL,
	`config_hash` text NOT NULL,
	`progress` text,
	`estimate` text,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`manifest` text,
	`warnings` text DEFAULT '[]' NOT NULL,
	`error` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`device_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`path_id`) REFERENCES `paths`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`path_version_id`) REFERENCES `path_versions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "generation_runs_status" CHECK("generation_runs"."status" IN ('queued', 'extracting', 'consolidating', 'synthesizing', 'sequencing', 'persisting', 'completed', 'failed', 'cancelled', 'blocked_budget')),
	CONSTRAINT "generation_runs_config_json" CHECK(json_valid("generation_runs"."config") AND json_type("generation_runs"."config") = 'object'),
	CONSTRAINT "generation_runs_config_hash_sha256" CHECK(length("generation_runs"."config_hash") = 64),
	CONSTRAINT "generation_runs_progress_json" CHECK("generation_runs"."progress" IS NULL OR (json_valid("generation_runs"."progress") AND json_type("generation_runs"."progress") = 'object')),
	CONSTRAINT "generation_runs_estimate_json" CHECK("generation_runs"."estimate" IS NULL OR (json_valid("generation_runs"."estimate") AND json_type("generation_runs"."estimate") = 'object')),
	CONSTRAINT "generation_runs_manifest_json" CHECK("generation_runs"."manifest" IS NULL OR (json_valid("generation_runs"."manifest") AND json_type("generation_runs"."manifest") = 'object')),
	CONSTRAINT "generation_runs_warnings_json" CHECK(json_valid("generation_runs"."warnings") AND json_type("generation_runs"."warnings") = 'array'),
	CONSTRAINT "generation_runs_cost_nonnegative" CHECK("generation_runs"."cost_usd" >= 0),
	CONSTRAINT "generation_runs_input_tokens_nonnegative" CHECK("generation_runs"."input_tokens" >= 0),
	CONSTRAINT "generation_runs_output_tokens_nonnegative" CHECK("generation_runs"."output_tokens" >= 0),
	CONSTRAINT "generation_runs_cached_tokens_nonnegative" CHECK("generation_runs"."cached_tokens" >= 0),
	CONSTRAINT "generation_runs_id_uuidv7" CHECK(length("generation_runs"."id") = 36 AND substr("generation_runs"."id", 15, 1) = '7'),
	CONSTRAINT "generation_runs_version_positive" CHECK("generation_runs"."version" >= 1),
	CONSTRAINT "generation_runs_updated_after_created" CHECK("generation_runs"."updated_at" >= "generation_runs"."created_at")
);
--> statement-breakpoint
CREATE INDEX `generation_runs_path` ON `generation_runs` (`path_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `generation_runs_status` ON `generation_runs` (`status`,`created_at`);