import { getDb } from '@/db/database';

export interface SupplyRecord {
  id: number;
  name: string;
  cost_cents: number;
  bought_at: string;
  used_up_at: string | null;
}

export interface SupplyDetails {
  name: string;
  costCents: number;
  boughtAt: string;
}

const supplyColumnsSql = 'id, name, cost_cents, bought_at, used_up_at';

// Supplies that can still be used first, then newest bought first.
export async function getSupplies(): Promise<SupplyRecord[]> {
  const database = await getDb();
  return database.getAllAsync<SupplyRecord>(
    `SELECT ${supplyColumnsSql} FROM supplies
     ORDER BY used_up_at IS NOT NULL, bought_at DESC, id DESC`,
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
export async function addSupply({ name, costCents, boughtAt }: SupplyDetails): Promise<number> {
  const database = await getDb();
  const result = await database.runAsync(
    'INSERT INTO supplies (name, cost_cents, bought_at) VALUES (?, ?, ?)',
    name,
    costCents,
    boughtAt,
  );
  return result.lastInsertRowId;
}

export async function updateSupply(
  supplyId: number,
  { name, costCents, boughtAt }: SupplyDetails,
): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync(
    'UPDATE supplies SET name = ?, cost_cents = ?, bought_at = ? WHERE id = ?',
    name,
    costCents,
    boughtAt,
    supplyId,
  );
  if (result.changes === 0) throw new Error('That supply no longer exists.');
}

// Used up takes the supply out of what can be used; off puts it back.
export async function setSupplyUsedUp(supplyId: number, usedUp: boolean): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync(
    'UPDATE supplies SET used_up_at = ? WHERE id = ? AND (used_up_at IS NULL) = ?',
    usedUp ? new Date().toISOString() : null,
    supplyId,
    usedUp ? 1 : 0,
  );
  if (result.changes === 0) {
    throw new Error(usedUp ? 'That supply is already used up.' : "That supply isn't used up.");
  }
}

export async function deleteSupply(supplyId: number): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync('DELETE FROM supplies WHERE id = ?', supplyId);
  if (result.changes === 0) throw new Error('That supply no longer exists.');
}
