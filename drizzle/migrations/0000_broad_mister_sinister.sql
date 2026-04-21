CREATE TABLE `resume_i18n_content` (
	`lang_code` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now'))
);
