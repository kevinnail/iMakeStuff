// The current time in the same ISO 8601 UTC format as JavaScript's toISOString(),
// so a stored timestamp goes straight into Date.parse().
export const SQL_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

// A use's share as a number, 1 being the whole prep or supply.
export const shareSql = '(share_numerator * 1.0 / share_denominator)';

// One use of all of a batch, saved as n/n.
export function wholeUseSql(useTable: string, batchColumn: string, batchIdSql: string) {
  return `EXISTS (SELECT 1 FROM ${useTable}
    WHERE ${batchColumn} = ${batchIdSql} AND share_numerator = share_denominator)`;
}

// A by eye batch closes by its All used switch or one use of all of it. Uses that add up to 100%
// are guesses, so they leave it open until the switch closes it. A counted batch never closes.
export function usedUpSql(batchTable: string, useTable: string, batchColumn: string) {
  return `(${batchTable}.size_amount IS NULL
    AND (${batchTable}.used_up_at IS NOT NULL
      OR ${wholeUseSql(useTable, batchColumn, `${batchTable}.id`)}))`;
}

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
    -- A finished piece offered on Add Work's Existing, to make another one like it.
    is_template     INTEGER NOT NULL DEFAULT 0 CHECK (is_template IN (0, 1)),
    -- The template this piece was made from.
    template_id     INTEGER REFERENCES pieces(id),
    -- A counted prep's count in the maker's own unit, like 8 points, so uses are entered in
    -- it. By eye prep has none.
    size_amount     REAL,
    size_unit       TEXT,
    -- A finished piece must be identifiable later: it needs a photo or a description.
    CHECK (finished_at IS NULL OR photo_file_name IS NOT NULL OR trim(coalesce(notes, '')) <> ''),
    CHECK (used_up_at IS NULL OR category = 'prep'),
    CHECK (lost = 0 OR finished_at IS NOT NULL),
    CHECK (is_template = 0 OR finished_at IS NOT NULL),
    CHECK ((size_amount IS NULL) = (size_unit IS NULL)),
    CHECK (size_amount IS NULL OR (size_amount > 0 AND trim(size_unit) <> '' AND category = 'prep'))
  );

  CREATE TABLE IF NOT EXISTS breaks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    ended_at   TEXT,
    -- When Still on break was last tapped, so the question waits another hour from then.
    confirmed_at TEXT,
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
    -- When Still working was last tapped, so the question waits another 6 hours from then.
    confirmed_at       TEXT,
    CHECK (ended_at IS NULL OR ended_at >= started_at)
  );

  -- Only the piece in your hands collects time, so only one segment can be running.
  CREATE UNIQUE INDEX IF NOT EXISTS work_segments_one_running
    ON work_segments(ended_at IS NULL) WHERE ended_at IS NULL;

  -- How much of a prep a piece took, as the fraction entered: 1/8, or 25/100 for 25%. A check
  -- can't look at another table, so the insert itself only matches prep that can be used.
  CREATE TABLE IF NOT EXISTS prep_uses (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    piece_id          INTEGER NOT NULL REFERENCES pieces(id),
    prep_id           INTEGER NOT NULL REFERENCES pieces(id),
    share_numerator   INTEGER NOT NULL CHECK (share_numerator > 0),
    share_denominator INTEGER NOT NULL CHECK (share_denominator > 0),
    -- A counted prep's whole cost and worked time when the use was saved, so the piece keeps
    -- them when prices change. Null on a by eye use, and the cost is null when no supply was
    -- behind the prep.
    prep_cost_cents   INTEGER,
    prep_milliseconds INTEGER,
    -- A by eye share is a guess at part of one thing, so at most all of it. A counted use can
    -- take more parts than the batch made.
    CHECK (share_numerator <= share_denominator OR prep_milliseconds IS NOT NULL),
    UNIQUE (piece_id, prep_id)
  );

  -- Raw material bought at a known cost, like a 5 ft tube at $40. Not a piece: no time, no
  -- photo, no finish. The cost is what was paid for the whole thing, in cents. created_at is
  -- when it was added, which keeps each price's date, so prices can be compared over time.
  CREATE TABLE IF NOT EXISTS supplies (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL CHECK (trim(name) <> ''),
    cost_cents  INTEGER NOT NULL CHECK (cost_cents >= 0),
    used_up_at  TEXT,
    created_at  TEXT NOT NULL DEFAULT (${SQL_NOW}),
    -- A counted supply's count, like a box that holds 16 tubes. A by eye supply has none.
    size_amount REAL,
    size_unit   TEXT,
    CHECK ((size_amount IS NULL) = (size_unit IS NULL)),
    CHECK (size_amount IS NULL OR (size_amount > 0 AND trim(size_unit) <> ''))
  );

  -- How much of a supply a piece or prep took, as the fraction entered, the same as prep_uses.
  -- The insert itself only matches a supply that isn't used up.
  CREATE TABLE IF NOT EXISTS supply_uses (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    piece_id          INTEGER NOT NULL REFERENCES pieces(id),
    supply_id         INTEGER NOT NULL REFERENCES supplies(id),
    share_numerator   INTEGER NOT NULL CHECK (share_numerator > 0),
    share_denominator INTEGER NOT NULL CHECK (share_denominator > 0),
    -- A counted supply's cost when the use was saved, so the piece keeps it when the price
    -- changes. Null on a by eye use.
    supply_cost_cents INTEGER,
    CHECK (share_numerator <= share_denominator OR supply_cost_cents IS NOT NULL),
    UNIQUE (piece_id, supply_id)
  );
`;
