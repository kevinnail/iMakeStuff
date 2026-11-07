import type { SQLiteDatabase } from 'expo-sqlite';

import { getDb } from '@/db/database';
import { shareSql, usedUpSql, wholeUseSql } from '@/db/schema';
import {
  rescaleShare,
  type BatchSize,
  type Share,
  type SizeInput,
  type UseShare,
} from '@/utils/prepTime';

// A counted supply has its count in size_amount and size_unit, like 16 tubes.
export interface SupplyRecord extends BatchSize {
  id: number;
  name: string;
  cost_cents: number;
  created_at: string;
  used_up_at: string | null;
  // Every share of it added together, 1 being all of it.
  used_share: number;
  // 1 when Used up is on or its shares add up to all of it.
  used_up: number;
  // The prep that used it, and the pieces deleting it would change: those that used it directly,
  // or used that prep with no cost saved on the use.
  prep_count: number;
  piece_count: number;
}

// The count is both or neither.
export interface SupplyDetails extends SizeInput {
  name: string;
  costCents: number;
}

export interface NewSupplyUse {
  supplyId: number;
  share: Share;
}

export interface FinishSupplyUse extends NewSupplyUse {
  useId?: number;
}

export interface AvailableSupply extends BatchSize {
  id: number;
  name: string;
  used_share: number;
  cost_cents: number;
}

export interface UsedSupply extends UseShare, BatchSize {
  id: number;
  piece_id: number;
  supply_id: number;
  supply_name: string;
  supply_cost_cents: number;
}

function usedShareSql(supplyTable: string) {
  return `(SELECT total(${shareSql}) FROM supply_uses WHERE supply_id = ${supplyTable}.id)`;
}

const closedByUsesSql = wholeUseSql('supply_uses', 'supply_id', 'supplies.id');

const supplyUsedUpSql = usedUpSql('supplies', 'supply_uses', 'supply_id');

// The pieces and prep that used a supply directly.
const directUsersSql = 'SELECT piece_id FROM supply_uses WHERE supply_id = supplies.id';

// A template ignores the cost saved on its uses, so its cost follows the supply either way.
const supplyColumnsSql = `id, name, cost_cents, used_up_at, created_at, size_amount, size_unit,
  ${usedShareSql('supplies')} AS used_share, ${supplyUsedUpSql} AS used_up,
  (SELECT count(*) FROM pieces WHERE category = 'prep' AND id IN (${directUsersSql}))
    AS prep_count,
  (SELECT count(*) FROM pieces WHERE category = 'piece' AND (id IN (${directUsersSql})
     OR id IN (SELECT piece_id FROM prep_uses WHERE prep_id IN (${directUsersSql})
       AND (prep_cost_cents IS NULL OR pieces.is_template = 1))))
    AS piece_count`;

// Supplies that can still be used first, then newest first.
export async function getSupplies(): Promise<SupplyRecord[]> {
  const database = await getDb();
  return database.getAllAsync<SupplyRecord>(
    `SELECT ${supplyColumnsSql} FROM supplies ORDER BY used_up, created_at DESC, id DESC`,
  );
}

export async function getSupply(supplyId: number): Promise<SupplyRecord | null> {
  const database = await getDb();
  return database.getFirstAsync<SupplyRecord>(
    `SELECT ${supplyColumnsSql} FROM supplies WHERE id = ?`,
    supplyId,
  );
}

// A blank name, a negative cost, and a count without its unit are table rules.
export async function addSupply({
  name,
  costCents,
  sizeAmount,
  sizeUnit,
}: SupplyDetails): Promise<number> {
  const database = await getDb();
  const result = await database.runAsync(
    'INSERT INTO supplies (name, cost_cents, size_amount, size_unit) VALUES (?, ?, ?, ?)',
    name,
    costCents,
    sizeAmount,
    sizeUnit,
  );
  return result.lastInsertRowId;
}

// A counted batch's count corrected after it was used: each use keeps the parts it entered (1
// tube stays 1 tube), so its share is worked out again against the new count.
export async function rescaleUses(
  database: SQLiteDatabase,
  useTable: 'prep_uses' | 'supply_uses',
  batchColumn: 'prep_id' | 'supply_id',
  batchId: number,
  oldCount: number,
  newCount: number,
) {
  const uses = await database.getAllAsync<Share & { id: number }>(
    `SELECT id, share_numerator, share_denominator FROM ${useTable} WHERE ${batchColumn} = ?`,
    batchId,
  );
  for (const use of uses) {
    const share = rescaleShare(use, oldCount, newCount);
    await database.runAsync(
      `UPDATE ${useTable} SET share_numerator = ?, share_denominator = ? WHERE id = ?`,
      share.share_numerator,
      share.share_denominator,
      use.id,
    );
  }
}

// Pieces already saved with a counted use keep the price they were saved with. A corrected count
// keeps each use's parts (rescaleUses). Counted or By eye can't change once something has used
// the supply, since its uses were saved as one or the other.
export async function updateSupply(
  supplyId: number,
  { name, costCents, sizeAmount, sizeUnit }: SupplyDetails,
): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    const current = await database.getFirstAsync<{ size_amount: number | null; used: number }>(
      `SELECT size_amount, EXISTS (SELECT 1 FROM supply_uses WHERE supply_id = supplies.id) AS used
       FROM supplies WHERE id = ?`,
      supplyId,
    );
    if (!current) throw new Error('That supply no longer exists.');
    if (current.used && (current.size_amount === null) !== (sizeAmount === null)) {
      throw new Error("Holds can't be added or cleared once something has used the supply.");
    }
    await database.runAsync(
      'UPDATE supplies SET name = ?, cost_cents = ?, size_amount = ?, size_unit = ? WHERE id = ?',
      name,
      costCents,
      sizeAmount,
      sizeUnit,
      supplyId,
    );
    if (current.size_amount !== null && sizeAmount !== null && sizeAmount !== current.size_amount) {
      await rescaleUses(
        database,
        'supply_uses',
        'supply_id',
        supplyId,
        current.size_amount,
        sizeAmount,
      );
    }
  });
}

