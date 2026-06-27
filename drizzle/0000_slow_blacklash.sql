CREATE TABLE `ledger_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`account` text,
	`records` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL
);
