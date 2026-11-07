import type { SQLiteDatabase } from 'expo-sqlite';

import { getDb } from '@/db/database';
import { getUsedSupplies } from '@/db/queries/supplyQueries';
import { shareSql, usedUpSql, wholeUseSql } from '@/db/schema';
import { getCost } from '@/utils/cost';
import { type BatchSize, type PrepTimeShare, type Share, type UseShare } from '@/utils/prepTime';

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
  // A counted prep's whole cost as it is now. Null for by eye prep, which the picker doesn't price,
  // or with no supply behind it.
  cost_cents: number | null;
  // Counted prep only: true while a by eye supply's guess is in that cost.
  cost_estimated?: boolean;
}

export interface UsedPrep extends PrepTimeShare, BatchSize {
  id: number;
  piece_id: number;
  prep_id: number;
  prep_name: string;
  // The prep's whole cost as saved with a counted use, or null to work it out from its supplies.
  prep_cost_cents: number | null;
}

export interface TemplatePrepUse extends Share {
  prep_id: number;
  prep_name: string;
  prep_lost: number;
  counted: number;
  replacement: AvailablePrep | null;
}

export interface PieceUsingPrep extends UseShare {
  id: number;
  piece_id: number;
  piece_name: string;
}

// All used by its uses, whatever the switch says.
const closedByUsesSql = wholeUseSql('prep_uses', 'prep_id', 'pieces.id');

// Prep a piece can use: finished, not lost, and either by eye and open, or a counted prep's
// template, which holds the time and cost every batch of it is divided from.
export function availableSql(prepTable: string) {
  return `(${prepTable}.category = 'prep' AND ${prepTable}.finished_at IS NOT NULL
    AND ${prepTable}.lost = 0 AND NOT ${usedUpSql(prepTable, 'prep_uses', 'prep_id')}
    AND (${prepTable}.size_amount IS NULL OR ${prepTable}.is_template = 1))`;
}

function workedMillisecondsSql(pieceIdSql: string) {
  return `(SELECT round(total(julianday(ended_at) - julianday(started_at)) * 86400000)
    FROM work_segments WHERE piece_id = ${pieceIdSql})`;
}

// A finished piece made from a template that used prep, with none of its own: likely a missed
// cost. Unfinished pieces are left out, since a template's prep is only filled in at Done.
export const noPrepSql = `(pieces.finished_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM prep_uses WHERE piece_id = pieces.template_id)
  AND NOT EXISTS (SELECT 1 FROM prep_uses WHERE piece_id = pieces.id))`;

// The columns getActualShare needs: whether the prep is used up or counted, and every share
// of it.
const shareColumnsSql = `
  prep_uses.share_numerator, prep_uses.share_denominator,
  (SELECT ${usedUpSql('prep', 'prep_uses', 'prep_id')} FROM pieces AS prep
   WHERE prep.id = prep_uses.prep_id)
    AS used_up,
  (SELECT size_amount IS NOT NULL FROM pieces AS prep WHERE prep.id = prep_uses.prep_id)
    AS measured,
  (SELECT total(${shareSql}) FROM prep_uses AS sibling
   WHERE sibling.prep_id = prep_uses.prep_id) AS shares_total`;

// The insert only matches prep that can be used (availableSql), so a piece, unfinished prep,
// prep that's gone, or a counted batch that isn't its template can't be. A counted use saves the
// prep's whole cost and time as they are now (Decisions: A counted use keeps its cost). A cost
// with a by eye supply's guess in it isn't saved, so the piece stays estimated and takes the
// actual cost when that supply closes. The share's range and one use per prep per piece are
// table rules.
export async function insertPrepUse(
  database: SQLiteDatabase,
  pieceId: number,
  { prepId, share }: NewPrepUse,
) {
  const prep = await database.getFirstAsync<{ counted: number }>(
    'SELECT size_amount IS NOT NULL AS counted FROM pieces WHERE id = ?',
    prepId,
  );
  const prepCost = prep?.counted
    ? getCost(prepId, [], await getUsedSupplies(database, prepId))
    : null;
  const result = await database.runAsync(
    `INSERT INTO prep_uses (piece_id, prep_id, share_numerator, share_denominator,
       prep_cost_cents, prep_milliseconds)
     SELECT ?, id, ?, ?, ?,
       CASE WHEN size_amount IS NOT NULL THEN ${workedMillisecondsSql('pieces.id')} END
     FROM pieces WHERE id = ? AND ${availableSql('pieces')}`,
    pieceId,
    share.share_numerator,
    share.share_denominator,
    prepCost?.hasSupplies && !prepCost.estimated ? prepCost.cents : null,
    prepId,
  );
  if (result.changes === 0)
    throw new Error(
      "Only finished prep that isn't all used or lost can be added, and counted prep only by its template.",
    );
}

