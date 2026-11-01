import type { SQLiteDatabase } from 'expo-sqlite';

import { getDb } from '@/db/database';

export type EntryKind = 'segment' | 'break';

export interface DayEntry {
  kind: EntryKind;
  id: number;
  piece_name: string | null;
  started_at: string;
  ended_at: string | null;
}

interface TimelineEntry {
  kind: EntryKind;
  id: number;
  piece_id: number | null;
  started_at: string;
  ended_at: string | null;
}

const tableByKind = { segment: 'work_segments', break: 'breaks' } as const;

// Entries that overlap startedAt to endedAt. A running entry runs until now, and entries
// that only touch at an end don't overlap.
function getOverlappingEntries(
  database: SQLiteDatabase,
  startedAt: string,
  endedAt: string,
  now: string,
) {
  return database.getAllAsync<TimelineEntry>(
    `SELECT * FROM (
       SELECT 'segment' AS kind, id, piece_id, started_at, ended_at FROM work_segments
       UNION ALL
       SELECT 'break' AS kind, id, NULL AS piece_id, started_at, ended_at FROM breaks
     )
     WHERE started_at < ? AND coalesce(ended_at, ?) > ?`,
    endedAt,
    now,
    startedAt,
  );
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
// database.
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
    await database.runAsync(
      `UPDATE ${tableByKind[kind]} SET started_at = ?, ended_at = ? WHERE id = ?`,
      startedAt,
      endedAt,
      id,
    );
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
