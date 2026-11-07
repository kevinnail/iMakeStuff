import type { SQLiteDatabase } from 'expo-sqlite';

import { getDb } from '@/db/database';
import { shareSql, SQL_NOW, usedUpSql, wholeUseSql } from '@/db/schema';
import { type BatchSize, type Share, type UseShare } from '@/utils/prepTime';

export interface SupplyRecord {
  id: number;
  name: string;
  cost_cents: number;
  created_at: string;
  priced_at: string;
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

// A supply has no count, so its size is always empty: the use panel reads prep and supplies the
// same way.
export interface AvailableSupply extends BatchSize {
  id: number;
  name: string;
  used_share: number;
  cost_cents: number;
  // The first supply of its kind (Same as), or its own id.
  kind_id: number;
}

// The newest supply of a kind, offered by Same as.
export type SupplyKind = Pick<SupplyRecord, 'id' | 'name' | 'cost_cents'>;

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

const noSizeSql = 'NULL AS size_amount, NULL AS size_unit';

const closedByUsesSql = wholeUseSql('supply_uses', 'supply_id', 'supplies.id');

const supplyUsedUpSql = usedUpSql('supplies', 'supply_uses', 'supply_id');

// The pieces and prep that used a supply directly.
const directUsersSql = 'SELECT piece_id FROM supply_uses WHERE supply_id = supplies.id';

const supplyColumnsSql = `id, name, cost_cents, used_up_at, created_at, priced_at,
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

// The supplies a piece or prep used, as the Supplies list shows them, so their prices can be
// shown and changed where a counted prep's part cost comes from.
export async function getSuppliesUsedBy(pieceId: number): Promise<SupplyRecord[]> {
  const database = await getDb();
  return database.getAllAsync<SupplyRecord>(
    `SELECT ${supplyColumnsSql} FROM supplies
     WHERE id IN (SELECT supply_id FROM supply_uses WHERE piece_id = ?)
     ORDER BY id`,
    pieceId,
  );
}

// The newest supply of each kind, newest first, for Same as on Add supply.
export async function getSupplyKinds(): Promise<SupplyKind[]> {
  const database = await getDb();
  return database.getAllAsync<SupplyKind>(
    `SELECT id, name, cost_cents FROM (
       SELECT *, row_number() OVER (
         PARTITION BY coalesce(kind_id, id) ORDER BY created_at DESC, id DESC
       ) AS kind_rank
       FROM supplies
     )
     WHERE kind_rank = 1
     ORDER BY created_at DESC, id DESC`,
  );
}

// Same as records the kind of the supply picked, which is that supply's first. A blank name and
// a negative cost are table rules.
export async function addSupply(
  { name, costCents }: SupplyDetails,
  sameAsId: number | null = null,
): Promise<number> {
  const database = await getDb();
  const result = await database.runAsync(
    `INSERT INTO supplies (name, cost_cents, kind_id)
     VALUES (?, ?, (SELECT coalesce(kind_id, id) FROM supplies WHERE id = ?))`,
    name,
    costCents,
    sameAsId,
  );
  return result.lastInsertRowId;
}

// A new cost is a new price, so it moves priced_at. A piece with a counted prep's cost saved on
// its use keeps the price it was saved with.
export async function updateSupply(
  supplyId: number,
  { name, costCents }: SupplyDetails,
): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync(
    `UPDATE supplies SET name = ?, cost_cents = ?,
       priced_at = CASE WHEN cost_cents = ? THEN priced_at ELSE ${SQL_NOW} END
     WHERE id = ?`,
    name,
    costCents,
    costCents,
    supplyId,
  );
  if (result.changes === 0) throw new Error('That supply no longer exists.');
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

// The insert only matches a supply that isn't used up. The share's range and one use per supply
// per piece are table rules.
export async function insertSupplyUse(
  database: SQLiteDatabase,
  pieceId: number,
  { supplyId, share }: NewSupplyUse,
) {
  const result = await database.runAsync(
    `INSERT INTO supply_uses (piece_id, supply_id, share_numerator, share_denominator)
     SELECT ?, id, ?, ? FROM supplies WHERE id = ? AND NOT ${supplyUsedUpSql}`,
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
       supplies.name AS supply_name,
       supplies.cost_cents AS supply_cost_cents, ${noSizeSql},
       supply_uses.share_numerator, supply_uses.share_denominator,
       ${supplyUsedUpSql} AS used_up, 0 AS measured,
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
    `SELECT id, name, ${noSizeSql}, cost_cents,
       ${usedShareSql('supplies')} AS used_share, coalesce(kind_id, id) AS kind_id
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
