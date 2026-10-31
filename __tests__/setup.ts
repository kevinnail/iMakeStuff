// Test database for integration tests: an in-memory SQLite database through
// better-sqlite3, wrapped so it matches the expo-sqlite async API the query
// functions use. Call createTestDb() in beforeEach for a fresh database per test.

import BetterSqlite3 from 'better-sqlite3';

export function createTestAdapter(database: BetterSqlite3.Database) {
  return {
    getAllAsync: async <Row>(sql: string, ...params: unknown[]): Promise<Row[]> => {
      return database.prepare(sql).all(...params) as Row[];
    },
    getFirstAsync: async <Row>(sql: string, ...params: unknown[]): Promise<Row | null> => {
      return (database.prepare(sql).get(...params) as Row) ?? null;
    },
    runAsync: async (sql: string, ...params: unknown[]) => {
      const result = database.prepare(sql).run(...params);
      return { lastInsertRowId: Number(result.lastInsertRowid), changes: result.changes };
    },
    execAsync: async (sql: string) => {
      database.exec(sql);
    },
  };
}

export function createTestDb() {
  const database = new BetterSqlite3(':memory:');
  database.pragma('foreign_keys = ON');
  return createTestAdapter(database);
}
