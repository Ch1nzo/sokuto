CREATE TABLE `documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`url` text,
	`content` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`error` text,
	`fetched_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `documents_workspace` ON `documents` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `faqs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer DEFAULT 1 NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`document_id` integer,
	`contact_id` integer,
	`uses` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `faqs_workspace_status` ON `faqs` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`price` integer,
	`currency` text DEFAULT 'JPY' NOT NULL,
	`url` text,
	`image_url` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`sku` text,
	`in_stock` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `products_workspace` ON `products` (`workspace_id`);