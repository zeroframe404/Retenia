-- 0017 — the prior-knowledge diagnostic (sub-phase 8.5).
--
-- `diagnostic_sessions`: one row per run of the adaptive quiz of `docs/spec/04-path-generation.md`
-- §10 over a path version — the self-assessment, the answer log the engine replays to resume,
-- the item currently served, the result, and what that result wrote (lessons marked complete,
-- cards seeded) so it can be undone and verified later. `diagnostic_sessions_active` is the
-- partial index `findActive` reads, the same shape as `review_sessions_active`.
--
-- `item_bank.authoring`: what P9 said about each item (`cell_key`, `kind`, `form`,
-- `difficulty`, `stem`, `concept_ids`, `misconception_by_option`); `cell_key` is the item
-- build's idempotency key.
--
-- Hand-edited from drizzle-kit's output, which rebuilt `item_bank` to give the new column its
-- CHECK. That rebuild cannot ship. Its INSERT … SELECT read `authoring` from the old table, which
-- has no such column; and, fixed, it still fails on any real database: `exam_items.item_bank_id`
-- references `item_bank`, the rebuild's DROP TABLE orphans every exam item, and inside the
-- migrator's transaction — where `PRAGMA foreign_keys=OFF` is ignored — `defer_foreign_keys`
-- only postpones that violation to COMMIT, which then aborts the migration. SQLite's
-- ADD COLUMN accepts a CHECK (and, since 3.37, tests it against the rows already there), touches
-- no other table and drops no index, so that is what this file does. The one visible difference
-- is that `authoring` sits after `version` in `PRAGMA table_info`; nothing reads by position.

CREATE TABLE `diagnostic_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`path_version_id` text NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`entry` text NOT NULL,
	`self_assessment` text DEFAULT '{}' NOT NULL,
	`answers` text DEFAULT '[]' NOT NULL,
	`pending` text,
	`result` text,
	`applied` text DEFAULT '{}' NOT NULL,
	`stop_reason` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`device_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`path_version_id`) REFERENCES `path_versions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "diagnostic_sessions_status" CHECK("diagnostic_sessions"."status" IN ('in_progress', 'completed')),
	CONSTRAINT "diagnostic_sessions_entry" CHECK("diagnostic_sessions"."entry" IN ('scratch', 'partial', 'preview')),
	CONSTRAINT "diagnostic_sessions_stop_reason" CHECK("diagnostic_sessions"."stop_reason" IS NULL OR "diagnostic_sessions"."stop_reason" IN ('from_scratch', 'all_classified', 'no_items', 'max_items', 'time_limit', 'abandoned')),
	CONSTRAINT "diagnostic_sessions_finished_after_started" CHECK("diagnostic_sessions"."finished_at" IS NULL OR "diagnostic_sessions"."finished_at" >= "diagnostic_sessions"."started_at"),
	CONSTRAINT "diagnostic_sessions_self_assessment_json" CHECK(json_valid("diagnostic_sessions"."self_assessment") AND json_type("diagnostic_sessions"."self_assessment") = 'object'),
	CONSTRAINT "diagnostic_sessions_answers_json" CHECK(json_valid("diagnostic_sessions"."answers") AND json_type("diagnostic_sessions"."answers") = 'array'),
	CONSTRAINT "diagnostic_sessions_pending_json" CHECK("diagnostic_sessions"."pending" IS NULL OR (json_valid("diagnostic_sessions"."pending") AND json_type("diagnostic_sessions"."pending") = 'object')),
	CONSTRAINT "diagnostic_sessions_result_json" CHECK("diagnostic_sessions"."result" IS NULL OR (json_valid("diagnostic_sessions"."result") AND json_type("diagnostic_sessions"."result") = 'object')),
	CONSTRAINT "diagnostic_sessions_applied_json" CHECK(json_valid("diagnostic_sessions"."applied") AND json_type("diagnostic_sessions"."applied") = 'object'),
	CONSTRAINT "diagnostic_sessions_id_uuidv7" CHECK(length("diagnostic_sessions"."id") = 36 AND substr("diagnostic_sessions"."id", 15, 1) = '7'),
	CONSTRAINT "diagnostic_sessions_version_positive" CHECK("diagnostic_sessions"."version" >= 1),
	CONSTRAINT "diagnostic_sessions_updated_after_created" CHECK("diagnostic_sessions"."updated_at" >= "diagnostic_sessions"."created_at")
);
--> statement-breakpoint
CREATE INDEX `diagnostic_sessions_version` ON `diagnostic_sessions` (`path_version_id`);--> statement-breakpoint
CREATE INDEX `diagnostic_sessions_active` ON `diagnostic_sessions` (`path_version_id`) WHERE "diagnostic_sessions"."status" = 'in_progress' AND "diagnostic_sessions"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE `item_bank` ADD `authoring` text DEFAULT '{}' NOT NULL CONSTRAINT "item_bank_authoring_json" CHECK(json_valid("authoring") AND json_type("authoring") = 'object');
