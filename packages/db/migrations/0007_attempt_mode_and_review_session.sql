ALTER TABLE `attempts` ADD `mode` text DEFAULT 'study' NOT NULL;--> statement-breakpoint
ALTER TABLE `attempts` ADD `review_session_id` text REFERENCES review_sessions(id);--> statement-breakpoint
CREATE INDEX `attempts_review_session` ON `attempts` (`review_session_id`);