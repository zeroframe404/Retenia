-- 0013 — submitted Batch API jobs.
--
-- Sub-phase 7.3 (docs/spec/06-ai-providers.md §2: the Batch API is -50 % on everything, takes
-- up to 100,000 requests, "most finish in under 1 h", maximum 24 h, and is compatible with
-- caching and structured outputs).
--
-- The third table in this family, and the one that makes the other two survive a restart.
-- `ai_calls` is the cost log — one row per dispatched request, batched or not. `ai_results` is
-- the answer store, keyed by `custom_id`. This is the **job**: what was sent, to whom, what it
-- was quoted at, and where the polling had got to when the app was last closed. Without it,
-- killing the app mid-batch abandons an hour of work that has already been bought: the
-- provider finishes the job and charges for it, and nothing here ever collects the answers.
--
-- What is deliberately NOT a column is the requests themselves. Forty expanded lessons are
-- megabytes of prompt, and storing them would put the largest rows in this database behind the
-- one feature whose entire purpose is to be cheap. Everything needed to poll, reconcile and
-- report is here; retrying an individual failed id needs the request, which only the process
-- that submitted it holds — and a caller's own re-run covers that case for free, because every
-- id that did succeed is answered from `ai_results` without a provider call.
--
-- `provider_batch_id` is NULL exactly while `status` is `submitting`: the row is written
-- before the provider is called, so a crash in that window is visible rather than silent, and
-- recovery retires it rather than inventing an id to poll.
--
-- `next_poll_at` and `attempts` are this table's `run_after` and `attempts` — the same
-- durable-backoff shape the `jobs` table uses, for a queue whose worker lives at the provider.
--
-- `src/migrator.ts` runs this file inside one transaction and verifies its hash on every
-- start; once applied it is never edited (docs/spec/00-conventions.md).

CREATE TABLE `ai_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`role` text NOT NULL,
	`purpose` text NOT NULL,
	`stage` text NOT NULL,
	`status` text DEFAULT 'submitting' NOT NULL,
	`provider_batch_id` text,
	`request_count` integer DEFAULT 0 NOT NULL,
	`succeeded_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`cost_estimate_usd` real DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`submitted_at` integer,
	`next_poll_at` integer,
	`completed_at` integer,
	`prompt_version` text,
	`schema_version` text,
	`error` text,
	`meta` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`device_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ai_batches_status" CHECK("ai_batches"."status" IN ('submitting', 'submitted', 'in_progress', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "ai_batches_request_count_nonnegative" CHECK("ai_batches"."request_count" >= 0),
	CONSTRAINT "ai_batches_succeeded_nonnegative" CHECK("ai_batches"."succeeded_count" >= 0),
	CONSTRAINT "ai_batches_failed_nonnegative" CHECK("ai_batches"."failed_count" >= 0),
	CONSTRAINT "ai_batches_cost_estimate_nonnegative" CHECK("ai_batches"."cost_estimate_usd" >= 0),
	CONSTRAINT "ai_batches_cost_nonnegative" CHECK("ai_batches"."cost_usd" >= 0),
	CONSTRAINT "ai_batches_attempts_nonnegative" CHECK("ai_batches"."attempts" >= 0),
	CONSTRAINT "ai_batches_meta_json" CHECK("ai_batches"."meta" IS NULL OR (json_valid("ai_batches"."meta") AND json_type("ai_batches"."meta") = 'object')),
	CONSTRAINT "ai_batches_id_uuidv7" CHECK(length("ai_batches"."id") = 36 AND substr("ai_batches"."id", 15, 1) = '7'),
	CONSTRAINT "ai_batches_version_positive" CHECK("ai_batches"."version" >= 1),
	CONSTRAINT "ai_batches_updated_after_created" CHECK("ai_batches"."updated_at" >= "ai_batches"."created_at")
);
--> statement-breakpoint
CREATE INDEX `ai_batches_active` ON `ai_batches` (`status`,`next_poll_at`);--> statement-breakpoint
CREATE INDEX `ai_batches_created` ON `ai_batches` (`created_at`);--> statement-breakpoint
CREATE INDEX `ai_batches_provider_batch_id` ON `ai_batches` (`provider_batch_id`);
