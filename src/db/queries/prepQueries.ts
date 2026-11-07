import type { SQLiteDatabase } from 'expo-sqlite';

import { getDb } from '@/db/database';
import {
  wholeShare,
  type BatchSize,
  type PrepTimeShare,
  type Share,
  type UseShare,
} from '@/utils/prepTime';

export interface NewPrepUse {
  prepId: number;
  share: Share;
}

export interface FinishPrepUse extends NewPrepUse {
  useId?: number;
}

export interface AvailablePrep extends BatchSize {
  id: number;
  name: string;
  // Every piece's share of it added together, 1 being all of it.
  used_share: number;
}

export interface UsedPrep extends PrepTimeShare, BatchSize {
  id: number;
  piece_id: number;
  prep_id: number;
  prep_name: string;
}

export interface TemplatePrepUse extends Share {
  prep_id: number;
  prep_name: string;
  prep_lost: number;
  replacement: AvailablePrep | null;
}

export interface PieceUsingPrep extends UseShare {
  id: number;
  piece_id: number;
  piece_name: string;
}

// A use's share as a number, 1 being the whole prep or supply. It names no table, so it reads
// the prep_uses or supply_uses row of the query it's in.
export const shareSql = '(share_numerator * 1.0 / share_denominator)';

// One use of all of it, the same rule for prep and supplies. A whole share is saved as n/n.
export function wholeUseSql(useTable: string, batchColumn: string, batchIdSql: string) {
  return `EXISTS (SELECT 1 FROM ${useTable}
    WHERE ${batchColumn} = ${batchIdSql} AND share_numerator = share_denominator)`;
}

// All used by its uses, whatever the switch says: a measured prep whose uses reach its size, or
// any prep with one use of all of it. Uses that add up to 100% on a prep with no size are
// guesses, so they leave it open until the switch closes it. A query that already has the
// prep's shares added together passes that column in, so they aren't added up twice.
function closedByUsesSql(
  prepTable: string,
  usedShareSql = `(SELECT total(${shareSql}) FROM prep_uses WHERE prep_id = ${prepTable}.id)`,
) {
  return `((${prepTable}.size_amount IS NOT NULL AND ${usedShareSql} >= ${wholeShare})
    OR ${wholeUseSql('prep_uses', 'prep_id', `${prepTable}.id`)})`;
}

export function usedUpSql(prepTable: string, usedShareSql?: string) {
  return `(${prepTable}.used_up_at IS NOT NULL OR ${closedByUsesSql(prepTable, usedShareSql)})`;
}

// A finished piece made from a template that used prep, with none of its own: likely a missed
// cost. Unfinished pieces are left out, since a template's prep is only filled in at Done.
export const noPrepSql = `(pieces.finished_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM prep_uses WHERE piece_id = pieces.template_id)
  AND NOT EXISTS (SELECT 1 FROM prep_uses WHERE piece_id = pieces.id))`;

// The columns getActualShare needs: whether the prep is used up or measured, and every share
// of it.
const shareColumnsSql = `
  prep_uses.share_numerator, prep_uses.share_denominator,
  (SELECT ${usedUpSql('prep')} FROM pieces AS prep WHERE prep.id = prep_uses.prep_id)
    AS used_up,
  (SELECT size_amount IS NOT NULL FROM pieces AS prep WHERE prep.id = prep_uses.prep_id)
    AS measured,
  (SELECT total(${shareSql}) FROM prep_uses AS sibling
   WHERE sibling.prep_id = prep_uses.prep_id) AS shares_total`;

// The insert only matches finished prep that isn't used up or lost, so a piece, unfinished
// prep, or prep that's gone can't be used. The share's range and one use per prep per piece are
// table rules.
export async function insertPrepUse(
  database: SQLiteDatabase,
  pieceId: number,
  { prepId, share }: NewPrepUse,
) {
  const result = await database.runAsync(
    `INSERT INTO prep_uses (piece_id, prep_id, share_numerator, share_denominator)
     SELECT ?, id, ?, ? FROM pieces
     WHERE id = ? AND category = 'prep' AND finished_at IS NOT NULL AND NOT ${usedUpSql('pieces')}
       AND lost = 0`,
    pieceId,
    share.share_numerator,
    share.share_denominator,
    prepId,
  );
  if (result.changes === 0)
    throw new Error("Only finished prep that isn't all used or lost can be added.");
}

