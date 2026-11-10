import type { SQLiteDatabase } from 'expo-sqlite';

import { getDb } from '@/db/database';
import type { PieceCategory } from '@/db/queries/pieceQueries';
import { insertPrepUse, saveCountedCosts, type NewPrepUse } from '@/db/queries/prepQueries';
import { insertSupplyUse, type NewSupplyUse } from '@/db/queries/supplyQueries';
import type { SizeInput } from '@/utils/prepTime';
import { getLastTouch } from '@/utils/stillWorking';

export type EntryKind = 'segment' | 'break';

export interface DayEntry {
  kind: EntryKind;
  id: number;
  piece_name: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface RunningEntry {
  kind: EntryKind;
  id: number;
  // null for a break.
  piece_name: string | null;
  started_at: string;
  // When Still working was last tapped.
  confirmed_at: string | null;
}

export interface TimelineEntry {
  kind: EntryKind;
  id: number;
  piece_id: number | null;
  // null for a break.
  piece_name: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface PastWork {
  // Size is prep only, both or neither.
  piece: { name: string; category: PieceCategory; templateId: number | null } & SizeInput;
  startedAt: string;
  endedAt: string;
  photoFileName: string | null;
  finish: { notes: string | null; lost: boolean; isTemplate: boolean } | null;
  prepUses: NewPrepUse[];
  supplyUses: NewSupplyUse[];
}

const tableByKind = { segment: 'work_segments', break: 'breaks' } as const;

const pastFinishMessage = 'Time on a finished piece has to end by when it was finished.';

// Entries that overlap startedAt to endedAt, in time order. A running entry runs until now, and
// entries that only touch at an end don't overlap.
function getOverlappingEntries(
  database: SQLiteDatabase,
  startedAt: string,
  endedAt: string,
  now: string,
) {
  return database.getAllAsync<TimelineEntry>(
    `SELECT * FROM (
       SELECT 'segment' AS kind, work_segments.id, piece_id, pieces.name AS piece_name,
         work_segments.started_at, work_segments.ended_at
       FROM work_segments
       JOIN pieces ON pieces.id = work_segments.piece_id
       UNION ALL
       SELECT 'break' AS kind, id, NULL AS piece_id, NULL AS piece_name, started_at, ended_at
       FROM breaks
     )
     WHERE started_at < ? AND coalesce(ended_at, ?) > ?
     ORDER BY started_at`,
    endedAt,
    now,
    startedAt,
  );
}

// What a time being picked overlaps, so a form can name what's in the way before Save.
export async function getOverlaps(startedAt: string, endedAt: string): Promise<TimelineEntry[]> {
  const database = await getDb();
  return getOverlappingEntries(database, startedAt, endedAt, new Date().toISOString());
}

// Every segment and break that touches the day, in time order.
export async function getDayEntries(dayStart: string, nextDayStart: string): Promise<DayEntry[]> {
  const database = await getDb();
  return database.getAllAsync<DayEntry>(
    `SELECT * FROM (
       SELECT 'segment' AS kind, work_segments.id, pieces.name AS piece_name,
         work_segments.started_at, work_segments.ended_at
       FROM work_segments
       JOIN pieces ON pieces.id = work_segments.piece_id
       UNION ALL
       SELECT 'break' AS kind, id, NULL AS piece_name, started_at, ended_at FROM breaks
     )
     WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?)
     ORDER BY started_at`,
    nextDayStart,
    dayStart,
  );
}

// An end of null keeps a running entry running. An end before the start is rejected by the
// database, and a finished piece's segment can't end after the piece was finished.
export async function updateEntryTimes(
  kind: EntryKind,
  id: number,
  startedAt: string,
  endedAt: string | null,
): Promise<void> {
  const database = await getDb();
  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    const overlapping = await getOverlappingEntries(database, startedAt, endedAt ?? now, now);
    if (overlapping.some((entry) => entry.kind !== kind || entry.id !== id)) {
      throw new Error('That overlaps another entry.');
    }
    if (kind === 'break') {
      await database.runAsync(
        'UPDATE breaks SET started_at = ?, ended_at = ? WHERE id = ?',
        startedAt,
        endedAt,
        id,
      );
      return;
    }
    const updated = await database.runAsync(
      `UPDATE work_segments SET started_at = ?, ended_at = ?
       WHERE id = ? AND (SELECT finished_at IS NULL OR finished_at >= ? FROM pieces
         WHERE pieces.id = work_segments.piece_id)`,
      startedAt,
      endedAt,
      id,
      endedAt,
    );
    if (updated.changes > 0) return;
    // The failure needs its reason: no segment, or time past its piece's finish.
    const segment = await database.getFirstAsync('SELECT 1 FROM work_segments WHERE id = ?', id);
    if (!segment) throw new Error('That entry no longer exists.');
    throw new Error(pastFinishMessage);
  });
}

// A break added after the fact. One that falls inside a work segment splits the segment
// around it, which fixes a clock left running through lunch.
export async function addBreak(startedAt: string, endedAt: string): Promise<void> {
  const database = await getDb();
  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    const overlapping = await getOverlappingEntries(database, startedAt, endedAt, now);
    if (overlapping.some((entry) => entry.kind === 'break')) {
      throw new Error('That overlaps another break.');
    }
    if (overlapping.length > 1) {
      throw new Error('That break crosses more than one entry. Change their times first.');
    }
    const [segment] = overlapping;
    if (segment && (segment.started_at >= startedAt || (segment.ended_at ?? now) <= endedAt)) {
      throw new Error('A break has to fall inside the entry it interrupts.');
    }
    await database.runAsync(
      'INSERT INTO breaks (started_at, ended_at) VALUES (?, ?)',
      startedAt,
      endedAt,
    );
    if (!segment) return;
    await database.runAsync(
      'UPDATE work_segments SET ended_at = ? WHERE id = ?',
      startedAt,
      segment.id,
    );
    await database.runAsync(
      'INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES (?, ?, ?)',
      segment.piece_id,
      endedAt,
      segment.ended_at,
    );
  });
}

