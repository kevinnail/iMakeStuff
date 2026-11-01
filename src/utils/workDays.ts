export interface TimeRange {
  started_at: string;
  ended_at: string | null;
}

export interface WorkDay {
  dayStart: number;
  firstStart: number;
  lastStop: number;
  worked: number;
  otherPieces: number;
  onBreak: number;
}

function startOfNextDay(milliseconds: number) {
  const date = new Date(milliseconds);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

export function startOfDay(milliseconds: number) {
  const date = new Date(milliseconds);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function overlap(range: TimeRange, from: number, to: number, now: number) {
  const start = Date.parse(range.started_at);
  const end = range.ended_at ? Date.parse(range.ended_at) : now;
  return Math.max(0, Math.min(end, to) - Math.max(start, from));
}

function totalOverlap(ranges: TimeRange[], from: number, to: number, now: number) {
  return ranges.reduce((total, range) => total + overlap(range, from, to, now), 0);
}

// Segments are split at local midnight into one entry per day, oldest first. For one piece,
// pass the other pieces' segments as otherSegments; for whole days, pass every segment and none.
export function getWorkDays(
  segments: TimeRange[],
  otherSegments: TimeRange[],
  breaks: TimeRange[],
  now: number,
): WorkDay[] {
  const worked = new Map<number, Pick<WorkDay, 'firstStart' | 'lastStop' | 'worked'>>();

  for (const segment of segments) {
    const end = segment.ended_at ? Date.parse(segment.ended_at) : now;
    let start = Date.parse(segment.started_at);
    while (start < end) {
      const stop = Math.min(end, startOfNextDay(start));
      const day = worked.get(startOfDay(start));
      if (day) {
        day.firstStart = Math.min(day.firstStart, start);
        day.lastStop = Math.max(day.lastStop, stop);
        day.worked += stop - start;
      } else {
        worked.set(startOfDay(start), { firstStart: start, lastStop: stop, worked: stop - start });
      }
      start = stop;
    }
  }

  return [...worked]
    .sort(([firstDay], [secondDay]) => firstDay - secondDay)
    .map(([dayStart, day]) => ({
      dayStart,
      ...day,
      otherPieces: totalOverlap(otherSegments, day.firstStart, day.lastStop, now),
      onBreak: totalOverlap(breaks, day.firstStart, day.lastStop, now),
    }));
}
