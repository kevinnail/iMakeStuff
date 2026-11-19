import { File } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';

import { MIGRATIONS, migrateDatabase } from '@/db/migrations';

// Beside the database, in expo-sqlite's folder inside the app's documents.
const backupPath = `${SQLite.defaultDatabaseDirectory}/evencraft-backup.db`;

async function openDatabase() {
  const database = await SQLite.openDatabaseAsync('evencraft.db');
  await database.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await migrateDatabase(database, MIGRATIONS, {
    path: backupPath,
    removePrevious: () => {
      const previous = new File(`file://${backupPath}`);
      if (previous.exists) previous.delete();
    },
  });
  return database;
}

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb() {
  databasePromise ??= openDatabase();
  return databasePromise;
}