// All used takes the supply out of Add supply and scales its shares to all of it; off puts it
// back. A supply one use took all of stays all used, so turning it off is refused until that
// share is lowered.
export async function setSupplyUsedUp(supplyId: number, usedUp: boolean): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync(
    `UPDATE supplies SET used_up_at = ?
     WHERE id = ? AND (used_up_at IS NULL) = ? AND (? OR NOT ${closedByUsesSql})`,
    usedUp ? new Date().toISOString() : null,
    supplyId,
    usedUp ? 1 : 0,
    usedUp ? 1 : 0,
  );
  if (result.changes > 0) return;
  if (usedUp) throw new Error('That supply is already marked all used.');
  // The failure needs its reason: not all used, or a use that keeps it all used.
  const supply = await database.getFirstAsync<{ closed: number }>(
    `SELECT ${closedByUsesSql} AS closed FROM supplies WHERE id = ?`,
    supplyId,
  );
  if (supply?.closed) throw new Error('One use takes all of it. Lower it to turn All used off.');
  throw new Error("That supply isn't marked all used.");
}

// Its uses go with it, so its cost comes off what used it. A piece with a prep's cost saved on its
// use keeps that cost.
export async function deleteSupply(supplyId: number): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM supply_uses WHERE supply_id = ?', supplyId);
    const result = await database.runAsync('DELETE FROM supplies WHERE id = ?', supplyId);
    if (result.changes === 0) throw new Error('That supply no longer exists.');
  });
}

// The insert only matches a supply that isn't used up. A counted use saves the supply's cost
// (Decisions: A counted use keeps its cost). The share's range and one use per supply per piece
// are table rules.
export async function insertSupplyUse(
  database: SQLiteDatabase,
  pieceId: number,
  { supplyId, share }: NewSupplyUse,
) {
  const result = await database.runAsync(
    `INSERT INTO supply_uses (piece_id, supply_id, share_numerator, share_denominator,
       supply_cost_cents)
     SELECT ?, id, ?, ?, CASE WHEN size_amount IS NOT NULL THEN cost_cents END
     FROM supplies WHERE id = ? AND NOT ${supplyUsedUpSql}`,
    pieceId,
    share.share_numerator,
    share.share_denominator,
    supplyId,
  );
  if (result.changes === 0) throw new Error("Only a supply that isn't all used can be added.");
}

// The supplies a piece used and the supplies behind the prep it used, so its cost can be worked
// out. With no piece given, every supply use. A counted use costs what was saved with it, except
// on a template, whose own cost uses today's prices (Decisions: A counted use keeps its cost).
export function getUsedSupplies(database: SQLiteDatabase, pieceId: number | null) {
  return database.getAllAsync<UsedSupply>(
    `SELECT supply_uses.id, supply_uses.piece_id, supply_uses.supply_id,
       supplies.name AS supply_name,
       coalesce(CASE WHEN NOT using_piece.is_template THEN supply_uses.supply_cost_cents END,
         supplies.cost_cents) AS supply_cost_cents,
       supplies.size_amount, supplies.size_unit,
       supply_uses.share_numerator, supply_uses.share_denominator,
       ${supplyUsedUpSql} AS used_up, supplies.size_amount IS NOT NULL AS measured,
       (SELECT total(${shareSql}) FROM supply_uses AS sibling
        WHERE sibling.supply_id = supply_uses.supply_id) AS shares_total
     FROM supply_uses
     JOIN supplies ON supplies.id = supply_uses.supply_id
     JOIN pieces AS using_piece ON using_piece.id = supply_uses.piece_id
     WHERE ? IS NULL OR supply_uses.piece_id = ?
       OR supply_uses.piece_id IN (SELECT prep_id FROM prep_uses WHERE piece_id = ?)
     ORDER BY supply_uses.id`,
    pieceId,
    pieceId,
    pieceId,
  );
}

// The supplies a piece already uses, for the panel after Done.
export async function getPieceSupplies(pieceId: number): Promise<UsedSupply[]> {
  const uses = await getUsedSupplies(await getDb(), pieceId);
  return uses.filter((use) => use.piece_id === pieceId);
}

// Newest first, leaving out supplies this piece already uses. A piece not saved yet has no id.
export async function getAvailableSupplies(pieceId: number | null): Promise<AvailableSupply[]> {
  const database = await getDb();
  return database.getAllAsync<AvailableSupply>(
    `SELECT id, name, size_amount, size_unit, cost_cents,
       ${usedShareSql('supplies')} AS used_share
     FROM supplies
     WHERE NOT ${supplyUsedUpSql}
       AND id NOT IN (SELECT supply_id FROM supply_uses WHERE piece_id = ?)
     ORDER BY created_at DESC, id DESC`,
    pieceId,
  );
}

export async function addSupplyUse(pieceId: number, use: NewSupplyUse): Promise<void> {
  await insertSupplyUse(await getDb(), pieceId, use);
}

export async function changeSupplyUse(useId: number, share: Share): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync(
    'UPDATE supply_uses SET share_numerator = ?, share_denominator = ? WHERE id = ?',
    share.share_numerator,
    share.share_denominator,
    useId,
  );
  if (result.changes === 0) throw new Error('That supply use no longer exists.');
}

export async function removeSupplyUse(useId: number): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync('DELETE FROM supply_uses WHERE id = ?', useId);
  if (result.changes === 0) throw new Error('That supply use no longer exists.');
}
