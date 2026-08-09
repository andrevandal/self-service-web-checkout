CREATE TABLE `addon_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`min_selections` integer DEFAULT 0 NOT NULL,
	`max_selections` integer,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `addon_groups_product_slug` ON `addon_groups` (`product_id`,`slug`);--> statement-breakpoint
CREATE TABLE `addons` (
	`id` text PRIMARY KEY NOT NULL,
	`addon_group_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`price_delta_cents` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`addon_group_id`) REFERENCES `addon_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `addons_group_slug` ON `addons` (`addon_group_id`,`slug`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`base_price_cents` integer NOT NULL,
	`image_url` text,
	`is_available` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_unique` ON `products` (`slug`);--> statement-breakpoint
CREATE TABLE `variant_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`min_selections` integer DEFAULT 1 NOT NULL,
	`max_selections` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variant_groups_product_slug` ON `variant_groups` (`product_id`,`slug`);--> statement-breakpoint
CREATE TABLE `variant_options` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_group_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`price_delta_cents` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`variant_group_id`) REFERENCES `variant_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variant_options_group_slug` ON `variant_options` (`variant_group_id`,`slug`);