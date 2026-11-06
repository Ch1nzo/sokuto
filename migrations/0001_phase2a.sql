CREATE TABLE `segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`rules` text DEFAULT '[]' NOT NULL,
	`mode` text DEFAULT 'all' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sequence_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer NOT NULL,
	`flow_id` integer NOT NULL,
	`step_id` text,
	`resume_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sequence_subscriptions_unique` ON `sequence_subscriptions` (`contact_id`,`flow_id`);--> statement-breakpoint
CREATE INDEX `sequence_subscriptions_resume` ON `sequence_subscriptions` (`resume_at`);--> statement-breakpoint
CREATE TABLE `snippets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `broadcasts` ADD `segment_id` integer;--> statement-breakpoint
ALTER TABLE `broadcasts` ADD `buttons` text;--> statement-breakpoint
ALTER TABLE `broadcasts` ADD `message_tag` text;--> statement-breakpoint
ALTER TABLE `broadcasts` ADD `clicked` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `status` text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `flows` ADD `kind` text DEFAULT 'flow' NOT NULL;