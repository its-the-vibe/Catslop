-- Migration number: 0001 	 2026-09-27T10:26:44.560Z

CREATE TABLE IF NOT EXISTS cat_pics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  model TEXT,
  prompt TEXT,
  hidden BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_cat_pics_created_at ON cat_pics(created_at);
CREATE INDEX IF NOT EXISTS idx_cat_pics_gallery_visible_latest ON cat_pics(hidden, created_at DESC, id DESC, r2_key);
