CREATE TABLE `kiosk_order_counters` (
	`kiosk_id` text NOT NULL,
	`service_date` text NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`kiosk_id`, `service_date`),
	FOREIGN KEY (`kiosk_id`) REFERENCES `kiosks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `order_item_addons` (
	`id` text PRIMARY KEY NOT NULL,
	`order_item_id` text NOT NULL,
	`addon_id` text NOT NULL,
	`addon_name` text NOT NULL,
	`price_delta_cents` integer NOT NULL,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`addon_id`) REFERENCES `addons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `order_item_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`order_item_id` text NOT NULL,
	`variant_option_id` text NOT NULL,
	`option_name` text NOT NULL,
	`price_delta_cents` integer NOT NULL,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_option_id`) REFERENCES `variant_options`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`product_name` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`kiosk_id` text NOT NULL,
	`order_number` text,
	`status` text NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`total_amount_cents` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`paid_at` integer,
	FOREIGN KEY (`kiosk_id`) REFERENCES `kiosks`(`id`) ON UPDATE no action ON DELETE no action
);