// The prep one piece used, or with no piece given, the prep every piece used.
export function getUsedPrep(database: SQLiteDatabase, pieceId: number | null) {
  return database.getAllAsync<UsedPrep>(
    `SELECT prep_uses.id, prep_uses.piece_id, prep_uses.prep_id, pieces.name AS prep_name,
       pieces.size_amount, pieces.size_unit, ${shareColumnsSql},
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

// The prep a piece already uses, for the panel after Done.
export async function getPiecePrep(pieceId: number): Promise<UsedPrep[]> {
  return getUsedPrep(await getDb(), pieceId);
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

// Newest first, leaving out prep this piece already uses. A piece not saved yet has no id.
export async function getAvailablePrep(pieceId: number | null): Promise<AvailablePrep[]> {
  const database = await getDb();
  return database.getAllAsync<AvailablePrep>(
    `SELECT pieces.id, pieces.name, pieces.size_amount, pieces.size_unit,
       total(${shareSql}) AS used_share
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

export async function getTemplatePrep(templateId: number): Promise<TemplatePrepUse[]> {
  const database = await getDb();
  const [uses, available] = await Promise.all([
    database.getAllAsync<Omit<TemplatePrepUse, 'replacement'>>(
      `SELECT prep_uses.prep_id, pieces.name AS prep_name, pieces.lost AS prep_lost,
         prep_uses.share_numerator, prep_uses.share_denominator
       FROM prep_uses
       JOIN pieces ON pieces.id = prep_uses.prep_id
       WHERE prep_uses.piece_id = ?
       ORDER BY prep_uses.id`,
      templateId,
    ),
    getAvailablePrep(null),
  ]);
  const availableIds = new Set(available.map((prep) => prep.id));
  const taken = new Set(
    uses.map((use) => use.prep_id).filter((prepId) => availableIds.has(prepId)),
  );
  return uses.map((use) => {
    const same = available.find((prep) => prep.id === use.prep_id);
    if (same) return { ...use, replacement: same };
    const newerBatch =
      available.find((prep) => prep.name === use.prep_name && !taken.has(prep.id)) ?? null;
    if (newerBatch) taken.add(newerBatch.id);
    return { ...use, replacement: newerBatch };
  });
}

export async function addPrepUse(pieceId: number, use: NewPrepUse): Promise<void> {
  await insertPrepUse(await getDb(), pieceId, use);
}

export async function changePrepUse(useId: number, share: Share): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync(
    'UPDATE prep_uses SET share_numerator = ?, share_denominator = ? WHERE id = ?',
    share.share_numerator,
    share.share_denominator,
    useId,
  );
  if (result.changes === 0) throw new Error('That prep use no longer exists.');
}

export async function removePrepUse(useId: number): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync('DELETE FROM prep_uses WHERE id = ?', useId);
  if (result.changes === 0) throw new Error('That prep use no longer exists.');
}

// All used takes the prep out of Add prep, and on a prep with no size scales its shares to the
// whole prep; off puts it back. Prep its uses close stays all used whatever the switch says, so
// turning it off is refused until a share is lowered.
export async function setPrepUsedUp(prepId: number, usedUp: boolean): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync(
    `UPDATE pieces SET used_up_at = ?
     WHERE id = ? AND category = 'prep' AND finished_at IS NOT NULL
       AND (used_up_at IS NULL) = ?
       AND (? OR NOT ${closedByUsesSql('pieces')})`,
    usedUp ? new Date().toISOString() : null,
    prepId,
    usedUp ? 1 : 0,
    usedUp ? 1 : 0,
  );
  if (result.changes > 0) return;
  if (usedUp) throw new Error("Only finished prep that isn't all used yet can be marked all used.");
  // The failure needs its reason: not all used, or uses that keep it all used.
  const prep = await database.getFirstAsync<{ closed: number }>(
    `SELECT ${closedByUsesSql('pieces')} AS closed FROM pieces WHERE id = ?`,
    prepId,
  );
  if (prep?.closed) throw new Error('Its uses take all of it. Lower one to turn All used off.');
  throw new Error("That prep isn't marked all used.");
}
