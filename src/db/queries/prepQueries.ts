import type { SQLiteDatabase } from 'expo-sqlite';

import { getDb } from '@/db/database';
import {
  getSuppliesUsedBy,
  getUsedSupplies,
  insertSupplyUse,
  type AvailableSupply,
  type NewSupplyUse,
  type SupplyRecord,
} from '@/db/queries/supplyQueries';
import { behindSql, prepUsedUpSql, shareSql, wholeUseSql } from '@/db/schema';
import { getCost } from '@/utils/cost';
import {
  getTotalTime,
  groupByPiece,
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
  // A counted prep's whole cost as it is now. Null for by eye prep, which the picker doesn't price,
  // or with no supply behind it.
  cost_cents: number | null;
  // true while a by eye prep behind a counted prep is open.
  cost_estimated: boolean;
  // The first prep of its kind, or its own id.
  kind_id: number;
}

// A prep or supply line on a template, and what a piece made from it takes in its place.
export interface TemplateUse<Batch> extends Share {
  batch_id: number;
  batch_name: string;
  // Prep only: 1 when it was lost.
  batch_lost: number;
  counted: number;
  kind_id: number;
  // The same batch while it can be used, or the newest open by eye one of its kind. Null when
  // there's none.
  replacement: Batch | null;
}

export interface TemplateUses {
  prep: TemplateUse<AvailablePrep>[];
  supplies: TemplateUse<AvailableSupply>[];
}

// What the form a template's lines go into can add.
export interface AvailableBatches {
  prep: AvailablePrep[];
  supplies: AvailableSupply[];
}

// A prep's whole cost and time as they are now: its own supplies and worked time, plus its share
// of each prep behind it.
export interface PrepTotals {
  // Null with no supply behind it.
  cost_cents: number | null;
  // true while a by eye prep with supplies behind it is open.
  cost_estimated: boolean;
  total_milliseconds: number;
  // true while any by eye prep behind it is open, so its time is a guess, and its cost too.
  estimated: boolean;
}

// A counted prep's part cost and time come from the whole prep's, and the cost from the supplies
// listed.
export interface PartPrice extends PrepTotals {
  supplies: SupplyRecord[];
}

