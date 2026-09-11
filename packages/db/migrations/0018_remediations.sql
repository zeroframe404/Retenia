CREATE TABLE `remediations` (
	`id` text PRIMARY KEY NOT NULL,
	`path_version_id` text NOT NULL,
	`module_id` text,
	`concept_id` text NOT NULL,
	`misconception_id` text,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`refusal` text,
	`anchor_lesson_id` text,
	`lesson_id` text,
	`spec_id` text,
	`evidence` text DEFAULT '{}' NOT NULL,
	`boost` text DEFAULT '{}' NOT NULL,
	`outcome` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`device_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`path_version_id`) REFERENCES `path_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`anchor_lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "remediations_trigger" CHECK("remediations"."trigger" IN ('reinforcement_low', 'memory_lapses', 'memory_retention', 'confident_error', 'repeated_misconception', 'user_request')),
	CONSTRAINT "remediations_status" CHECK("remediations"."status" IN ('active', 'completed', 'dismissed', 'refused', 'failed')),
	CONSTRAINT "remediations_refusal" CHECK("remediations"."refusal" IS NULL OR "remediations"."refusal" IN ('duplicate_concept', 'module_active', 'weekly_limit', 'revisit_core', 'no_anchor')),
	CONSTRAINT "remediations_refusal_iff_refused" CHECK(("remediations"."status" = 'refused') = ("remediations"."refusal" IS NOT NULL)),
	CONSTRAINT "remediations_evidence_json" CHECK(json_valid("remediations"."evidence") AND json_type("remediations"."evidence") = 'object'),
	CONSTRAINT "remediations_boost_json" CHECK(json_valid("remediations"."boost") AND json_type("remediations"."boost") = 'object'),
	CONSTRAINT "remediations_outcome_json" CHECK("remediations"."outcome" IS NULL OR (json_valid("remediations"."outcome") AND json_type("remediations"."outcome") = 'object')),
	CONSTRAINT "remediations_id_uuidv7" CHECK(length("remediations"."id") = 36 AND substr("remediations"."id", 15, 1) = '7'),
	CONSTRAINT "remediations_version_positive" CHECK("remediations"."version" >= 1),
	CONSTRAINT "remediations_updated_after_created" CHECK("remediations"."updated_at" >= "remediations"."created_at")
);
--> statement-breakpoint
CREATE INDEX `remediations_version_status` ON `remediations` (`path_version_id`,`status`);--> statement-breakpoint
CREATE INDEX `remediations_concept` ON `remediations` (`concept_id`);--> statement-breakpoint
CREATE INDEX `remediations_lesson` ON `remediations` (`lesson_id`);--> statement-breakpoint
CREATE INDEX `remediations_created` ON `remediations` (`created_at`);