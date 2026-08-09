CREATE TABLE `kiosks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kiosks_prefix_unique` ON `kiosks` (`prefix`);