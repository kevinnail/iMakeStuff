import type { SQLiteDatabase } from 'expo-sqlite';

import { getDb } from '@/db/database';

export interface NewPrepUse {
  prepId: number;
  estimatedPercent: number;
}

// Finished prep that isn't used up, with what's left after every piece's estimate.
export interface AvailablePrep {
  id: number;
  name: string;
  percent_left: number;
}

// A prep a piece used, with the prep's worked time for the piece's share of it.
export interface UsedPrep {
  id: number;
  piece_id: number;
  prep_id: number;
  prep_name: string;
  estimated_percent: number;
  prep_worked_milliseconds: number;
}

// A piece that used a prep, for the prep's page.
export interface PieceUsingPrep {
  id: number;
  piece_id: number;
  piece_name: string;
  estimated_percent: number;
}

// The insert only matches finished prep that isn't used up, so a piece or unfinished prep
// can't be used as prep. The percent's range and one use per prep per piece are table rules.
export async function insertPrepUse(
  database: SQLiteDatabase,
  pieceId: number,
  { prepId, estimatedPercent }: NewPrepUse,
) {
  const result = await database.runAsync(
    `INSERT INTO prep_uses (piece_id, prep_id, estimated_percent)
     SELECT ?, id, ? FROM pieces
     WHERE id = ? AND category = 'prep' AND finished_at IS NOT NULL AND used_up_at IS NULL`,
    pieceId,
    estimatedPercent,
    prepId,
  );
  if (result.changes === 0) throw new Error("Only finished prep that isn't used up can be used.");
}

// The prep one piece used, or with no piece given, the prep every piece used.
export function getUsedPrep(database: SQLiteDatabase, pieceId: number | null) {
  return database.getAllAsync<UsedPrep>(
    `SELECT prep_uses.id, prep_uses.piece_id, prep_uses.prep_id, pieces.name AS prep_name,
       prep_uses.estimated_percent,
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
    `SELECT prep_uses.id, prep_uses.piece_id, pieces.name AS piece_name,
       prep_uses.estimated_percent
     FROM prep_uses
     JOIN pieces ON pieces.id = prep_uses.piece_id
     WHERE prep_uses.prep_id = ?
     ORDER BY prep_uses.id`,
    prepId,
  );
}

// Newest first, leaving out prep this piece already uses. Estimates can pass 100% before a
// prep is used up, so what's left stops at 0%.
export async function getAvailablePrep(pieceId: number): Promise<AvailablePrep[]> {
  const database = await getDb();
  return database.getAllAsync<AvailablePrep>(
    `SELECT pieces.id, pieces.name,
       max(0, 100 - coalesce(sum(prep_uses.estimated_percent), 0)) AS percent_left
     FROM pieces
     LEFT JOIN prep_uses ON prep_uses.prep_id = pieces.id
     WHERE pieces.category = 'prep' AND pieces.finished_at IS NOT NULL
       AND pieces.used_up_at IS NULL
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
