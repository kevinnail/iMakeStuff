import type { SQLiteDatabase } from 'expo-sqlite';

import { getDb } from '@/db/database';
import {
  getPiecesUsingPrep,
  getUsedPrep,
  insertPrepUse,
  type NewPrepUse,
  type PieceUsingPrep,
  type UsedPrep,
} from '@/db/queries/prepQueries';
import { getPrepTime } from '@/utils/prepTime';
import type { TimeRange } from '@/utils/workDays';

export type PieceCategory = 'piece' | 'prep';

export interface UnfinishedPiece {
  id: number;
  name: string;
  category: PieceCategory;
  worked_milliseconds: number;
  running_since: string | null;
}

export interface PieceListItem {
  id: number;
  name: string;
  category: PieceCategory;
  photo_file_name: string | null;
  finished_at: string | null;
  lost: number;
  worked_milliseconds: number;
  // null for a piece that used no prep.
  prep_milliseconds: number | null;
  // true while any of its prep isn't used up.
  prep_estimated: boolean;
}

export interface PieceRecord {
  id: number;
  name: string;
  category: PieceCategory;
  notes: string | null;
  photo_file_name: string | null;
  finished_at: string | null;
  used_up_at: string | null;
  lost: number;
}

export interface PieceDetail {
  piece: PieceRecord;
  segments: TimeRange[];
  otherSegments: TimeRange[];
  breaks: TimeRange[];
  // For a piece, the prep it used. For prep, the pieces that used it.
  usedPrep: UsedPrep[];
  usedBy: PieceUsingPrep[];
}

export interface FinishDetails {
  endedAt: string;
  notes: string | null;
  photoFileName: string | null;
  lost: boolean;
  prepUses: NewPrepUse[];
}

async function stopRunning(database: SQLiteDatabase, endedAt: string): Promise<number> {
  const endedBreaks = await database.runAsync(
    'UPDATE breaks SET ended_at = ? WHERE ended_at IS NULL',
    endedAt,
  );
  const endedSegments = await database.runAsync(
    'UPDATE work_segments SET ended_at = ? WHERE ended_at IS NULL',
    endedAt,
  );
  return endedBreaks.changes + endedSegments.changes;
}

async function startSegment(database: SQLiteDatabase, pieceId: number, startedAt: string) {
  await stopRunning(database, startedAt);
  await database.runAsync(
    'INSERT INTO work_segments (piece_id, started_at) VALUES (?, ?)',
    pieceId,
    startedAt,
  );
}

export async function startPiece(name: string, category: PieceCategory): Promise<number> {
  const database = await getDb();
  const startedAt = new Date().toISOString();
  let pieceId = 0;
  await database.withTransactionAsync(async () => {
    const result = await database.runAsync(
      'INSERT INTO pieces (name, category) VALUES (?, ?)',
      name,
      category,
    );
    pieceId = result.lastInsertRowId;
    await startSegment(database, pieceId, startedAt);
  });
  return pieceId;
}

export async function switchToPiece(pieceId: number): Promise<void> {
  const database = await getDb();
  const startedAt = new Date().toISOString();
  await database.withTransactionAsync(() => startSegment(database, pieceId, startedAt));
}

export async function endDay(): Promise<void> {
  const database = await getDb();
  const endedAt = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    if ((await stopRunning(database, endedAt)) === 0) throw new Error('Nothing is running.');
  });
}

export async function finishPiece(
  pieceId: number,
  { endedAt, notes, photoFileName, lost, prepUses }: FinishDetails,
): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      'UPDATE work_segments SET ended_at = ? WHERE piece_id = ? AND ended_at IS NULL',
      endedAt,
      pieceId,
    );
    const result = await database.runAsync(
      `UPDATE pieces SET finished_at = ?, notes = ?, photo_file_name = ?, lost = ?
       WHERE id = ? AND finished_at IS NULL`,
      endedAt,
      notes,
      photoFileName,
      lost ? 1 : 0,
      pieceId,
    );
    if (result.changes === 0) throw new Error('That piece is already finished.');
    for (const use of prepUses) await insertPrepUse(database, pieceId, use);
  });
}

