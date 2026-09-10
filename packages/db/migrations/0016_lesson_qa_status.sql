-- 0016 — the `qa` lesson status.
--
-- `lessons.status` gains a fifth value between `generating` and `ready`: the lesson is
-- written but has not cleared the QA gates of `docs/spec/04-path-generation.md` §5. Stage 7
-- never sets it — sub-phase 8.4 is what runs those gates — but it is one of the five states
-- §13 step 5 asks the path map to show, and a status the panel cannot render is a status 8.4
-- would have to add a migration, a contract change and two translations for before it could
-- write one row.
--
-- Widening a CHECK means rebuilding the table, hence the __new_ dance. `src/migrator.ts` runs
-- this file inside one transaction, where `PRAGMA foreign_keys` is silently ignored;
-- `defer_foreign_keys` is the form that works there and it resets at commit on its own.

PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
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
	CONSTRAINT "lessons_status" CHECK("__new_lessons"."status" IN ('pending', 'generating', 'qa', 'ready', 'failed')),
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
INSERT INTO `__new_lessons`("id", "module_id", "ordinal", "spec_id", "kind", "parent_lesson_id", "title", "status", "objectives", "concept_ids", "prerequisite_lesson_ids", "estimated_minutes", "theory", "citations", "qa", "expansion", "remediation", "unlock_rule", "xp_reward", "completed_at", "created_at", "updated_at", "deleted_at", "device_id", "version") SELECT "id", "module_id", "ordinal", "spec_id", "kind", "parent_lesson_id", "title", "status", "objectives", "concept_ids", "prerequisite_lesson_ids", "estimated_minutes", "theory", "citations", "qa", "expansion", "remediation", "unlock_rule", "xp_reward", "completed_at", "created_at", "updated_at", "deleted_at", "device_id", "version" FROM `lessons`;--> statement-breakpoint
DROP TABLE `lessons`;--> statement-breakpoint
ALTER TABLE `__new_lessons` RENAME TO `lessons`;--> statement-breakpoint
CREATE INDEX `lessons_module_ordinal` ON `lessons` (`module_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `lessons_parent` ON `lessons` (`parent_lesson_id`);--> statement-breakpoint
CREATE INDEX `lessons_status` ON `lessons` (`status`);