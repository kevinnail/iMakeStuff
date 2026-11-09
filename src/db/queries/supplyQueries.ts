import type { SQLiteDatabase } from 'expo-sqlite';

import { getDb } from '@/db/database';
import { behindSql, SQL_NOW } from '@/db/schema';
import { type BatchSize, type Share } from '@/utils/prepTime';

export interface SupplyRecord {
  id: number;
  name: string;
  // What was paid, for one or for the case.
  cost_cents: number;
  case_count: number;
  created_at: string;
  priced_at: string;
  // The prep and pieces deleting it would change: those that used it, or prep made from it, with
  // no cost saved on the use (costUserCountSql).
  prep_count: number;
  piece_count: number;
}

export interface SupplyDetails {
  name: string;
  costCents: number;
  caseCount: number;
}

export interface NewSupplyUse {
  supplyId: number;
  share: Share;
}

export interface FinishSupplyUse extends NewSupplyUse {
  useId?: number;
}

// A supply's size tells the use panel how it's entered, the same way as a prep's (supplySizeSql).
export interface AvailableSupply extends BatchSize {
  id: number;
  name: string;
  // The price of one, to the cent.
  cost_cents: number;
  // The first supply of its kind (Same as), or its own id.
  kind_id: number;
}

// The newest supply of a kind, offered by Same as.
export type SupplyKind = Pick<SupplyRecord, 'id' | 'name' | 'cost_cents' | 'case_count'>;

export interface UsedSupply extends Share, BatchSize {
  id: number;
  piece_id: number;
  supply_id: number;
  supply_name: string;
  // The price of one, not rounded, so each cost line rounds once.
  supply_cost_cents: number;
}

// One from a case is entered as a count, like 3 rods, so its size is 1 with no unit. One bought
// singly is entered as a share of it, like 1/4 of a tube, so it has no size.
const supplySizeSql = `CASE WHEN supplies.case_count > 1 THEN 1 END AS size_amount,
  NULL AS size_unit`;

// A use is of one, so a supply's price is what was paid over how many came for it.
const eachCostSql = '(supplies.cost_cents * 1.0 / supplies.case_count)';

// How many pieces or prep a supply's cost is in: those that used it, then those that used that
// prep, all the way down. A use with the prep's cost saved keeps that cost, so the cost stops
// there, except on a template, whose cost uses today's prices.
function costUserCountSql(category: 'piece' | 'prep') {
  return `(WITH RECURSIVE cost_user(id) AS (
      SELECT piece_id FROM supply_uses WHERE supply_id = supplies.id
      UNION SELECT prep_uses.piece_id FROM prep_uses
        JOIN cost_user ON prep_uses.prep_id = cost_user.id
        JOIN pieces AS using_piece ON using_piece.id = prep_uses.piece_id
        WHERE prep_uses.prep_cost_cents IS NULL OR using_piece.is_template = 1)
    SELECT count(*) FROM cost_user
    JOIN pieces ON pieces.id = cost_user.id WHERE pieces.category = '${category}')`;
}

const supplyColumnsSql = `id, name, cost_cents, case_count, created_at, priced_at,
  ${costUserCountSql('prep')} AS prep_count, ${costUserCountSql('piece')} AS piece_count`;

// Newest first.
export async function getSupplies(): Promise<SupplyRecord[]> {
  const database = await getDb();
  return database.getAllAsync<SupplyRecord>(
    `SELECT ${supplyColumnsSql} FROM supplies ORDER BY created_at DESC, id DESC`,
  );
}

export async function getSupply(supplyId: number): Promise<SupplyRecord | null> {
  const database = await getDb();
  return database.getFirstAsync<SupplyRecord>(
    `SELECT ${supplyColumnsSql} FROM supplies WHERE id = ?`,
    supplyId,
  );
}

// The supplies behind a piece or prep, its own and its prep's all the way down, as the Supplies
// list shows them, so their prices can be shown and changed where a counted prep's part cost
// comes from.
export async function getSuppliesUsedBy(pieceId: number): Promise<SupplyRecord[]> {
  const database = await getDb();
  return database.getAllAsync<SupplyRecord>(
    `SELECT ${supplyColumnsSql} FROM supplies
     WHERE id IN (SELECT supply_id FROM supply_uses WHERE piece_id IN ${behindSql('?')})
     ORDER BY id`,
    pieceId,
  );
}

// The newest supply of each kind, newest first, for Same as on Add supply.
export async function getSupplyKinds(): Promise<SupplyKind[]> {
  const database = await getDb();
  return database.getAllAsync<SupplyKind>(
    `SELECT id, name, cost_cents, case_count FROM (
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
  { name, costCents, caseCount }: SupplyDetails,
  sameAsId: number | null = null,
): Promise<number> {
  const database = await getDb();
  const result = await database.runAsync(
    `INSERT INTO supplies (name, cost_cents, case_count, kind_id)
     VALUES (?, ?, ?, (SELECT coalesce(kind_id, id) FROM supplies WHERE id = ?))`,
    name,
    costCents,
    caseCount,
    sameAsId,
  );
  return result.lastInsertRowId;
}

// A new cost or count is a new price, so it moves priced_at. A piece with a counted prep's cost
// saved on its use keeps the price it was saved with.
export async function updateSupply(
  supplyId: number,
  { name, costCents, caseCount }: SupplyDetails,
): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync(
    `UPDATE supplies SET name = ?, cost_cents = ?, case_count = ?,
       priced_at = CASE WHEN cost_cents = ? AND case_count = ? THEN priced_at ELSE ${SQL_NOW} END
     WHERE id = ?`,
    name,
    costCents,
    caseCount,
    costCents,
    caseCount,
    supplyId,
  );
  if (result.changes === 0) throw new Error('That supply no longer exists.');
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

// The share's range and one use per supply per piece are table rules.
export async function insertSupplyUse(
  database: SQLiteDatabase,
  pieceId: number,
  { supplyId, share }: NewSupplyUse,
) {
  await database.runAsync(
    `INSERT INTO supply_uses (piece_id, supply_id, share_numerator, share_denominator)
     VALUES (?, ?, ?, ?)`,
    pieceId,
    supplyId,
    share.share_numerator,
    share.share_denominator,
  );
}

// The supplies a piece used and the supplies behind the prep it used, all the way down, so its
// cost can be worked out. With no piece given, every supply use.
export function getUsedSupplies(database: SQLiteDatabase, pieceId: number | null) {
  return database.getAllAsync<UsedSupply>(
    `SELECT supply_uses.id, supply_uses.piece_id, supply_uses.supply_id,
       supplies.name AS supply_name,
       ${eachCostSql} AS supply_cost_cents, ${supplySizeSql},
       supply_uses.share_numerator, supply_uses.share_denominator
     FROM supply_uses
     JOIN supplies ON supplies.id = supply_uses.supply_id
     WHERE ? IS NULL OR supply_uses.piece_id IN ${behindSql('?')}
     ORDER BY supply_uses.id`,
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
    `SELECT id, name, ${supplySizeSql}, round(${eachCostSql}) AS cost_cents,
       coalesce(kind_id, id) AS kind_id
     FROM supplies
     WHERE id NOT IN (SELECT supply_id FROM supply_uses WHERE piece_id = ?)
     ORDER BY created_at DESC, id DESC`,
    pieceId,
  );
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