// The prep one piece used, or with no piece given, the prep every piece used. A counted use
// carries the cost and time saved with it, except on a template, whose own cost uses today's
// (Decisions: A counted use keeps its cost).
export function getUsedPrep(database: SQLiteDatabase, pieceId: number | null) {
  return database.getAllAsync<UsedPrep>(
    `SELECT prep_uses.id, prep_uses.piece_id, prep_uses.prep_id, pieces.name AS prep_name,
       pieces.size_amount, pieces.size_unit, ${shareColumnsSql},
       CASE WHEN NOT using_piece.is_template THEN prep_uses.prep_cost_cents END
         AS prep_cost_cents,
       coalesce(CASE WHEN NOT using_piece.is_template THEN prep_uses.prep_milliseconds END,
         ${workedMillisecondsSql('pieces.id')}) AS prep_worked_milliseconds
     FROM prep_uses
     JOIN pieces ON pieces.id = prep_uses.prep_id
     JOIN pieces AS using_piece ON using_piece.id = prep_uses.piece_id
     WHERE ? IS NULL OR prep_uses.piece_id = ?
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

// Open by eye prep and each counted prep's template, newest first, leaving out prep this piece
// already uses. A piece not saved yet has no id.
export async function getAvailablePrep(pieceId: number | null): Promise<AvailablePrep[]> {
  const database = await getDb();
  const prepList = await database.getAllAsync<Omit<AvailablePrep, 'cost_cents'>>(
    `SELECT pieces.id, pieces.name, pieces.size_amount, pieces.size_unit,
       total(${shareSql}) AS used_share
     FROM pieces
     LEFT JOIN prep_uses ON prep_uses.prep_id = pieces.id
     WHERE ${availableSql('pieces')}
       AND pieces.id NOT IN (SELECT prep_id FROM prep_uses WHERE piece_id = ?)
     GROUP BY pieces.id
     ORDER BY pieces.finished_at DESC`,
    pieceId,
  );
  return Promise.all(
    prepList.map(async (prep) => {
      if (prep.size_amount === null) return { ...prep, cost_cents: null };
      const cost = getCost(prep.id, [], await getUsedSupplies(database, prep.id));
      return {
        ...prep,
        cost_cents: cost.hasSupplies ? cost.cents : null,
        cost_estimated: cost.estimated,
      };
    }),
  );
}

// A by eye line whose prep is gone takes the newest open by eye prep with its name. A counted
// line names its template, so it's never swapped.
export async function getTemplatePrep(templateId: number): Promise<TemplatePrepUse[]> {
  const database = await getDb();
  const [uses, available] = await Promise.all([
    database.getAllAsync<Omit<TemplatePrepUse, 'replacement'>>(
      `SELECT prep_uses.prep_id, pieces.name AS prep_name, pieces.lost AS prep_lost,
         pieces.size_amount IS NOT NULL AS counted,
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
    if (same || use.counted) return { ...use, replacement: same ?? null };
    const newerBatch =
      available.find(
        (prep) => prep.size_amount === null && prep.name === use.prep_name && !taken.has(prep.id),
      ) ?? null;
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

// All used takes a by eye prep out of Add prep and scales its shares to the whole prep; off puts
// it back. Prep its uses close stays all used whatever the switch says, so turning it off is
// refused until a share is lowered.
export async function setPrepUsedUp(prepId: number, usedUp: boolean): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync(
    `UPDATE pieces SET used_up_at = ?
     WHERE id = ? AND category = 'prep' AND finished_at IS NOT NULL
       AND (used_up_at IS NULL) = ?
       AND (? OR NOT ${closedByUsesSql})`,
    usedUp ? new Date().toISOString() : null,
    prepId,
    usedUp ? 1 : 0,
    usedUp ? 1 : 0,
  );
  if (result.changes > 0) return;
  if (usedUp) throw new Error("Only finished prep that isn't all used yet can be marked all used.");
  // The failure needs its reason: not all used, or uses that keep it all used.
  const prep = await database.getFirstAsync<{ closed: number }>(
    `SELECT ${closedByUsesSql} AS closed FROM pieces WHERE id = ?`,
    prepId,
  );
  if (prep?.closed) throw new Error('Its uses take all of it. Lower one to turn All used off.');
  throw new Error("That prep isn't marked all used.");
}
