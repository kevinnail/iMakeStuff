import type { EntryKind } from '@/db/queries/entryQueries';

const hour = 60 * 60 * 1000;

// How long since the last touch before a running clock gets the Still working question.
const questionAfter: Record<EntryKind, number> = { segment: 6 * hour, break: hour };

interface TouchedEntry {
  kind: EntryKind;
  started_at: string;
  confirmed_at: string | null;
}

export function getLastTouch({ started_at, confirmed_at }: Omit<TouchedEntry, 'kind'>) {
  const startedAt = Date.parse(started_at);
  return confirmed_at ? Math.max(startedAt, Date.parse(confirmed_at)) : startedAt;
}

// Measured from the last touch, not the start, since total length can't tell a long session
// from a forgotten timer.
export function isQuestionDue(entry: TouchedEntry, now: number) {
  return now - getLastTouch(entry) >= questionAfter[entry.kind];
}
