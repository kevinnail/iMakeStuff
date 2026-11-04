// The current time in the same ISO 8601 UTC format as JavaScript's toISOString(),
// so a stored timestamp goes straight into Date.parse().
export const SQL_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS pieces (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL CHECK (trim(name) <> ''),
    -- Prep (a cane, a frit mix) is recorded like a piece and used up by pieces later.
    category        TEXT NOT NULL CHECK (category IN ('piece', 'prep')),
    notes           TEXT,
    photo_file_name TEXT,
    created_at      TEXT NOT NULL DEFAULT (${SQL_NOW}),
    finished_at     TEXT,
    used_up_at      TEXT,
    -- Broke or cracked partway: still finished, with its time, but not output.
    lost            INTEGER NOT NULL DEFAULT 0 CHECK (lost IN (0, 1)),
    -- A finished piece must be identifiable later: it needs a photo or a description.
    CHECK (finished_at IS NULL OR photo_file_name IS NOT NULL OR trim(coalesce(notes, '')) <> ''),
    CHECK (used_up_at IS NULL OR category = 'prep'),
    CHECK (lost = 0 OR finished_at IS NOT NULL)
  );

  CREATE TABLE IF NOT EXISTS breaks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    ended_at   TEXT,
    CHECK (ended_at IS NULL OR ended_at >= started_at)
  );

  -- A break pauses everything, so only one can be running.
  CREATE UNIQUE INDEX IF NOT EXISTS breaks_one_running
    ON breaks(ended_at IS NULL) WHERE ended_at IS NULL;

  CREATE TABLE IF NOT EXISTS work_segments (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    piece_id           INTEGER NOT NULL REFERENCES pieces(id),
    started_at         TEXT NOT NULL DEFAULT (${SQL_NOW}),
    ended_at           TEXT,
    -- Set when a break ended this segment, so Back to work knows which pieces to restart.
    paused_by_break_id INTEGER REFERENCES breaks(id),
    CHECK (ended_at IS NULL OR ended_at >= started_at)
  );

  -- Only the piece in your hands collects time, so only one segment can be running.
  CREATE UNIQUE INDEX IF NOT EXISTS work_segments_one_running
    ON work_segments(ended_at IS NULL) WHERE ended_at IS NULL;

  -- How much of a prep a piece took. Only the estimate is stored; a check can't look at
  -- another table, so the insert itself only matches finished prep that isn't used up.
  CREATE TABLE IF NOT EXISTS prep_uses (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    piece_id          INTEGER NOT NULL REFERENCES pieces(id),
    prep_id           INTEGER NOT NULL REFERENCES pieces(id),
    estimated_percent INTEGER NOT NULL CHECK (estimated_percent > 0 AND estimated_percent <= 100),
    UNIQUE (piece_id, prep_id)
  );
`;
