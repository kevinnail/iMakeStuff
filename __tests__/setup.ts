// Test database for integration tests: an in-memory SQLite database through
// better-sqlite3 with the app's schema, wrapped so it matches the expo-sqlite
// async API the query functions use. Call createTestDb() in beforeEach for a
// fresh database per test.

import BetterSqlite3 from 'better-sqlite3';

import { SCHEMA_SQL } from '@/db/schema';

function runStatement<Result>(statement: () => Result): Result {
  try {
    return statement();
  } catch (error) {
    throw new Error((error as Error).message);
  }
}

export function createTestAdapter(database: BetterSqlite3.Database) {
  return {
    getAllAsync: async <Row>(sql: string, ...params: unknown[]): Promise<Row[]> => {
      return runStatement(() => database.prepare(sql).all(...params) as Row[]);
    },
    getFirstAsync: async <Row>(sql: string, ...params: unknown[]): Promise<Row | null> => {
      return runStatement(() => (database.prepare(sql).get(...params) as Row) ?? null);
    },
    runAsync: async (sql: string, ...params: unknown[]) => {
      const result = runStatement(() => database.prepare(sql).run(...params));
      return { lastInsertRowId: Number(result.lastInsertRowid), changes: result.changes };
    },
    execAsync: async (sql: string) => {
      runStatement(() => database.exec(sql));
    },
    withTransactionAsync: async (task: () => Promise<void>) => {
      database.exec('BEGIN');
      try {
        await task();
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

export function createTestDb() {
  const database = new BetterSqlite3(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(SCHEMA_SQL);
  return createTestAdapter(database);
}
