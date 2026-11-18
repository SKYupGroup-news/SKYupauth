-- Moderation and audience search run ILIKE '%term%', which no B-tree can serve.
-- Trigram GIN indexes turn those sequential scans into index scans.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS comments_body_trgm_idx
  ON comments USING gin (body gin_trgm_ops);

CREATE INDEX IF NOT EXISTS comments_article_title_trgm_idx
  ON comments USING gin ("articleTitle" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS users_display_name_trgm_idx
  ON users USING gin ("displayName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS users_email_trgm_idx
  ON users USING gin (email gin_trgm_ops);

-- Thread paging reads top-level comments newest-first; this serves it directly
-- instead of sorting the whole article's comments every time.
CREATE INDEX IF NOT EXISTS comments_article_toplevel_idx
  ON comments ("articleId", "createdAt" DESC)
  WHERE "parentId" IS NULL;

-- Replies under one parent, oldest-first, the way a thread reads.
CREATE INDEX IF NOT EXISTS comments_parent_created_idx
  ON comments ("parentId", "createdAt" ASC)
  WHERE "parentId" IS NOT NULL;
