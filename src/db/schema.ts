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

// A supply closes by its All used switch or one use of all of it. Uses that add up to 100% are
// guesses, so they leave it open until the switch closes it.
export function usedUpSql(batchTable: string, useTable: string, batchColumn: string) {
  return `(${batchTable}.used_up_at IS NOT NULL
    OR ${wholeUseSql(useTable, batchColumn, `${batchTable}.id`)})`;
}

// By eye prep closes the same way. Counted prep never closes.
export function prepUsedUpSql(prepTable: string) {
  return `(${prepTable}.size_amount IS NULL AND ${usedUpSql(prepTable, 'prep_uses', 'prep_id')})`;
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
    -- The template this piece was made from. Null once that template is deleted.
    template_id     INTEGER REFERENCES pieces(id),
    -- The first piece of its kind, through copies of copies, so a template's line for a cane
    -- that's all used fills in the newest open cane of its kind. Null on the first one. Not a
    -- reference: the kind stays together when its first piece is deleted.
    kind_id         INTEGER,
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
    -- A counted prep's whole cost when the use was saved, so the piece keeps it when prices
    -- change. Null on a by eye use, and when no supply was behind the prep. Its time isn't
    -- saved: it only changes when the prep's time is fixed, and a fix reaches every piece. A
    -- counted use can take more parts than the batch made, so the share has no upper limit
    -- here; a by eye amount is read as at most all of it (parseAmount).
    prep_cost_cents   INTEGER,
    UNIQUE (piece_id, prep_id)
  );

  -- Raw material bought at a known cost, like a 5 ft tube at $40. Not a piece: no time, no
  -- photo, no finish. The cost is what was paid for the whole thing, in cents.
  CREATE TABLE IF NOT EXISTS supplies (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL CHECK (trim(name) <> ''),
    cost_cents  INTEGER NOT NULL CHECK (cost_cents >= 0),
    used_up_at  TEXT,
    created_at  TEXT NOT NULL DEFAULT (${SQL_NOW}),
    -- When the cost was entered or last changed.
    priced_at   TEXT NOT NULL DEFAULT (${SQL_NOW}),
    -- The first supply of its kind, picked with Same as, so a template's line for a rod that's
    -- all used fills in the newest open rod of its kind. Null on the first one. Not a reference:
    -- the kind stays together when its first supply is deleted.
    kind_id     INTEGER
  );

  -- How much of a supply a piece or prep took, as the fraction entered, the same as prep_uses.
  -- The insert itself only matches a supply that isn't used up.
  CREATE TABLE IF NOT EXISTS supply_uses (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    piece_id          INTEGER NOT NULL REFERENCES pieces(id),
    supply_id         INTEGER NOT NULL REFERENCES supplies(id),
    share_numerator   INTEGER NOT NULL CHECK (share_numerator > 0),
    share_denominator INTEGER NOT NULL CHECK (share_denominator > 0),
    CHECK (share_numerator <= share_denominator),
    UNIQUE (piece_id, supply_id)
  );
`;
