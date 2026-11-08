import { getDb } from '@/db/database';
import { SQL_NOW } from '@/db/schema';

export async function getGuideSeen(): Promise<boolean> {
  const database = await getDb();
  const settings = await database.getFirstAsync<{ seen: number }>(
    'SELECT guide_seen_at IS NOT NULL AS seen FROM settings',
  );
  return settings!.seen === 1;
}

// Finished or skipped, it's seen. The first time is kept.
export async function markGuideSeen(): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `UPDATE settings SET guide_seen_at = coalesce(guide_seen_at, ${SQL_NOW})`,
  );
}