// A finished piece is finished at the work's end in the same insert, so the database's photo
// or description rule applies to it. Returns the new piece's id.
export async function addPastWork({
  piece,
  startedAt,
  endedAt,
  photoFileName,
  finish,
  prepUses,
  supplyUses,
}: PastWork): Promise<number> {
  const database = await getDb();
  const now = new Date().toISOString();
  // Set inside the transaction, which returns nothing itself.
  let pieceId = 0;
  await database.withTransactionAsync(async () => {
    const overlapping = await getOverlappingEntries(database, startedAt, endedAt, now);
    if (overlapping.length > 0) throw new Error('That overlaps another entry.');
    ({ lastInsertRowId: pieceId } = await database.runAsync(
      `INSERT INTO pieces (name, category, template_id, kind_id, photo_file_name, created_at,
         finished_at, notes, lost, is_template, size_amount, size_unit)
       VALUES (?, ?, ?, (SELECT coalesce(kind_id, id) FROM pieces WHERE id = ?), ?, ?, ?, ?, ?, ?,
         ?, ?)`,
      piece.name,
      piece.category,
      piece.templateId,
      piece.templateId,
      photoFileName,
      startedAt,
      finish ? endedAt : null,
      finish?.notes ?? null,
      finish?.lost ? 1 : 0,
      finish?.isTemplate ? 1 : 0,
      piece.sizeAmount,
      piece.sizeUnit,
    ));
    await database.runAsync(
      'INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES (?, ?, ?)',
      pieceId,
      startedAt,
      endedAt,
    );
    for (const use of prepUses) await insertPrepUse(database, pieceId, use);
    for (const use of supplyUses) await insertSupplyUse(database, pieceId, use);
    await saveCountedCosts(database);
  });
  return pieceId;
}

export async function addPieceTime(
  pieceId: number,
  startedAt: string,
  endedAt: string,
): Promise<void> {
  const database = await getDb();
  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    const overlapping = await getOverlappingEntries(database, startedAt, endedAt, now);
    if (overlapping.length > 0) throw new Error('That overlaps another entry.');
    const added = await database.runAsync(
      `INSERT INTO work_segments (piece_id, started_at, ended_at)
       SELECT id, ?, ? FROM pieces WHERE id = ? AND (finished_at IS NULL OR finished_at >= ?)`,
      startedAt,
      endedAt,
      pieceId,
      endedAt,
    );
    if (added.changes > 0) return;
    // The failure needs its reason: no piece, or time past its finish.
    const piece = await database.getFirstAsync('SELECT 1 FROM pieces WHERE id = ?', pieceId);
    if (!piece) throw new Error('That piece no longer exists.');
    throw new Error(pastFinishMessage);
  });
}

const alreadyStoppedMessage = "That's already stopped.";

// The piece or break that's running, for the Still working question. Only one runs at a time.
export async function getRunningEntry(): Promise<RunningEntry | null> {
  const database = await getDb();
  return database.getFirstAsync<RunningEntry>(
    `SELECT 'segment' AS kind, work_segments.id, pieces.name AS piece_name,
       work_segments.started_at, work_segments.confirmed_at
     FROM work_segments
     JOIN pieces ON pieces.id = work_segments.piece_id
     WHERE work_segments.ended_at IS NULL
     UNION ALL
     SELECT 'break' AS kind, id, NULL AS piece_name, started_at, confirmed_at FROM breaks
     WHERE ended_at IS NULL`,
  );
}

// Still working or Still on break: it keeps running, and the question waits from now.
export async function confirmRunningEntry(kind: EntryKind, id: number): Promise<void> {
  const database = await getDb();
  const confirmed = await database.runAsync(
    `UPDATE ${tableByKind[kind]} SET confirmed_at = ? WHERE id = ? AND ended_at IS NULL`,
    new Date().toISOString(),
    id,
  );
  if (confirmed.changes === 0) throw new Error(alreadyStoppedMessage);
}

export async function stopRunningEntry(
  kind: EntryKind,
  id: number,
  endedAt: string | null,
): Promise<void> {
  if (endedAt && Date.parse(endedAt) > Date.now()) {
    throw new Error("The end can't be later than now.");
  }
  const database = await getDb();
  const table = tableByKind[kind];
  await database.withTransactionAsync(async () => {
    const entry = await database.getFirstAsync<{ started_at: string; confirmed_at: string | null }>(
      `SELECT started_at, confirmed_at FROM ${table} WHERE id = ? AND ended_at IS NULL`,
      id,
    );
    if (!entry) throw new Error(alreadyStoppedMessage);
    const startedAt = Date.parse(entry.started_at);
    const end = endedAt ? Date.parse(endedAt) : getLastTouch(entry);
    if (end < startedAt) throw new Error("The end can't be before it started.");
    if (kind === 'break' && end === startedAt) {
      await database.runAsync(
        'UPDATE work_segments SET paused_by_break_id = NULL WHERE paused_by_break_id = ?',
        id,
      );
      await database.runAsync('DELETE FROM breaks WHERE id = ?', id);
      return;
    }
    await database.runAsync(
      `UPDATE ${table} SET ended_at = ? WHERE id = ?`,
      new Date(end).toISOString(),
      id,
    );
  });
}