export interface UsedPrep extends PrepTimeShare, BatchSize {
  id: number;
  prep_name: string;
  // The prep's whole cost as saved with a counted use, or null to work it out as it is now.
  prep_cost_cents: number | null;
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
    AND ${prepTable}.lost = 0 AND NOT ${prepUsedUpSql(prepTable)}
    AND (${prepTable}.size_amount IS NULL OR ${prepTable}.is_template = 1))`;
}

function workedMillisecondsSql(pieceIdSql: string) {
  return `(SELECT round(total(julianday(ended_at) - julianday(started_at)) * 86400000)
    FROM work_segments WHERE piece_id = ${pieceIdSql})`;
}

// A finished piece or prep with no supply behind it, its own or its prep's all the way down, and
// no counted prep's cost saved on a use behind it: an incomplete record. A saved cost on a
// template's own use doesn't count, since a template's cost uses today's prices. Unfinished
// pieces are left out, since supplies are filled in at Done, and so is a batch of a counted
// template, which takes none since the template has them.
export const noCostSql = `(pieces.finished_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM supply_uses
    WHERE supply_uses.piece_id IN ${behindSql('pieces.id')})
  AND NOT EXISTS (SELECT 1 FROM prep_uses
    JOIN pieces AS using_piece ON using_piece.id = prep_uses.piece_id
    WHERE prep_uses.piece_id IN ${behindSql('pieces.id')}
      AND prep_uses.prep_cost_cents IS NOT NULL AND using_piece.is_template = 0)
  AND NOT EXISTS (SELECT 1 FROM pieces AS template
    WHERE template.id = pieces.template_id AND template.size_amount IS NOT NULL))`;

// The columns getActualShare needs: whether the prep is used up or counted, and every share
// of it.
const shareColumnsSql = `
  prep_uses.share_numerator, prep_uses.share_denominator,
  (SELECT ${prepUsedUpSql('prep')} FROM pieces AS prep
   WHERE prep.id = prep_uses.prep_id)
    AS used_up,
  (SELECT size_amount IS NOT NULL FROM pieces AS prep WHERE prep.id = prep_uses.prep_id)
    AS measured,
  (SELECT total(${shareSql}) FROM prep_uses AS sibling
   WHERE sibling.prep_id = prep_uses.prep_id) AS shares_total`;

// A prep can't use itself or prep made from it, however far down, or its cost would have no end.
function madeFromSql(pieceIdSql: string) {
  return `${pieceIdSql} IN ${behindSql('pieces.id')}`;
}

// The insert only matches prep that can be used (availableSql) and isn't made from the piece, so a
// piece, unfinished prep, prep that's gone, a counted batch that isn't its template, or a loop
// can't be. A counted use's cost is saved by saveCountedCosts, which the write calling this runs
// once its uses are in. The share's range and one use per prep per piece are table rules.
export async function insertPrepUse(
  database: SQLiteDatabase,
  pieceId: number,
  { prepId, share }: NewPrepUse,
) {
  const result = await database.runAsync(
    `INSERT INTO prep_uses (piece_id, prep_id, share_numerator, share_denominator)
     SELECT ?, id, ?, ? FROM pieces
     WHERE id = ? AND ${availableSql('pieces')} AND NOT ${madeFromSql('?')}`,
    pieceId,
    share.share_numerator,
    share.share_denominator,
    prepId,
    pieceId,
  );
  if (result.changes > 0) return;
  // The failure needs its reason: a loop, or prep that can't be used.
  const loop = await database.getFirstAsync<{ made_from: number }>(
    `SELECT ${madeFromSql('?')} AS made_from FROM pieces WHERE id = ?`,
    pieceId,
    prepId,
  );
  if (loop?.made_from) throw new Error("A prep can't use itself or prep made from it.");
  throw new Error(
    "Only finished prep that isn't all used or lost can be added, and counted prep only by its template.",
  );
}

// The prep one piece used and the prep behind that, all the way down, or with no piece given, the
// prep every piece used. A counted use carries the cost saved with it, except on a template,
// whose own cost uses today's (Decisions: A counted use keeps its cost). Time is always the
// prep's as recorded now.
export function getUsedPrep(database: SQLiteDatabase, pieceId: number | null) {
  return database.getAllAsync<UsedPrep>(
    `SELECT prep_uses.id, prep_uses.piece_id, prep_uses.prep_id, pieces.name AS prep_name,
       pieces.size_amount, pieces.size_unit, ${shareColumnsSql},
       CASE WHEN NOT using_piece.is_template THEN prep_uses.prep_cost_cents END
         AS prep_cost_cents,
       ${workedMillisecondsSql('pieces.id')} AS prep_worked_milliseconds
     FROM prep_uses
     JOIN pieces ON pieces.id = prep_uses.prep_id
     JOIN pieces AS using_piece ON using_piece.id = prep_uses.piece_id
     WHERE ? IS NULL OR prep_uses.piece_id IN ${behindSql('?')}
     ORDER BY prep_uses.id`,
    pieceId,
    pieceId,
  );
}

// The prep a piece already uses, for the panel after Done.
export async function getPiecePrep(pieceId: number): Promise<UsedPrep[]> {
  const uses = await getUsedPrep(await getDb(), pieceId);
  return uses.filter((use) => use.piece_id === pieceId);
}

// A prep's whole cost and time as they are now, worked out the same way as a piece's.
async function getPrepTotals(database: SQLiteDatabase, prepId: number): Promise<PrepTotals> {
  const [worked, prepUses, supplyUses] = await Promise.all([
    database.getFirstAsync<{ worked_milliseconds: number }>(
      `SELECT ${workedMillisecondsSql('?')} AS worked_milliseconds`,
      prepId,
    ),
    getUsedPrep(database, prepId),
    getUsedSupplies(database, prepId),
  ]);
  const prepByPiece = groupByPiece(prepUses);
  const cost = getCost(prepId, prepByPiece, groupByPiece(supplyUses));
  const time = getTotalTime(prepId, worked!.worked_milliseconds, prepByPiece);
  return {
    cost_cents: cost.hasSupplies ? cost.cents : null,
    cost_estimated: cost.estimated,
    total_milliseconds: time.milliseconds,
    estimated: time.estimated,
  };
}

// A counted use keeps its prep's whole cost (Decisions: A counted use keeps its cost), saved once
// nothing behind the prep is a guess. While a by eye prep behind it is open, it has none and reads
// the cost as it is now, and reopening that prep takes a saved cost off again. An open by eye
// prep with no supply yet counts as a guess too, so its supply, added later, still gets in. Every
// write that adds, changes, or removes a prep use, adds a supply use, or opens or closes a by eye
// prep, runs this last.
export async function saveCountedCosts(database: SQLiteDatabase) {
  const [countedUses, prepUses, supplyUses] = await Promise.all([
    database.getAllAsync<{ id: number; prep_id: number; prep_cost_cents: number | null }>(
      `SELECT prep_uses.id, prep_uses.prep_id, prep_uses.prep_cost_cents FROM prep_uses
       JOIN pieces ON pieces.id = prep_uses.prep_id
       WHERE pieces.size_amount IS NOT NULL`,
    ),
    getUsedPrep(database, null),
    getUsedSupplies(database, null),
  ]);
  const prepByPiece = groupByPiece(prepUses);
  const supplyByPiece = groupByPiece(supplyUses);
  for (const use of countedUses) {
    const cost = getCost(use.prep_id, prepByPiece, supplyByPiece);
    // Its time is a guess exactly when a share behind it is, supplies or not.
    const guessed = getTotalTime(use.prep_id, 0, prepByPiece).estimated;
    const savedCents = guessed
      ? null
      : (use.prep_cost_cents ?? (cost.hasSupplies ? cost.cents : null));
    if (savedCents === use.prep_cost_cents) continue;
    await database.runAsync(
      'UPDATE prep_uses SET prep_cost_cents = ? WHERE id = ?',
      savedCents,
      use.id,
    );
  }
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
// already uses, and on a prep, itself and prep made from it. A piece not saved yet has no id.
export async function getAvailablePrep(pieceId: number | null): Promise<AvailablePrep[]> {
  const database = await getDb();
  const prepList = await database.getAllAsync<Omit<AvailablePrep, 'cost_cents' | 'cost_estimated'>>(
    `SELECT pieces.id, pieces.name, pieces.size_amount, pieces.size_unit,
       coalesce(pieces.kind_id, pieces.id) AS kind_id, total(${shareSql}) AS used_share
     FROM pieces
     LEFT JOIN prep_uses ON prep_uses.prep_id = pieces.id
     WHERE ${availableSql('pieces')}
       AND pieces.id NOT IN (SELECT prep_id FROM prep_uses WHERE piece_id = ?)
       AND (? IS NULL OR NOT ${madeFromSql('?')})
     GROUP BY pieces.id
     ORDER BY pieces.finished_at DESC`,
    pieceId,
    pieceId,
    pieceId,
  );
  return Promise.all(
    prepList.map(async (prep) => {
      if (prep.size_amount === null) return { ...prep, cost_cents: null, cost_estimated: false };
      const { cost_cents, cost_estimated } = await getPrepTotals(database, prep.id);
      return { ...prep, cost_cents, cost_estimated };
    }),
  );
}

// Each line takes its own batch while it can be used. A by eye line whose batch is closed takes
// the newest open by eye one of its kind, never one only sharing its name. A counted line names
// its prep's template, which never closes, so it's never swapped. The available list is newest first.
function fillTemplateLines<
  Batch extends { id: number; size_amount: number | null; kind_id: number },
>(uses: Omit<TemplateUse<Batch>, 'replacement'>[], available: Batch[]): TemplateUse<Batch>[] {
  const taken = new Set(
    uses.map((use) => use.batch_id).filter((id) => available.some((batch) => batch.id === id)),
  );
  return uses.map((use) => {
    const same = available.find((batch) => batch.id === use.batch_id);
    if (same || use.counted) return { ...use, replacement: same ?? null };
    const sameKind =
      available.find(
        (batch) =>
          batch.size_amount === null && batch.kind_id === use.kind_id && !taken.has(batch.id),
      ) ?? null;
    if (sameKind) taken.add(sameKind.id);
    return { ...use, replacement: sameKind };
  });
}

// A template's prep and supplies, for what a piece made from it starts with at Done or on Add
// Work, filled from what that form can add. A line of a kind the piece already uses is left out,
// so a rod saved on it isn't joined by a second one. A piece not saved yet has no id.
export async function getTemplateUses(
  templateId: number,
  pieceId: number | null,
  available: AvailableBatches,
): Promise<TemplateUses> {
  const database = await getDb();
  const [prepUses, supplyUses] = await Promise.all([
    database.getAllAsync<Omit<TemplateUse<AvailablePrep>, 'replacement'>>(
      `SELECT prep_uses.prep_id AS batch_id, pieces.name AS batch_name,
         pieces.lost AS batch_lost, pieces.size_amount IS NOT NULL AS counted,
         coalesce(pieces.kind_id, pieces.id) AS kind_id,
         prep_uses.share_numerator, prep_uses.share_denominator
       FROM prep_uses
       JOIN pieces ON pieces.id = prep_uses.prep_id
       WHERE prep_uses.piece_id = ?
         AND coalesce(pieces.kind_id, pieces.id) NOT IN (
           SELECT coalesce(saved.kind_id, saved.id) FROM prep_uses AS saved_use
           JOIN pieces AS saved ON saved.id = saved_use.prep_id
           WHERE saved_use.piece_id = ?)
       ORDER BY prep_uses.id`,
      templateId,
      pieceId,
    ),
    database.getAllAsync<Omit<TemplateUse<AvailableSupply>, 'replacement'>>(
      `SELECT supply_uses.supply_id AS batch_id, supplies.name AS batch_name, 0 AS batch_lost,
         0 AS counted, coalesce(supplies.kind_id, supplies.id) AS kind_id,
         supply_uses.share_numerator, supply_uses.share_denominator
       FROM supply_uses
       JOIN supplies ON supplies.id = supply_uses.supply_id
       WHERE supply_uses.piece_id = ?
         AND coalesce(supplies.kind_id, supplies.id) NOT IN (
           SELECT coalesce(saved.kind_id, saved.id) FROM supply_uses AS saved_use
           JOIN supplies AS saved ON saved.id = saved_use.supply_id
           WHERE saved_use.piece_id = ?)
       ORDER BY supply_uses.id`,
      templateId,
      pieceId,
    ),
  ]);
  return {
    prep: fillTemplateLines(prepUses, available.prep),
    supplies: fillTemplateLines(supplyUses, available.supplies),
  };
}

// A counted prep's whole cost and time at today's prices, prep behind it included, and the
// supplies its cost comes from.
export async function getPrepPrice(prepId: number): Promise<PartPrice> {
  const database = await getDb();
  const [totals, supplies] = await Promise.all([
    getPrepTotals(database, prepId),
    getSuppliesUsedBy(prepId),
  ]);
  return { ...totals, supplies };
}

// Here rather than with the supplies, since saveCountedCosts needs both files: a counted prep
// finished with no supply gets its cost saved on its uses once one is added.
export async function addSupplyUse(pieceId: number, use: NewSupplyUse): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    await insertSupplyUse(database, pieceId, use);
    await saveCountedCosts(database);
  });
}

export async function addPrepUse(pieceId: number, use: NewPrepUse): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    await insertPrepUse(database, pieceId, use);
    await saveCountedCosts(database);
  });
}

export async function changePrepUse(useId: number, share: Share): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    const result = await database.runAsync(
      'UPDATE prep_uses SET share_numerator = ?, share_denominator = ? WHERE id = ?',
      share.share_numerator,
      share.share_denominator,
      useId,
    );
    if (result.changes === 0) throw new Error('That prep use no longer exists.');
    await saveCountedCosts(database);
  });
}

export async function removePrepUse(useId: number): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    const result = await database.runAsync('DELETE FROM prep_uses WHERE id = ?', useId);
    if (result.changes === 0) throw new Error('That prep use no longer exists.');
    await saveCountedCosts(database);
  });
}

// Every unit counted prep has been saved in, for the unit dropdown, so a new count reuses "points"
// rather than starting "point" beside it.
export async function getSizeUnits(): Promise<string[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<{ size_unit: string }>(
    `SELECT DISTINCT size_unit FROM pieces WHERE size_unit IS NOT NULL
     ORDER BY size_unit COLLATE NOCASE`,
  );
  return rows.map((row) => row.size_unit);
}

// All used takes a by eye prep out of Add prep and scales its shares to the whole prep; off puts
// it back. Prep its uses close stays all used whatever the switch says, so turning it off is
// refused until a share is lowered.
export async function setPrepUsedUp(prepId: number, usedUp: boolean): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
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
    if (result.changes > 0) {
      await saveCountedCosts(database);
      return;
    }
    if (usedUp) {
      throw new Error("Only finished prep that isn't all used yet can be marked all used.");
    }
    // The failure needs its reason: not all used, or uses that keep it all used.
    const prep = await database.getFirstAsync<{ closed: number }>(
      `SELECT ${closedByUsesSql} AS closed FROM pieces WHERE id = ?`,
      prepId,
    );
    if (prep?.closed) throw new Error('Its uses take all of it. Lower one to turn All used off.');
    throw new Error("That prep isn't marked all used.");
  });
}
