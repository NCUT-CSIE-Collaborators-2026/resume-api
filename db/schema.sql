CREATE TABLE IF NOT EXISTS resume_i18n_content (
  lang_code TEXT PRIMARY KEY,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_resume_i18n_updated_at
  ON resume_i18n_content (updated_at);
