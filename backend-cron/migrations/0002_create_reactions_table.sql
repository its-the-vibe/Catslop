-- Migration number: 0002 	 2026-09-30T23:34:33.183Z
CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cat_pic_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(cat_pic_id) REFERENCES cat_pics(id) ON DELETE CASCADE,
    -- Ensure a user can only react with a specific emoji once per image
    UNIQUE(cat_pic_id, user_id, emoji)
);

-- Index for quickly fetching all reactions for a specific image
CREATE INDEX IF NOT EXISTS idx_reactions_cat_pics 
ON reactions(cat_pic_id);

-- Index for fetching a specific user's reaction history
CREATE INDEX IF NOT EXISTS idx_reactions_user 
ON reactions(user_id);