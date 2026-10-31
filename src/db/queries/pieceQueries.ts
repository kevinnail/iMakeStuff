import { getDb } from '@/db/database';

export interface RunningPiece {
  id: number;
  name: string;
  started_at: string;
}

export interface FinishDetails {
  endedAt: string;
  notes: string | null;
  photoFileName: string | null;
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

export async function finishPiece(
  pieceId: number,
  { endedAt, notes, photoFileName }: FinishDetails,
): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      'UPDATE work_segments SET ended_at = ? WHERE piece_id = ? AND ended_at IS NULL',
      endedAt,
      pieceId,
    );
    const result = await database.runAsync(
      `UPDATE pieces SET finished_at = ?, notes = ?, photo_file_name = ?
       WHERE id = ? AND finished_at IS NULL`,
      endedAt,
      notes,
      photoFileName,
      pieceId,
    );
    if (result.changes === 0) throw new Error('That piece is already finished.');
  });
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