// For a crack found after Done, or a wrong tap. Only a finished piece can be lost.
export async function setPieceLost(pieceId: number, lost: boolean): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync(
    'UPDATE pieces SET lost = ? WHERE id = ? AND finished_at IS NOT NULL',
    lost ? 1 : 0,
    pieceId,
  );
  if (result.changes === 0) throw new Error('Only a finished piece can be marked lost or good.');
}

// In the order the pieces were started, so rows don't move when you swap.
export async function getUnfinishedPieces(): Promise<UnfinishedPiece[]> {
  const database = await getDb();
  return database.getAllAsync<UnfinishedPiece>(
    `SELECT pieces.id, pieces.name, pieces.category,
       round(total(julianday(work_segments.ended_at) - julianday(work_segments.started_at))
         * 86400000) AS worked_milliseconds,
       max(CASE WHEN work_segments.ended_at IS NULL THEN work_segments.started_at END)
         AS running_since
     FROM pieces
     JOIN work_segments ON work_segments.piece_id = pieces.id
     WHERE pieces.finished_at IS NULL
     GROUP BY pieces.id
     ORDER BY pieces.id`,
  );
}

// Unfinished pieces first, then finished ones newest first. Prep time is worked out the same
// way as on the piece's page, so the list and the page always match.
export async function getPieces(): Promise<PieceListItem[]> {
  const database = await getDb();
  const [pieces, usedPrep] = await Promise.all([
    database.getAllAsync<Omit<PieceListItem, 'prep_milliseconds' | 'prep_estimated'>>(
      `SELECT pieces.id, pieces.name, pieces.category, pieces.photo_file_name, pieces.finished_at,
         pieces.lost,
         round(total(julianday(coalesce(work_segments.ended_at, 'now'))
           - julianday(work_segments.started_at)) * 86400000) AS worked_milliseconds
       FROM pieces
       JOIN work_segments ON work_segments.piece_id = pieces.id
       GROUP BY pieces.id
       ORDER BY pieces.finished_at IS NOT NULL, pieces.finished_at DESC, pieces.id DESC`,
    ),
    getUsedPrep(database, null),
  ]);
  return pieces.map((piece) => {
    const uses = usedPrep.filter((use) => use.piece_id === piece.id);
    const prepTime = getPrepTime(piece.worked_milliseconds, uses);
    return {
      ...piece,
      prep_milliseconds: uses.length > 0 ? prepTime.prep : null,
      prep_estimated: prepTime.estimated,
    };
  });
}

export async function getPieceDetail(pieceId: number): Promise<PieceDetail | null> {
  const database = await getDb();
  const piece = await database.getFirstAsync<PieceRecord>(
    `SELECT id, name, category, notes, photo_file_name, finished_at, used_up_at, lost
     FROM pieces WHERE id = ?`,
    pieceId,
  );
  if (!piece) return null;
  const firstStartSql = '(SELECT min(started_at) FROM work_segments WHERE piece_id = ?)';
  const [segments, otherSegments, breaks, usedPrep, usedBy] = await Promise.all([
    database.getAllAsync<TimeRange>(
      'SELECT started_at, ended_at FROM work_segments WHERE piece_id = ? ORDER BY started_at',
      pieceId,
    ),
    database.getAllAsync<TimeRange>(
      `SELECT started_at, ended_at FROM work_segments
       WHERE piece_id <> ? AND (ended_at IS NULL OR ended_at > ${firstStartSql})`,
      pieceId,
      pieceId,
    ),
    database.getAllAsync<TimeRange>(
      `SELECT started_at, ended_at FROM breaks
       WHERE ended_at IS NULL OR ended_at > ${firstStartSql}`,
      pieceId,
    ),
    getUsedPrep(database, pieceId),
    getPiecesUsingPrep(database, pieceId),
  ]);
  return { piece, segments, otherSegments, breaks, usedPrep, usedBy };
}
