import { getDb } from '@/db/database';
import { SQL_NOW } from '@/db/schema';

export interface RunningPiece {
  id: number;
  name: string;
  started_at: string;
}

// Rejected by the database when the piece already has a running segment.
export async function startSegment(pieceId: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('INSERT INTO work_segments (piece_id) VALUES (?)', pieceId);
}

export async function startPiece(name: string): Promise<number> {
  const database = await getDb();
  let pieceId = 0;
  await database.withTransactionAsync(async () => {
    const result = await database.runAsync('INSERT INTO pieces (name) VALUES (?)', name);
    pieceId = result.lastInsertRowId;
    await startSegment(pieceId);
  });
  return pieceId;
}

export async function stopPiece(pieceId: number): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync(
    `UPDATE work_segments SET ended_at = ${SQL_NOW} WHERE piece_id = ? AND ended_at IS NULL`,
    pieceId,
  );
  if (result.changes === 0) throw new Error('That piece is not running.');
}

export async function getRunningPieces(): Promise<RunningPiece[]> {
  const database = await getDb();
  return database.getAllAsync<RunningPiece>(
    `SELECT pieces.id, pieces.name, work_segments.started_at
     FROM work_segments
     JOIN pieces ON pieces.id = work_segments.piece_id
     WHERE work_segments.ended_at IS NULL
     ORDER BY work_segments.started_at`,
  );
}
