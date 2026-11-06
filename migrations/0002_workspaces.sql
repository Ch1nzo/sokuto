CREATE TABLE `workspaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
DROP INDEX `contacts_channel_user`;--> statement-breakpoint
ALTER TABLE `contacts` ADD `workspace_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `contacts_workspace` ON `contacts` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_channel_user` ON `contacts` (`workspace_id`,`channel`,`channel_user_id`);--> statement-breakpoint
ALTER TABLE `broadcasts` ADD `workspace_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `workspace_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `flows` ADD `workspace_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `flows_workspace` ON `flows` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `notifications` ADD `workspace_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `segments` ADD `workspace_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `snippets` ADD `workspace_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
INSERT INTO `workspaces` (`id`, `name`, `created_at`) VALUES (1, 'Default', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));--> statement-breakpoint
UPDATE `settings` SET `key` = 'ws:1:' || `key` WHERE `key` NOT LIKE 'ws:%';
