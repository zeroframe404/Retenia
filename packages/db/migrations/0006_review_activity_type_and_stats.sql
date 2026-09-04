-- 0006 — `review_logs.activity_type`, the `diagnostic` context, and `activity_stats`.
--
-- Two things the exercise → rating mapping of docs/spec/02-memory-system.md §10 needs:
--
--   * `activity_type` on every review, so §17 risk 3's "measure true retention per type
--     and adjust" is a GROUP BY over the history rather than a join that dies with the
--     attempt rows. Existing rows predate any activity and are backfilled as NULL.
--   * `context = 'diagnostic'`, for the prior-knowledge test that seeds the memory of
--     modules the learner already knows (sub-phase 8.5). Widening a CHECK means rebuilding
--     the table in SQLite, which is what the __new_review_logs dance below is.
--
-- ... and `activity_stats`, the materialized rolling median that decides what "fast" and
-- "slow" mean for this user (§10: "time < personal median × 0.6").
--
-- `src/migrator.ts` runs this file inside one transaction, so `PRAGMA foreign_keys` would
-- be silently ignored; `defer_foreign_keys` is the form that works there and it resets at
-- commit on its own.

CREATE TABLE `activity_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_type` text NOT NULL,
	`reviews` integer DEFAULT 0 NOT NULL,
	`median_ms` integer,
	`sample` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`device_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "activity_stats_reviews_nonnegative" CHECK("activity_stats"."reviews" >= 0),
	CONSTRAINT "activity_stats_median_positive" CHECK("activity_stats"."median_ms" IS NULL OR "activity_stats"."median_ms" >= 1),
	CONSTRAINT "activity_stats_sample_json" CHECK(json_valid("activity_stats"."sample") AND json_type("activity_stats"."sample") = 'array'),
	CONSTRAINT "activity_stats_id_uuidv7" CHECK(length("activity_stats"."id") = 36 AND substr("activity_stats"."id", 15, 1) = '7'),
	CONSTRAINT "activity_stats_version_positive" CHECK("activity_stats"."version" >= 1),
	CONSTRAINT "activity_stats_updated_after_created" CHECK("activity_stats"."updated_at" >= "activity_stats"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_stats_activity_type_unique` ON `activity_stats` (`activity_type`);--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_review_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`rating` integer NOT NULL,
	`state` integer NOT NULL,
	`due` integer NOT NULL,
	`stability` real NOT NULL,
	`difficulty` real NOT NULL,
	`elapsed_days` integer NOT NULL,
	`scheduled_days` integer NOT NULL,
	`learning_steps` integer NOT NULL,
	`review` integer NOT NULL,
	`duration_ms` integer,
	`context` text NOT NULL,
	`exercise_score` real,
	`device` text,
	`attempt_id` text,
	`activity_type` text,
	`algorithm_version` text DEFAULT 'fsrs6' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`device_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_logs_rating" CHECK("__new_review_logs"."rating" IN (0, 1, 2, 3, 4)),
	CONSTRAINT "review_logs_state" CHECK("__new_review_logs"."state" IN (0, 1, 2, 3)),
	CONSTRAINT "review_logs_context" CHECK("__new_review_logs"."context" IN ('daily', 'lesson', 'reinforcement', 'exam_sim', 'cram', 'manual_postpone', 'diagnostic', 'import')),
	CONSTRAINT "review_logs_stability_nonnegative" CHECK("__new_review_logs"."stability" >= 0),
	CONSTRAINT "review_logs_difficulty_range" CHECK("__new_review_logs"."difficulty" >= 0 AND "__new_review_logs"."difficulty" <= 10),
	CONSTRAINT "review_logs_scheduled_days_nonnegative" CHECK("__new_review_logs"."scheduled_days" >= 0),
	CONSTRAINT "review_logs_learning_steps_nonnegative" CHECK("__new_review_logs"."learning_steps" >= 0),
	CONSTRAINT "review_logs_duration_nonnegative" CHECK("__new_review_logs"."duration_ms" IS NULL OR "__new_review_logs"."duration_ms" >= 0),
	CONSTRAINT "review_logs_exercise_score_range" CHECK("__new_review_logs"."exercise_score" IS NULL OR ("__new_review_logs"."exercise_score" >= 0 AND "__new_review_logs"."exercise_score" <= 1)),
	CONSTRAINT "review_logs_append_only" CHECK("__new_review_logs"."updated_at" = "__new_review_logs"."created_at" AND "__new_review_logs"."version" = 1),
	CONSTRAINT "review_logs_id_uuidv7" CHECK(length("__new_review_logs"."id") = 36 AND substr("__new_review_logs"."id", 15, 1) = '7'),
	CONSTRAINT "review_logs_version_positive" CHECK("__new_review_logs"."version" >= 1),
	CONSTRAINT "review_logs_updated_after_created" CHECK("__new_review_logs"."updated_at" >= "__new_review_logs"."created_at")
);
--> statement-breakpoint
INSERT INTO `__new_review_logs`("id", "card_id", "rating", "state", "due", "stability", "difficulty", "elapsed_days", "scheduled_days", "learning_steps", "review", "duration_ms", "context", "exercise_score", "device", "attempt_id", "activity_type", "algorithm_version", "created_at", "updated_at", "deleted_at", "device_id", "version") SELECT "id", "card_id", "rating", "state", "due", "stability", "difficulty", "elapsed_days", "scheduled_days", "learning_steps", "review", "duration_ms", "context", "exercise_score", "device", "attempt_id", NULL, "algorithm_version", "created_at", "updated_at", "deleted_at", "device_id", "version" FROM `review_logs`;--> statement-breakpoint
DROP TABLE `review_logs`;--> statement-breakpoint
ALTER TABLE `__new_review_logs` RENAME TO `review_logs`;--> statement-breakpoint
CREATE INDEX `rl_card` ON `review_logs` (`card_id`,`review`);--> statement-breakpoint
CREATE INDEX `rl_review` ON `review_logs` (`review`);--> statement-breakpoint
CREATE INDEX `rl_attempt` ON `review_logs` (`attempt_id`);--> statement-breakpoint
CREATE INDEX `rl_activity_type` ON `review_logs` (`activity_type`,`review`);