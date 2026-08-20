CREATE INDEX `addons_is_active_idx` ON `addons` (`is_active`);--> statement-breakpoint
CREATE INDEX `categories_is_active_idx` ON `categories` (`is_active`);--> statement-breakpoint
CREATE INDEX `order_item_addons_order_item_id_idx` ON `order_item_addons` (`order_item_id`);--> statement-breakpoint
CREATE INDEX `order_item_addons_addon_id_idx` ON `order_item_addons` (`addon_id`);--> statement-breakpoint
CREATE INDEX `order_item_variants_order_item_id_idx` ON `order_item_variants` (`order_item_id`);--> statement-breakpoint
CREATE INDEX `order_item_variants_variant_option_id_idx` ON `order_item_variants` (`variant_option_id`);--> statement-breakpoint
CREATE INDEX `order_items_order_id_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_items_product_id_idx` ON `order_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `orders_kiosk_id_idx` ON `orders` (`kiosk_id`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `payment_attempts_order_id_idx` ON `payment_attempts` (`order_id`);--> statement-breakpoint
CREATE INDEX `payment_attempts_status_idx` ON `payment_attempts` (`status`);--> statement-breakpoint
CREATE INDEX `products_category_id_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `products_is_available_idx` ON `products` (`is_available`);