import { getDb } from '@/db/database';
import type { TimeRange } from '@/utils/workDays';

export interface FinishedPiece {
  id: number;
  name: string;
  photo_file_name: string | null;
  finished_at: string;
}

export interface WorkRecords {
  segments: TimeRange[];
  breaks: TimeRange[];
  finishedPieces: FinishedPiece[];
}

export async function getWorkRecords(since: string): Promise<WorkRecords> {
  const database = await getDb();
  const [segments, breaks, finishedPieces] = await Promise.all([
    database.getAllAsync<TimeRange>(
      `SELECT started_at, ended_at FROM work_segments
       WHERE ended_at IS NULL OR ended_at > ? ORDER BY started_at`,
      since,
    ),
    database.getAllAsync<TimeRange>(
      `SELECT started_at, ended_at FROM breaks
       WHERE ended_at IS NULL OR ended_at > ? ORDER BY started_at`,
      since,
    ),
    database.getAllAsync<FinishedPiece>(
      `SELECT id, name, photo_file_name, finished_at FROM pieces
       WHERE finished_at > ? ORDER BY finished_at`,
      since,
    ),
  ]);
  return { segments, breaks, finishedPieces };
}
