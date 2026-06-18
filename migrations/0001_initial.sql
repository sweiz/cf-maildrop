-- cf-maildrop schema. Apply with:
--   npx wrangler d1 migrations apply cf-maildrop --local    (for `wrangler dev`)
--   npx wrangler d1 migrations apply cf-maildrop --remote   (for the deployed Worker)

CREATE TABLE IF NOT EXISTS messages (
  project     TEXT    NOT NULL,        -- bucket (the project name)
  id          TEXT    NOT NULL,        -- message id (<padded epoch ms>-<rand8>)
  received_at TEXT    NOT NULL,        -- ISO timestamp; sorts chronologically
  expires_at  INTEGER NOT NULL,        -- epoch ms; pruned by cron, filtered on read
  meta        TEXT    NOT NULL,        -- JSON MessageMeta (list view)
  body        TEXT    NOT NULL,        -- JSON body (text/html/headers/attachmentList)
  PRIMARY KEY (project, id)
);

-- Critical: lets list read only the rows it returns (no full-table scan = cheap row reads).
CREATE INDEX IF NOT EXISTS idx_messages_list ON messages (project, received_at DESC);

-- Lets the hourly cleanup find expired rows without scanning the table.
CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages (expires_at);
