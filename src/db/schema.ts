// The current time in the same ISO 8601 UTC format as JavaScript's toISOString(),
// so a stored timestamp goes straight into Date.parse().
export const SQL_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS pieces (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL CHECK (trim(name) <> ''),
    notes           TEXT,
    photo_file_name TEXT,
    created_at      TEXT NOT NULL DEFAULT (${SQL_NOW}),
    finished_at     TEXT,
    -- A finished piece must be identifiable later: it needs a photo or a description.
    CHECK (finished_at IS NULL OR photo_file_name IS NOT NULL OR trim(coalesce(notes, '')) <> '')
  );

  CREATE TABLE IF NOT EXISTS work_segments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    piece_id   INTEGER NOT NULL REFERENCES pieces(id),
    started_at TEXT NOT NULL DEFAULT (${SQL_NOW}),
    ended_at   TEXT
  );

  -- A piece's timer is either running or not, so it has at most one open segment.
  CREATE UNIQUE INDEX IF NOT EXISTS work_segments_one_running_per_piece
    ON work_segments(piece_id) WHERE ended_at IS NULL;
`;
