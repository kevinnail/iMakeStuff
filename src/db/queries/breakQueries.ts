import { getDb } from '@/db/database';

export interface RunningBreak {
  id: number;
  started_at: string;
}

export async function startBreak(): Promise<void> {
  const database = await getDb();
  const startedAt = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    const startedBreak = await database.runAsync(
      'INSERT INTO breaks (started_at) VALUES (?)',
      startedAt,
    );
    const paused = await database.runAsync(
      'UPDATE work_segments SET ended_at = ?, paused_by_break_id = ? WHERE ended_at IS NULL',
      startedAt,
      startedBreak.lastInsertRowId,
    );
    if (paused.changes === 0) throw new Error('Nothing is running.');
  });
}

// Ends the break and restarts the piece it paused, from the moment the break ended,
// unless that piece was finished during the break.
export async function endBreak(): Promise<void> {
  const database = await getDb();
  const endedAt = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    const endedBreak = await database.getFirstAsync<{ id: number }>(
      'UPDATE breaks SET ended_at = ? WHERE ended_at IS NULL RETURNING id',
      endedAt,
    );
    if (!endedBreak) throw new Error('You are not on a break.');
    await database.runAsync(
      `INSERT INTO work_segments (piece_id, started_at)
       SELECT work_segments.piece_id, ?
       FROM work_segments
       JOIN pieces ON pieces.id = work_segments.piece_id
       WHERE work_segments.paused_by_break_id = ? AND pieces.finished_at IS NULL`,
      endedAt,
      endedBreak.id,
    );
  });
}

export async function getRunningBreak(): Promise<RunningBreak | null> {
  const database = await getDb();
  return database.getFirstAsync<RunningBreak>(
    'SELECT id, started_at FROM breaks WHERE ended_at IS NULL',
  );
}
