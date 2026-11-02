CREATE TABLE `broadcast_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`broadcast_id` integer NOT NULL,
	`contact_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `broadcast_jobs_status` ON `broadcast_jobs` (`broadcast_id`,`status`);--> statement-breakpoint
CREATE TABLE `broadcasts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`channel` text DEFAULT 'any' NOT NULL,
	`tag` text,
	`text` text NOT NULL,
	`image_url` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`scheduled_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contact_tags` (
	`contact_id` integer NOT NULL,
	`tag` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_tags_unique` ON `contact_tags` (`contact_id`,`tag`);--> statement-breakpoint
CREATE INDEX `contact_tags_tag` ON `contact_tags` (`tag`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel` text NOT NULL,
	`channel_user_id` text NOT NULL,
	`display_name` text,
	`avatar_url` text,
	`username` text,
	`fields` text DEFAULT '{}' NOT NULL,
	`bot_paused` integer DEFAULT 0 NOT NULL,
	`bot_paused_until` text,
	`last_inbound_at` text,
	`last_outbound_at` text,
	`unread` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_channel_user` ON `contacts` (`channel`,`channel_user_id`);--> statement-breakpoint
CREATE INDEX `contacts_last_inbound` ON `contacts` (`last_inbound_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`channel` text,
	`flow_id` integer,
	`step_id` text,
	`contact_id` integer,
	`meta` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_created` ON `events` (`created_at`);--> statement-breakpoint
CREATE INDEX `events_flow` ON `events` (`flow_id`,`type`);--> statement-breakpoint
CREATE TABLE `flows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`channel` text DEFAULT 'any' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`definition` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer NOT NULL,
	`direction` text NOT NULL,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`text` text,
	`payload` text,
	`flow_id` integer,
	`step_id` text,
	`error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_contact` ON `messages` (`contact_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer,
	`text` text NOT NULL,
	`read` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_read` ON `notifications` (`read`,`created_at`);--> statement-breakpoint
CREATE TABLE `processed_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`contact_id` integer PRIMARY KEY NOT NULL,
	`flow_id` integer NOT NULL,
	`step_id` text,
	`waiting` text,
	`field` text,
	`resume_at` text,
	`context` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_resume` ON `sessions` (`resume_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
