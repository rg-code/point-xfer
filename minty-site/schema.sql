-- Every passphrase entered on minty.milesmaximizer.com, right or wrong.
CREATE TABLE IF NOT EXISTS entries (
    id         INTEGER PRIMARY KEY,
    passphrase TEXT    NOT NULL,
    matched    INTEGER NOT NULL,            -- 1 = let in
    country    TEXT,                        -- Cloudflare's guess from the visitor's IP
    visitor    TEXT,                        -- a hash of the IP, only for the per-minute limit; the IP isn't stored
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS entries_visitor ON entries (visitor, created_at);
