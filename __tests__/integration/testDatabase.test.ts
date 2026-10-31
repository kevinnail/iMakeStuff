import { createTestDb } from '../setup';

describe('test database adapter', () => {
  // Every integration test runs its queries through this adapter, so a broken one fails them all for the wrong reason.
  it('writes a row and reads it back', async () => {
    const database = createTestDb();
    await database.execAsync('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');

    const result = await database.runAsync('INSERT INTO items (name) VALUES (?)', 'vase');
    const row = await database.getFirstAsync<{ id: number; name: string }>(
      'SELECT id, name FROM items WHERE id = ?',
      result.lastInsertRowId,
    );

    expect(result.changes).toBe(1);
    expect(row).toEqual({ id: result.lastInsertRowId, name: 'vase' });
  });

  // Otherwise a constraint the schema relies on would pass in tests and only fail on the phone.
  it('rejects a write that breaks a constraint', async () => {
    const database = createTestDb();
    await database.execAsync('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');

    await expect(database.runAsync('INSERT INTO items (name) VALUES (NULL)')).rejects.toThrow(
      /NOT NULL/,
    );
  });
});
