import * as SQLite from 'expo-sqlite';

import { SCHEMA_SQL } from '@/db/schema';

async function openDatabase() {
  const database = await SQLite.openDatabaseAsync('imakestuff.db');
  await database.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await database.execAsync(SCHEMA_SQL);
  return database;
}

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb() {
  databasePromise ??= openDatabase();
  return databasePromise;
}
