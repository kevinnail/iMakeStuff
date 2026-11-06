import type { SQLiteDatabase } from 'expo-sqlite';

import { getDb } from '@/db/database';
import {
  getPiecesUsingPrep,
  getUsedPrep,
  insertPrepUse,
  usedUpSql,
  type FinishPrepUse,
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
  photo_file_name: string | null;
  template_id: number | null;
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
  used_percent: number;
  used_up: number;
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
  is_template: number;
}

export interface Template {
  id: number;
  name: string;
  category: PieceCategory;
  photo_file_name: string | null;
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
  // Every prep the piece ends up with. Uses already on it that aren't listed are removed.
  prepUses: FinishPrepUse[];
}

export interface PieceChanges {
  name: string;
  category: PieceCategory;
  notes: string | null;
  photoFileName: string | null;
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

export async function startFromTemplate(templateId: number): Promise<number> {
  const database = await getDb();
  const startedAt = new Date().toISOString();
  let pieceId = 0;
  await database.withTransactionAsync(async () => {
    const result = await database.runAsync(
      `INSERT INTO pieces (name, category, template_id)
       SELECT name, category, id FROM pieces WHERE id = ? AND is_template = 1`,
      templateId,
    );
    if (result.changes === 0) throw new Error("That piece isn't a template.");
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
    const keptUseIds = prepUses.flatMap((use) => (use.useId === undefined ? [] : [use.useId]));
    await database.runAsync(
      'DELETE FROM prep_uses WHERE piece_id = ? AND id NOT IN (SELECT value FROM json_each(?))',
      pieceId,
      JSON.stringify(keptUseIds),
    );
    for (const use of prepUses) {
      if (use.useId === undefined) {
        await insertPrepUse(database, pieceId, use);
        continue;
      }
      const changed = await database.runAsync(
        'UPDATE prep_uses SET estimated_percent = ? WHERE id = ? AND piece_id = ?',
        use.estimatedPercent,
        use.useId,
        pieceId,
      );
      if (changed.changes === 0) throw new Error('That prep use no longer exists.');
    }
  });
}

export async function updatePiece(pieceId: number, changes: PieceChanges): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    const current = await database.getFirstAsync<{
      used_up_at: string | null;
      uses_prep: number;
      used_by_pieces: number;
    }>(
      `SELECT used_up_at,
         EXISTS (SELECT 1 FROM prep_uses WHERE piece_id = pieces.id) AS uses_prep,
         EXISTS (SELECT 1 FROM prep_uses WHERE prep_id = pieces.id) AS used_by_pieces
       FROM pieces WHERE id = ?`,
      pieceId,
    );
    if (!current) throw new Error('That piece no longer exists.');
    if (changes.category === 'prep' && current.uses_prep) {
      throw new Error("A piece that uses prep can't become prep.");
    }
    if (changes.category === 'piece' && (current.used_by_pieces || current.used_up_at)) {
      throw new Error("Prep that pieces used, or that's used up, can't become a piece.");
    }
    await database.runAsync(
      'UPDATE pieces SET name = ?, category = ?, notes = ?, photo_file_name = ? WHERE id = ?',
      changes.name,
      changes.category,
      changes.notes,
      changes.photoFileName,
      pieceId,
    );
  });
}

export async function deletePiece(pieceId: number): Promise<string | null> {
  const database = await getDb();
  let photoFileName: string | null = null;
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      'DELETE FROM prep_uses WHERE piece_id = ? OR prep_id = ?',
      pieceId,
      pieceId,
    );
    await database.runAsync('DELETE FROM work_segments WHERE piece_id = ?', pieceId);

    await database.runAsync('UPDATE pieces SET template_id = NULL WHERE template_id = ?', pieceId);
    const deleted = await database.getFirstAsync<{ photo_file_name: string | null }>(
      'DELETE FROM pieces WHERE id = ? RETURNING photo_file_name',
      pieceId,
    );
    if (!deleted) throw new Error('That piece no longer exists.');
    photoFileName = deleted.photo_file_name;
  });
  return photoFileName;
}

// A photo taken while the piece is still in hand, before Done. The caller removes the old
// photo's file.
export async function setPiecePhoto(pieceId: number, photoFileName: string | null): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync(
    'UPDATE pieces SET photo_file_name = ? WHERE id = ?',
    photoFileName,
    pieceId,
  );
  if (result.changes === 0) throw new Error('That piece no longer exists.');
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

export async function setPieceTemplate(pieceId: number, isTemplate: boolean): Promise<void> {
  const database = await getDb();
  const result = await database.runAsync(
    'UPDATE pieces SET is_template = ? WHERE id = ? AND finished_at IS NOT NULL',
    isTemplate ? 1 : 0,
    pieceId,
  );
  if (result.changes === 0) throw new Error('Only a finished piece can be a template.');
}

export async function getTemplates(): Promise<Template[]> {
  const database = await getDb();
  return database.getAllAsync<Template>(
    `SELECT id, name, category, photo_file_name FROM pieces
     WHERE is_template = 1 ORDER BY name COLLATE NOCASE`,
  );
}

// In the order the pieces were started, so rows don't move when you swap.
export async function getUnfinishedPieces(): Promise<UnfinishedPiece[]> {
  const database = await getDb();
  return database.getAllAsync<UnfinishedPiece>(
    `SELECT pieces.id, pieces.name, pieces.category, pieces.photo_file_name, pieces.template_id,
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
// way as on the piece's page, so the list and the page always match. Each prep's estimates are
// added up once, in one pass over prep_uses, and a piece that isn't prep has none to add.
export async function getPieces(): Promise<PieceListItem[]> {
  const database = await getDb();
  const usedPercentSql = 'coalesce(prep_totals.used_percent, 0)';
  const [pieces, usedPrep] = await Promise.all([
    database.getAllAsync<Omit<PieceListItem, 'prep_milliseconds' | 'prep_estimated'>>(
      `SELECT pieces.id, pieces.name, pieces.category, pieces.photo_file_name, pieces.finished_at,
         pieces.lost,
         round(total(julianday(coalesce(work_segments.ended_at, 'now'))
           - julianday(work_segments.started_at)) * 86400000) AS worked_milliseconds,
         ${usedPercentSql} AS used_percent,
         ${usedUpSql('pieces', usedPercentSql)} AS used_up
       FROM pieces
       JOIN work_segments ON work_segments.piece_id = pieces.id
       LEFT JOIN (
         SELECT prep_id, total(estimated_percent) AS used_percent FROM prep_uses GROUP BY prep_id
       ) AS prep_totals ON prep_totals.prep_id = pieces.id
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
    `SELECT id, name, category, notes, photo_file_name, finished_at, used_up_at, lost,
       is_template
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
