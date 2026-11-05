import type { SQLiteDatabase } from 'expo-sqlite';

import { getDb } from '@/db/database';
import type { PrepShare, PrepTimeShare } from '@/utils/prepTime';

export interface NewPrepUse {
  prepId: number;
  estimatedPercent: number;
}

// Finished prep that isn't used up or lost, with every piece's estimate on it added together.
export interface AvailablePrep {
  id: number;
  name: string;
  used_percent: number;
}

// A prep a piece used, with the prep's worked time for the piece's share of it.
export interface UsedPrep extends PrepTimeShare {
  id: number;
  piece_id: number;
  prep_id: number;
  prep_name: string;
}

// A piece that used a prep, for the prep's page.
export interface PieceUsingPrep extends PrepShare {
  id: number;
  piece_id: number;
  piece_name: string;
}

// A prep is used up when Used up is on, or when its estimates add up to 100% or more. Reaching
// 100% isn't stored, so lowering or removing a use, or deleting a piece that used it, puts the
// prep back in use, while Used up tapped on stays on.
function usedUpSql(prepTable: string) {
  return `(${prepTable}.used_up_at IS NOT NULL OR
    (SELECT total(estimated_percent) FROM prep_uses WHERE prep_id = ${prepTable}.id) >= 100)`;
}

// The columns getActualPercent needs: whether the prep is used up, and every estimate on it.
const shareColumnsSql = `
  prep_uses.estimated_percent,
  (SELECT ${usedUpSql('prep')} FROM pieces AS prep WHERE prep.id = prep_uses.prep_id)
    AS prep_used_up,
  (SELECT total(estimated_percent) FROM prep_uses AS sibling
   WHERE sibling.prep_id = prep_uses.prep_id) AS estimates_total`;

// The insert only matches finished prep that isn't used up or lost, so a piece, unfinished
// prep, or prep that's gone can't be used. The percent's range and one use per prep per piece are table rules.
export async function insertPrepUse(
  database: SQLiteDatabase,
  pieceId: number,
  { prepId, estimatedPercent }: NewPrepUse,
) {
  const result = await database.runAsync(
    `INSERT INTO prep_uses (piece_id, prep_id, estimated_percent)
     SELECT ?, id, ? FROM pieces
     WHERE id = ? AND category = 'prep' AND finished_at IS NOT NULL AND NOT ${usedUpSql('pieces')}
       AND lost = 0`,
    pieceId,
    estimatedPercent,
    prepId,
  );
  if (result.changes === 0)
    throw new Error("Only finished prep that isn't used up or lost can be used.");
}

// The prep one piece used, or with no piece given, the prep every piece used.
export function getUsedPrep(database: SQLiteDatabase, pieceId: number | null) {
  return database.getAllAsync<UsedPrep>(
    `SELECT prep_uses.id, prep_uses.piece_id, prep_uses.prep_id, pieces.name AS prep_name,
       ${shareColumnsSql},
       round(total(julianday(work_segments.ended_at) - julianday(work_segments.started_at))
         * 86400000) AS prep_worked_milliseconds
     FROM prep_uses
     JOIN pieces ON pieces.id = prep_uses.prep_id
     JOIN work_segments ON work_segments.piece_id = pieces.id
     WHERE ? IS NULL OR prep_uses.piece_id = ?
     GROUP BY prep_uses.id
     ORDER BY prep_uses.id`,
    pieceId,
    pieceId,
  );
}

export function getPiecesUsingPrep(database: SQLiteDatabase, prepId: number) {
  return database.getAllAsync<PieceUsingPrep>(
    `SELECT prep_uses.id, prep_uses.piece_id, pieces.name AS piece_name, ${shareColumnsSql}
     FROM prep_uses
     JOIN pieces ON pieces.id = prep_uses.piece_id
     WHERE prep_uses.prep_id = ?
     ORDER BY prep_uses.id`,
    prepId,
  );
}

// Newest first, leaving out prep this piece already uses.
export async function getAvailablePrep(pieceId: number): Promise<AvailablePrep[]> {
  const database = await getDb();
  return database.getAllAsync<AvailablePrep>(
    `SELECT pieces.id, pieces.name, total(prep_uses.estimated_percent) AS used_percent
     FROM pieces
     LEFT JOIN prep_uses ON prep_uses.prep_id = pieces.id
     WHERE pieces.category = 'prep' AND pieces.finished_at IS NOT NULL
       AND NOT ${usedUpSql('pieces')} AND pieces.lost = 0
       AND pieces.id NOT IN (SELECT prep_id FROM prep_uses WHERE piece_id = ?)
     GROUP BY pieces.id
     ORDER BY pieces.finished_at DESC`,
    pieceId,
  );
}

export async function addPrepUse(pieceId: number, use: NewPrepUse): Promise<void> {
  await insertPrepUse(await getDb(), pieceId, use);
}

export async function changePrepUse(useId: number, estimatedPercent: number): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync(
    'UPDATE prep_uses SET estimated_percent = ? WHERE id = ?',
    estimatedPercent,
    useId,
  );
  if (result.changes === 0) throw new Error('That prep use no longer exists.');
}

export async function removePrepUse(useId: number): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync('DELETE FROM prep_uses WHERE id = ?', useId);
  if (result.changes === 0) throw new Error('That prep use no longer exists.');
}

// Used up takes the prep out of Add prep and scales its estimates to 100%; null puts it back.
// Prep whose estimates add up to 100% or more stays used up whatever the switch says, so
// turning it off is refused until an estimate is lowered.
export async function setPrepUsedUp(prepId: number, usedUp: boolean): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync(
    `UPDATE pieces SET used_up_at = ?
     WHERE id = ? AND category = 'prep' AND finished_at IS NOT NULL
       AND (used_up_at IS NULL) = ?
       AND (? OR (SELECT total(estimated_percent) FROM prep_uses WHERE prep_id = pieces.id) < 100)`,
    usedUp ? new Date().toISOString() : null,
    prepId,
    usedUp ? 1 : 0,
    usedUp ? 1 : 0,
  );
  if (result.changes > 0) return;
  if (usedUp) throw new Error("Only finished prep that isn't used up can be marked used up.");
  // The failure needs its reason: not used up, or estimates that keep it used up.
  const estimates = await database.getFirstAsync<{ total: number }>(
    'SELECT total(estimated_percent) AS total FROM prep_uses WHERE prep_id = ?',
    prepId,
  );
  const total = estimates?.total ?? 0;
  if (total >= 100) {
    throw new Error(`Its uses add up to ${total}%. Lower one to put it back in use.`);
  }
  throw new Error("That prep isn't used up.");
}
