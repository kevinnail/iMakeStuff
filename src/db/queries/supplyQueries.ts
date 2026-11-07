import type { SQLiteDatabase } from 'expo-sqlite';

import { getDb } from '@/db/database';
import { shareSql } from '@/db/queries/prepQueries';
import {
  formatPercent,
  isUsedUp,
  wholeShare,
  type BatchSize,
  type Share,
  type UseShare,
} from '@/utils/prepTime';

export interface SupplyRecord {
  id: number;
  name: string;
  cost_cents: number;
  created_at: string;
  used_up_at: string | null;
  // Every share of it added together, 1 being all of it.
  used_share: number;
  // 1 when Used up is on or its shares add up to all of it.
  used_up: number;
  // The prep that used it, and the pieces whose cost it's in, directly or through that prep.
  prep_count: number;
  piece_count: number;
}

export interface SupplyDetails {
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

// The same rule as prep: Used up tapped on, or shares that add up to all of it.
function usedUpSql(supplyTable: string) {
  return `(${supplyTable}.used_up_at IS NOT NULL OR ${usedShareSql(supplyTable)} >= ${wholeShare})`;
}

// The pieces and prep that used a supply directly.
const directUsersSql = 'SELECT piece_id FROM supply_uses WHERE supply_id = supplies.id';

// A supply has no size; the use panel reads every batch the same way, so its uses come back
// with an empty one, as a prep with no size does.
const noSizeSql = 'NULL AS size_amount, NULL AS size_unit';

const supplyColumnsSql = `id, name, cost_cents, used_up_at, created_at,
  ${usedShareSql('supplies')} AS used_share, ${usedUpSql('supplies')} AS used_up,
  (SELECT count(*) FROM pieces WHERE category = 'prep' AND id IN (${directUsersSql}))
    AS prep_count,
  (SELECT count(*) FROM pieces WHERE category = 'piece' AND (id IN (${directUsersSql})
     OR id IN (SELECT piece_id FROM prep_uses WHERE prep_id IN (${directUsersSql}))))
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

// A blank name and a negative cost are table rules.
export async function addSupply({ name, costCents }: SupplyDetails): Promise<number> {
  const database = await getDb();
  const result = await database.runAsync(
    'INSERT INTO supplies (name, cost_cents) VALUES (?, ?)',
    name,
    costCents,
  );
  return result.lastInsertRowId;
}

export async function updateSupply(
  supplyId: number,
  { name, costCents }: SupplyDetails,
): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync(
    'UPDATE supplies SET name = ?, cost_cents = ? WHERE id = ?',
    name,
    costCents,
    supplyId,
  );
  if (result.changes === 0) throw new Error('That supply no longer exists.');
}

// Used up takes the supply out of Add supply and scales its shares to all of it; off puts it
// back. A supply whose shares add up to all of it stays used up, so turning it off is refused
// until a share is lowered.
export async function setSupplyUsedUp(supplyId: number, usedUp: boolean): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync(
    `UPDATE supplies SET used_up_at = ?
     WHERE id = ? AND (used_up_at IS NULL) = ? AND (? OR ${usedShareSql('supplies')} < ${wholeShare})`,
    usedUp ? new Date().toISOString() : null,
    supplyId,
    usedUp ? 1 : 0,
    usedUp ? 1 : 0,
  );
  if (result.changes > 0) return;
  if (usedUp) throw new Error('That supply is already marked all used.');
  // The failure needs its reason: not used up, or shares that keep it used up.
  const shares = await database.getFirstAsync<{ total: number }>(
    `SELECT total(${shareSql}) AS total FROM supply_uses WHERE supply_id = ?`,
    supplyId,
  );
  const total = shares?.total ?? 0;
  if (isUsedUp(total)) {
    throw new Error(`Its uses add up to ${formatPercent(total)}. Lower one to turn All used off.`);
  }
  throw new Error("That supply isn't marked all used.");
}

// Its uses go with it, so its cost comes off everything that used it.
export async function deleteSupply(supplyId: number): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM supply_uses WHERE supply_id = ?', supplyId);
    const result = await database.runAsync('DELETE FROM supplies WHERE id = ?', supplyId);
    if (result.changes === 0) throw new Error('That supply no longer exists.');
  });
}

// The insert only matches a supply that isn't used up. The share's range and one use per
// supply per piece are table rules.
export async function insertSupplyUse(
  database: SQLiteDatabase,
  pieceId: number,
  { supplyId, share }: NewSupplyUse,
) {
  const result = await database.runAsync(
    `INSERT INTO supply_uses (piece_id, supply_id, share_numerator, share_denominator)
     SELECT ?, id, ?, ? FROM supplies WHERE id = ? AND NOT ${usedUpSql('supplies')}`,
    pieceId,
    share.share_numerator,
    share.share_denominator,
    supplyId,
  );
  if (result.changes === 0) throw new Error("Only a supply that isn't all used can be added.");
}

// The supplies a piece used and the supplies behind the prep it used, so its cost can be worked
// out. With no piece given, every supply use.
export function getUsedSupplies(database: SQLiteDatabase, pieceId: number | null) {
  return database.getAllAsync<UsedSupply>(
    `SELECT supply_uses.id, supply_uses.piece_id, supply_uses.supply_id,
       supplies.name AS supply_name, supplies.cost_cents AS supply_cost_cents,
       ${noSizeSql}, supply_uses.share_numerator, supply_uses.share_denominator,
       ${usedUpSql('supplies')} AS used_up,
       (SELECT total(${shareSql}) FROM supply_uses AS sibling
        WHERE sibling.supply_id = supply_uses.supply_id) AS shares_total
     FROM supply_uses
     JOIN supplies ON supplies.id = supply_uses.supply_id
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
    `SELECT id, name, ${noSizeSql}, ${usedShareSql('supplies')} AS used_share
     FROM supplies
     WHERE NOT ${usedUpSql('supplies')}
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
