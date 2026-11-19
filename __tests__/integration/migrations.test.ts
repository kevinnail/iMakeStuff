import BetterSqlite3 from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MIGRATION_FAILED_MESSAGE, MIGRATIONS, migrateDatabase } from '@/db/migrations';

import { createTestAdapter } from '../setup';

// Version 0: the tables on every phone before migrations existed, as TestFlight builds 1 and 2
// made them (SCHEMA_SQL as of 45ea1f7, comments left out). Frozen: it never changes when
// SCHEMA_SQL does, because it stands for the files already out there.
const VERSION_ZERO_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS pieces (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL CHECK (trim(name) <> ''),
    category        TEXT NOT NULL CHECK (category IN ('piece', 'prep')),
    notes           TEXT,
    photo_file_name TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    finished_at     TEXT,
    used_up_at      TEXT,
    lost            INTEGER NOT NULL DEFAULT 0 CHECK (lost IN (0, 1)),
    is_template     INTEGER NOT NULL DEFAULT 0 CHECK (is_template IN (0, 1)),
    template_id     INTEGER REFERENCES pieces(id),
    kind_id         INTEGER,
    size_amount     REAL,
    size_unit       TEXT,
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
    confirmed_at TEXT,
    CHECK (ended_at IS NULL OR ended_at >= started_at)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS breaks_one_running
    ON breaks(ended_at IS NULL) WHERE ended_at IS NULL;

  CREATE TABLE IF NOT EXISTS work_segments (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    piece_id           INTEGER NOT NULL REFERENCES pieces(id),
    started_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ended_at           TEXT,
    paused_by_break_id INTEGER REFERENCES breaks(id),
    confirmed_at       TEXT,
    CHECK (ended_at IS NULL OR ended_at >= started_at)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS work_segments_one_running
    ON work_segments(ended_at IS NULL) WHERE ended_at IS NULL;

  CREATE TABLE IF NOT EXISTS prep_uses (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    piece_id          INTEGER NOT NULL REFERENCES pieces(id),
    prep_id           INTEGER NOT NULL REFERENCES pieces(id),
    share_numerator   INTEGER NOT NULL CHECK (share_numerator > 0),
    share_denominator INTEGER NOT NULL CHECK (share_denominator > 0),
    prep_cost_cents   INTEGER,
    UNIQUE (piece_id, prep_id)
  );

  CREATE INDEX IF NOT EXISTS prep_uses_prep_id ON prep_uses(prep_id);

  CREATE TABLE IF NOT EXISTS supplies (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL CHECK (trim(name) <> ''),
    cost_cents  INTEGER NOT NULL CHECK (cost_cents >= 0),
    case_count  INTEGER NOT NULL DEFAULT 1 CHECK (case_count >= 1),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    priced_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    kind_id     INTEGER
  );

  CREATE TABLE IF NOT EXISTS supply_uses (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    piece_id          INTEGER NOT NULL REFERENCES pieces(id),
    supply_id         INTEGER NOT NULL REFERENCES supplies(id),
    share_numerator   INTEGER NOT NULL CHECK (share_numerator > 0),
    share_denominator INTEGER NOT NULL CHECK (share_denominator > 0),
    UNIQUE (piece_id, supply_id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    guide_seen_at TEXT
  );
  INSERT OR IGNORE INTO settings (id) VALUES (1);
`;

// A maker's data in every table: a counted prep, a finished template that used it and a supply,
// a running copy of that template, a break that paused the template's work, and a newest piece
// that was deleted, so the id counter is above the highest id left.
const VERSION_ZERO_ROWS_SQL = `
  INSERT INTO pieces (id, name, category, notes, finished_at, size_amount, size_unit)
    VALUES (1, 'Blue points', 'prep', 'Cobalt', '2026-11-10T17:00:00.000Z', 8, 'points');
  INSERT INTO pieces (id, name, category, photo_file_name, finished_at, is_template)
    VALUES (2, 'Bead', 'piece', '1731400000000-abc123.jpg', '2026-11-11T18:00:00.000Z', 1);
  INSERT INTO pieces (id, name, category, template_id, kind_id) VALUES (3, 'Bead', 'piece', 2, 2);
  INSERT INTO pieces (id, name, category) VALUES (4, 'Started by mistake', 'piece');
  DELETE FROM pieces WHERE id = 4;
  INSERT INTO breaks (id, started_at, ended_at)
    VALUES (1, '2026-11-11T16:00:00.000Z', '2026-11-11T16:15:00.000Z');
  INSERT INTO work_segments (id, piece_id, started_at, ended_at, paused_by_break_id)
    VALUES (1, 2, '2026-11-11T15:00:00.000Z', '2026-11-11T16:00:00.000Z', 1);
  INSERT INTO work_segments (id, piece_id, started_at) VALUES (2, 3, '2026-11-12T15:00:00.000Z');
  INSERT INTO prep_uses (id, piece_id, prep_id, share_numerator, share_denominator, prep_cost_cents)
    VALUES (1, 2, 1, 3, 8, 120);
  INSERT INTO supplies (id, name, cost_cents, case_count) VALUES (1, 'Clear tubing', 6000, 11);
  INSERT INTO supply_uses (id, piece_id, supply_id, share_numerator, share_denominator)
    VALUES (1, 2, 1, 1, 4);
  UPDATE settings SET guide_seen_at = '2026-11-10T16:00:00.000Z';
`;

const TABLES = [
  'pieces',
  'breaks',
  'work_segments',
  'prep_uses',
  'supplies',
  'supply_uses',
  'settings',
];

const ADD_COLUMN = 'ALTER TABLE pieces ADD COLUMN test_column INTEGER';
const INDEX_COLUMN = 'CREATE INDEX pieces_test_column ON pieces(test_column)';

function createVersionZeroDatabase() {
  const database = new BetterSqlite3(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(VERSION_ZERO_SCHEMA_SQL);
  database.exec(VERSION_ZERO_ROWS_SQL);
  return database;
}

function readRows(database: BetterSqlite3.Database) {
  return Object.fromEntries(
    TABLES.map((table) => [table, database.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]),
  );
}

// Each table and index as SQLite stores it, with comments, quotes, and spacing taken out, so a
// table a migration rebuilt or added columns to compares equal to the same table made by
// SCHEMA_SQL. SQLite keeps the spacing around where it adds a column, so spaces next to commas
// and brackets go too.
function readSchema(database: BetterSqlite3.Database) {
  const entries = database
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { type: string; name: string; sql: string }[];
  return entries.map(({ type, name, sql }) => ({
    type,
    name,
    sql: sql
      .replace(/--[^\n]*/g, '')
      .replace(/"/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*([(),])\s*/g, '$1')
      .trim(),
  }));
}

function readColumnNames(database: BetterSqlite3.Database, table: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.map((column) => column.name);
}

function withTestColumn(rows: Record<string, unknown[]>) {
  return { ...rows, pieces: rows.pieces.map((row) => ({ ...(row as object), test_column: null })) };
}

let backupDirectory: string;
let backupPath: string;

function createBackup() {
  return { path: backupPath, removePrevious: () => rmSync(backupPath, { force: true }) };
}

beforeEach(() => {
  backupDirectory = mkdtempSync(join(tmpdir(), 'evencraft-migrations-'));
  backupPath = join(backupDirectory, 'evencraft-backup.db');
});

afterEach(() => {
  rmSync(backupDirectory, { recursive: true, force: true });
});

describe('migrateDatabase', () => {
  // Otherwise a migration that drops or scrambles a tester's pieces, time, or uses ships, and
  // their only copy of that record is gone.
  it('brings a version 0 database to the tables of a new install and keeps every row', async () => {
    const existing = createVersionZeroDatabase();
    const before = readRows(existing);
    const fresh = new BetterSqlite3(':memory:');

    await migrateDatabase(createTestAdapter(existing), MIGRATIONS, createBackup());
    await migrateDatabase(createTestAdapter(fresh), MIGRATIONS, createBackup());

    expect(readSchema(existing)).toEqual(readSchema(fresh));
    expect(existing.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    const after = readRows(existing);
    for (const table of TABLES) {
      expect(after[table]).toEqual(before[table].map((row) => expect.objectContaining(row)));
    }
  });

  // Otherwise a new install runs migrations meant for old files against tables that already have
  // their changes, and fails on first launch.
  it('gives a new install the current tables at the latest version without running migrations', async () => {
    const database = new BetterSqlite3(':memory:');

    await migrateDatabase(createTestAdapter(database), [ADD_COLUMN, INDEX_COLUMN], createBackup());

    expect(database.pragma('user_version', { simple: true })).toBe(2);
    expect(readColumnNames(database, 'pieces')).toContain('name');
    expect(readColumnNames(database, 'pieces')).not.toContain('test_column');
    expect(existsSync(backupPath)).toBe(false);
  });

  // Otherwise a later migration runs before the one it builds on and a tester's update fails.
  it('runs each pending migration in order and keeps every row', async () => {
    const database = createVersionZeroDatabase();
    const before = readRows(database);

    await migrateDatabase(createTestAdapter(database), [ADD_COLUMN, INDEX_COLUMN], createBackup());

    expect(database.pragma('user_version', { simple: true })).toBe(2);
    expect(readRows(database)).toEqual(withTestColumn(before));
    const index = database.prepare(
      "SELECT name FROM sqlite_master WHERE name = 'pieces_test_column'",
    );
    expect(index.get()).toEqual({ name: 'pieces_test_column' });
  });

  // Otherwise every launch reruns finished migrations, which fail on changes already made.
  it('runs nothing and takes no backup when the database is at the latest version', async () => {
    const database = createVersionZeroDatabase();
    database.pragma('user_version = 2');
    const before = readRows(database);
    const failing = 'INSERT INTO missing_table VALUES (1)';

    await migrateDatabase(createTestAdapter(database), [failing, failing], createBackup());

    expect(readRows(database)).toEqual(before);
    expect(existsSync(backupPath)).toBe(false);
  });

  // Otherwise a failure after an earlier migration commits leaves a half-changed file, and the next
  // launch's backup replaces the copy from before any of them ran.
  it('rolls back every pending migration when one fails', async () => {
    const database = createVersionZeroDatabase();
    const before = readRows(database);
    const failing =
      'ALTER TABLE pieces ADD COLUMN second_test_column INTEGER; INSERT INTO missing_table VALUES (1)';

    await expect(
      migrateDatabase(createTestAdapter(database), [ADD_COLUMN, failing], createBackup()),
    ).rejects.toThrow(/no such table: missing_table/);

    expect(database.pragma('user_version', { simple: true })).toBe(0);
    expect(readColumnNames(database, 'pieces')).not.toContain('test_column');
    expect(readColumnNames(database, 'pieces')).not.toContain('second_test_column');
    expect(readRows(database)).toEqual(before);
  });

  // Otherwise a migration could orphan a piece's time or uses while foreign keys are off, and
  // every screen that joins them would show wrong totals from then on.
  it('rolls back a migration that leaves rows pointing at a missing piece', async () => {
    const database = createVersionZeroDatabase();
    const before = readRows(database);

    await expect(
      migrateDatabase(
        createTestAdapter(database),
        ['DELETE FROM pieces WHERE id = 3'],
        createBackup(),
      ),
    ).rejects.toThrow(/Migration 1 left 1 rows pointing at rows that don't exist/);

    expect(database.pragma('user_version', { simple: true })).toBe(0);
    expect(readRows(database)).toEqual(before);
  });

  // Otherwise a tester whose update fails sees only a SQLite error and may delete the app to fix
  // it, erasing everything they recorded.
  it('tells the maker to reopen the app, not delete it, when a migration fails', async () => {
    const database = createVersionZeroDatabase();

    const failure = migrateDatabase(
      createTestAdapter(database),
      ['INSERT INTO missing_table VALUES (1)'],
      createBackup(),
    );

    await expect(failure).rejects.toThrow(
      `${MIGRATION_FAILED_MESSAGE}\n\nno such table: missing_table`,
    );
  });

  // Otherwise the app runs with foreign keys off after a failed migration, and deleting a piece
  // leaves its time and uses behind.
  it('turns foreign keys back on after a migration fails', async () => {
    const database = createVersionZeroDatabase();

    await expect(
      migrateDatabase(
        createTestAdapter(database),
        ['INSERT INTO missing_table VALUES (1)'],
        createBackup(),
      ),
    ).rejects.toThrow(/no such table/);

    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  // Otherwise a fix build has nothing to restore after a migration ships wrong, or the second
  // migration a phone ever runs fails because the first one's backup is in the way.
  it('replaces the previous backup with a copy from before migrating', async () => {
    const database = createVersionZeroDatabase();
    const before = readRows(database);
    writeFileSync(backupPath, 'a backup from an earlier migration');

    await migrateDatabase(createTestAdapter(database), [ADD_COLUMN], createBackup());

    const backup = new BetterSqlite3(backupPath, { readonly: true });
    expect(readRows(backup)).toEqual(before);
    expect(readColumnNames(backup, 'pieces')).not.toContain('test_column');
    backup.close();
  });
});

describe('migration 1: the name is enough', () => {
  // Otherwise a tester who updates still can't save a piece with only its name.
  it('lets a migrated database save a finished piece with only a name', async () => {
    const database = createVersionZeroDatabase();

    await migrateDatabase(createTestAdapter(database), MIGRATIONS, createBackup());

    database
      .prepare("INSERT INTO pieces (name, category, finished_at) VALUES ('Bead', 'piece', ?)")
      .run('2026-11-18T18:00:00.000Z');
    const saved = database.prepare('SELECT notes, photo_file_name FROM pieces WHERE id = 5').get();
    expect(saved).toEqual({ notes: null, photo_file_name: null });
  });

  // Otherwise a new piece reuses a deleted piece's id and joins any kind still pointing at it.
  it('keeps the id counter, so a new piece never gets a deleted piece id', async () => {
    const database = createVersionZeroDatabase();

    await migrateDatabase(createTestAdapter(database), MIGRATIONS, createBackup());

    const result = database
      .prepare("INSERT INTO pieces (name, category) VALUES ('Vase', 'piece')")
      .run();
    expect(result.lastInsertRowid).toBe(5);
  });
});
