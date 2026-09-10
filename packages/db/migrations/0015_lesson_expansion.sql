-- 0015 — stage 7: the `expanding` run status and `lessons.expansion`.
--
-- Sub-phase 8.3 expands every frozen lesson: P3 writes the theory, P4 the practice block,
-- P5 the flashcards. Two schema changes carry it.
--
--   * `generation_runs.status = 'expanding'`. Expansion is its own run row — the draft's
--     run finishes at `persisting`, and the user freezes the path later — so it reuses the
--     ledger the extraction stage already has: `progress.batch_ids` for the batches in
--     flight, the four cost columns, `manifest`, and `listActive()` for the resume sweep.
--   * `lessons.expansion`, `{ attempt, p4_attempt, phases, unmet, warnings }`. Everything
--     else about a lesson's progress is derived — `theory` says whether P3 landed, an
--     `activities` row that P4 did, a `knowledge_items` row that P5 did — so this column
--     carries only what cannot be: the attempt counters "Regenerar" and "Más ejemplos"
--     increment, and the practice rules the generated pool could not satisfy.
--
-- Both widen a CHECK, which in SQLite means rebuilding the table: hence the __new_ dance.
-- `src/migrator.ts` runs this file inside one transaction, so `PRAGMA foreign_keys` would
-- be silently ignored; `defer_foreign_keys` is the form that works there and it resets at
-- commit on its own.

PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_generation_runs` (
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
	CONSTRAINT "generation_runs_status" CHECK("__new_generation_runs"."status" IN ('queued', 'extracting', 'consolidating', 'synthesizing', 'sequencing', 'persisting', 'expanding', 'completed', 'failed', 'cancelled', 'blocked_budget')),
	CONSTRAINT "generation_runs_config_json" CHECK(json_valid("__new_generation_runs"."config") AND json_type("__new_generation_runs"."config") = 'object'),
	CONSTRAINT "generation_runs_config_hash_sha256" CHECK(length("__new_generation_runs"."config_hash") = 64),
	CONSTRAINT "generation_runs_progress_json" CHECK("__new_generation_runs"."progress" IS NULL OR (json_valid("__new_generation_runs"."progress") AND json_type("__new_generation_runs"."progress") = 'object')),
	CONSTRAINT "generation_runs_estimate_json" CHECK("__new_generation_runs"."estimate" IS NULL OR (json_valid("__new_generation_runs"."estimate") AND json_type("__new_generation_runs"."estimate") = 'object')),
	CONSTRAINT "generation_runs_manifest_json" CHECK("__new_generation_runs"."manifest" IS NULL OR (json_valid("__new_generation_runs"."manifest") AND json_type("__new_generation_runs"."manifest") = 'object')),
	CONSTRAINT "generation_runs_warnings_json" CHECK(json_valid("__new_generation_runs"."warnings") AND json_type("__new_generation_runs"."warnings") = 'array'),
	CONSTRAINT "generation_runs_cost_nonnegative" CHECK("__new_generation_runs"."cost_usd" >= 0),
	CONSTRAINT "generation_runs_input_tokens_nonnegative" CHECK("__new_generation_runs"."input_tokens" >= 0),
	CONSTRAINT "generation_runs_output_tokens_nonnegative" CHECK("__new_generation_runs"."output_tokens" >= 0),
	CONSTRAINT "generation_runs_cached_tokens_nonnegative" CHECK("__new_generation_runs"."cached_tokens" >= 0),
	CONSTRAINT "generation_runs_id_uuidv7" CHECK(length("__new_generation_runs"."id") = 36 AND substr("__new_generation_runs"."id", 15, 1) = '7'),
	CONSTRAINT "generation_runs_version_positive" CHECK("__new_generation_runs"."version" >= 1),
	CONSTRAINT "generation_runs_updated_after_created" CHECK("__new_generation_runs"."updated_at" >= "__new_generation_runs"."created_at")
);
--> statement-breakpoint
INSERT INTO `__new_generation_runs`("id", "path_id", "path_version_id", "status", "config", "config_hash", "progress", "estimate", "cost_usd", "input_tokens", "output_tokens", "cached_tokens", "manifest", "warnings", "error", "started_at", "finished_at", "created_at", "updated_at", "deleted_at", "device_id", "version") SELECT "id", "path_id", "path_version_id", "status", "config", "config_hash", "progress", "estimate", "cost_usd", "input_tokens", "output_tokens", "cached_tokens", "manifest", "warnings", "error", "started_at", "finished_at", "created_at", "updated_at", "deleted_at", "device_id", "version" FROM `generation_runs`;--> statement-breakpoint
DROP TABLE `generation_runs`;--> statement-breakpoint
ALTER TABLE `__new_generation_runs` RENAME TO `generation_runs`;--> statement-breakpoint
CREATE INDEX `generation_runs_path` ON `generation_runs` (`path_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `generation_runs_status` ON `generation_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`spec_id` text NOT NULL,
	`kind` text DEFAULT 'core' NOT NULL,
	`parent_lesson_id` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`objectives` text DEFAULT '[]' NOT NULL,
	`concept_ids` text DEFAULT '[]' NOT NULL,
	`prerequisite_lesson_ids` text DEFAULT '[]' NOT NULL,
	`estimated_minutes` integer,
	`theory` text,
	`citations` text DEFAULT '[]' NOT NULL,
	`qa` text,
	`expansion` text,
	`remediation` text,
	`unlock_rule` text,
	`xp_reward` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`device_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lessons_kind" CHECK("__new_lessons"."kind" IN ('core', 'remediation', 'reinforcement', 'checkpoint')),
	CONSTRAINT "lessons_status" CHECK("__new_lessons"."status" IN ('pending', 'generating', 'ready', 'failed')),
	CONSTRAINT "lessons_ordinal_nonnegative" CHECK("__new_lessons"."ordinal" >= 0),
	CONSTRAINT "lessons_estimated_minutes_positive" CHECK("__new_lessons"."estimated_minutes" IS NULL OR "__new_lessons"."estimated_minutes" >= 0),
	CONSTRAINT "lessons_xp_nonnegative" CHECK("__new_lessons"."xp_reward" >= 0),
	CONSTRAINT "lessons_objectives_json" CHECK(json_valid("__new_lessons"."objectives") AND json_type("__new_lessons"."objectives") = 'array'),
	CONSTRAINT "lessons_concept_ids_json" CHECK(json_valid("__new_lessons"."concept_ids") AND json_type("__new_lessons"."concept_ids") = 'array'),
	CONSTRAINT "lessons_prerequisites_json" CHECK(json_valid("__new_lessons"."prerequisite_lesson_ids") AND json_type("__new_lessons"."prerequisite_lesson_ids") = 'array'),
	CONSTRAINT "lessons_theory_json" CHECK("__new_lessons"."theory" IS NULL OR (json_valid("__new_lessons"."theory") AND json_type("__new_lessons"."theory") = 'object')),
	CONSTRAINT "lessons_citations_json" CHECK(json_valid("__new_lessons"."citations") AND json_type("__new_lessons"."citations") = 'array'),
	CONSTRAINT "lessons_qa_json" CHECK("__new_lessons"."qa" IS NULL OR (json_valid("__new_lessons"."qa") AND json_type("__new_lessons"."qa") = 'object')),
	CONSTRAINT "lessons_expansion_json" CHECK("__new_lessons"."expansion" IS NULL OR (json_valid("__new_lessons"."expansion") AND json_type("__new_lessons"."expansion") = 'object')),
	CONSTRAINT "lessons_remediation_json" CHECK("__new_lessons"."remediation" IS NULL OR (json_valid("__new_lessons"."remediation") AND json_type("__new_lessons"."remediation") = 'object')),
	CONSTRAINT "lessons_unlock_rule_json" CHECK("__new_lessons"."unlock_rule" IS NULL OR (json_valid("__new_lessons"."unlock_rule") AND json_type("__new_lessons"."unlock_rule") = 'object')),
	CONSTRAINT "lessons_id_uuidv7" CHECK(length("__new_lessons"."id") = 36 AND substr("__new_lessons"."id", 15, 1) = '7'),
	CONSTRAINT "lessons_version_positive" CHECK("__new_lessons"."version" >= 1),
	CONSTRAINT "lessons_updated_after_created" CHECK("__new_lessons"."updated_at" >= "__new_lessons"."created_at")
);
--> statement-breakpoint
INSERT INTO `__new_lessons`("id", "module_id", "ordinal", "spec_id", "kind", "parent_lesson_id", "title", "status", "objectives", "concept_ids", "prerequisite_lesson_ids", "estimated_minutes", "theory", "citations", "qa", "expansion", "remediation", "unlock_rule", "xp_reward", "completed_at", "created_at", "updated_at", "deleted_at", "device_id", "version") SELECT "id", "module_id", "ordinal", "spec_id", "kind", "parent_lesson_id", "title", "status", "objectives", "concept_ids", "prerequisite_lesson_ids", "estimated_minutes", "theory", "citations", "qa", NULL, "remediation", "unlock_rule", "xp_reward", "completed_at", "created_at", "updated_at", "deleted_at", "device_id", "version" FROM `lessons`;--> statement-breakpoint
DROP TABLE `lessons`;--> statement-breakpoint
ALTER TABLE `__new_lessons` RENAME TO `lessons`;--> statement-breakpoint
CREATE INDEX `lessons_module_ordinal` ON `lessons` (`module_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `lessons_parent` ON `lessons` (`parent_lesson_id`);--> statement-breakpoint
CREATE INDEX `lessons_status` ON `lessons` (`status`);