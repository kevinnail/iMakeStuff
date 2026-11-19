import { SCHEMA_SQL } from '@/db/schema';

// The SQL that moves a database up one version, in order: the first makes version 1. One that has
// shipped is never edited or removed, since a phone that ran it won't run it again. SCHEMA_SQL is
// always the shape after the last one.
export const MIGRATIONS: string[] = [
  // 1: a finished piece no longer needs a photo or notes. SQLite's ALTER can't drop a check, so
  // the table is rebuilt the way sqlite.org/lang_altertable.html lays out: make the new table,
  // copy every row with its id (so segments, uses, and templates still point at the same pieces),
  // drop the old one, and rename the new one into its place. Dropping the old table deletes its id
  // counter, so the counter is handed to the new table first and the rename carries it over.
  // Otherwise a deleted piece's id could be given out again and join its kind through kind_id.
  `
  CREATE TABLE pieces_new (
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
    CHECK (used_up_at IS NULL OR category = 'prep'),
    CHECK (lost = 0 OR finished_at IS NOT NULL),
    CHECK (is_template = 0 OR finished_at IS NOT NULL),
    CHECK ((size_amount IS NULL) = (size_unit IS NULL)),
    CHECK (size_amount IS NULL OR (size_amount > 0 AND trim(size_unit) <> '' AND category = 'prep'))
  );

  INSERT INTO pieces_new (id, name, category, notes, photo_file_name, created_at, finished_at,
      used_up_at, lost, is_template, template_id, kind_id, size_amount, size_unit)
    SELECT id, name, category, notes, photo_file_name, created_at, finished_at,
      used_up_at, lost, is_template, template_id, kind_id, size_amount, size_unit
    FROM pieces;

  DELETE FROM sqlite_sequence WHERE name = 'pieces_new';
  UPDATE sqlite_sequence SET name = 'pieces_new' WHERE name = 'pieces';
  DROP TABLE pieces;
  ALTER TABLE pieces_new RENAME TO pieces;
  `,
  // 2: an optional grade on a finished piece.
  `ALTER TABLE pieces ADD COLUMN rating INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5
    AND finished_at IS NOT NULL AND lost = 0 AND category = 'piece'))`,
  // 3: an optional size on a supply, so its uses are entered in inches or grams.
  `ALTER TABLE supplies ADD COLUMN size_amount REAL CHECK (size_amount IS NULL OR size_amount > 0);
  ALTER TABLE supplies ADD COLUMN size_unit TEXT CHECK ((size_unit IS NULL) = (size_amount IS NULL)
    AND (size_unit IS NULL OR trim(size_unit) <> ''));`,
  // 4: an optional group on a supply, so supplies are listed under Color rods or Clear tubing.
  `ALTER TABLE supplies ADD COLUMN group_name TEXT CHECK (group_name IS NULL OR trim(group_name) <> '')`,
];

// What migrating uses of the database, so tests can pass better-sqlite3 in its place.
interface MigrationDatabase {
  getAllAsync<Row>(sql: string, ...params: unknown[]): Promise<Row[]>;
  getFirstAsync<Row>(sql: string, ...params: unknown[]): Promise<Row | null>;
  runAsync(sql: string, ...params: unknown[]): Promise<unknown>;
  execAsync(sql: string): Promise<void>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

// A copy of the database taken just before migrating, so a fix build could put it back if a
// migration shipped wrong. Only one is kept: VACUUM INTO refuses to write over a file, so the
// previous copy is removed first.
interface Backup {
  path: string;
  removePrevious: () => void;
}

// Every screen shows a load error's message, so a failed migration says this on each one. A
// tester who sees only a SQLite error may delete the app to fix it, which erases everything.
export const MIGRATION_FAILED_MESSAGE =
  "EvenCraft couldn't finish updating. Nothing was changed and your data is safe. Close EvenCraft and open it again. Don't delete the app: deleting it erases your data.";

// A new install (no pieces table yet) gets SCHEMA_SQL at the latest version. An existing database
// runs only the migrations above its version, never SCHEMA_SQL, all in one transaction, so a
// failure leaves the file at the version it started at and the next launch's backup matches the
// one taken before it.
export async function migrateDatabase(
  database: MigrationDatabase,
  migrations: string[],
  backup: Backup,
) {
  const piecesTable = await database.getFirstAsync(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pieces'",
  );
  if (!piecesTable) {
    await database.withTransactionAsync(async () => {
      await database.execAsync(SCHEMA_SQL);
      await database.execAsync(`PRAGMA user_version = ${migrations.length}`);
    });
    return;
  }

  const [{ user_version: currentVersion }] = await database.getAllAsync<{ user_version: number }>(
    'PRAGMA user_version',
  );
  const pending = migrations.slice(currentVersion);
  if (pending.length === 0) return;

  try {
    backup.removePrevious();
    await database.runAsync('VACUUM INTO ?', backup.path);

    // Off so a migration can rebuild a table other tables point at, which SQLite's ALTER can't do
    // and which fails at the drop with it on. It can't change inside a transaction. The check
    // after each migration stands in for it.
    await database.execAsync('PRAGMA foreign_keys = OFF');
    try {
      await database.withTransactionAsync(async () => {
        for (const [index, sql] of pending.entries()) {
          await database.execAsync(sql);
          const brokenLinks = await database.getAllAsync('PRAGMA foreign_key_check');
          if (brokenLinks.length > 0) {
            throw new Error(
              `Migration ${currentVersion + index + 1} left ${brokenLinks.length} rows pointing at rows that don't exist.`,
            );
          }
        }
        await database.execAsync(`PRAGMA user_version = ${migrations.length}`);
      });
    } finally {
      await database.execAsync('PRAGMA foreign_keys = ON');
    }
  } catch (error) {
    // The original message stays below it, so a tester's screenshot says what failed.
    throw new Error(`${MIGRATION_FAILED_MESSAGE}\n\n${(error as Error).message}`, { cause: error });
  }
}
