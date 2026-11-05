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

export function startOfNextDay(milliseconds: number) {
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

type DaySpan = Pick<WorkDay, 'firstStart' | 'lastStop' | 'worked'>;

interface DayPart {
  dayStart: number;
  start: number;
  stop: number;
}

// A range cut at local midnight into its part on each day.
function splitAtMidnight(range: TimeRange, now: number): DayPart[] {
  const end = range.ended_at ? Date.parse(range.ended_at) : now;
  const parts: DayPart[] = [];
  for (let start = Date.parse(range.started_at); start < end; start = startOfNextDay(start)) {
    parts.push({ dayStart: startOfDay(start), start, stop: Math.min(end, startOfNextDay(start)) });
  }
  return parts;
}

// Widens the part's day to cover it, adding its worked time.
function addToDay(days: Map<number, DaySpan>, { dayStart, start, stop }: DayPart, worked: number) {
  const day = days.get(dayStart);
  if (day) {
    day.firstStart = Math.min(day.firstStart, start);
    day.lastStop = Math.max(day.lastStop, stop);
    day.worked += worked;
  } else {
    days.set(dayStart, { firstStart: start, lastStop: stop, worked });
  }
}

function spanSegments(segments: TimeRange[], now: number) {
  const days = new Map<number, DaySpan>();
  for (const segment of segments) {
    for (const part of splitAtMidnight(segment, now)) addToDay(days, part, part.stop - part.start);
  }
  return days;
}

function toWorkDays(
  days: Map<number, DaySpan>,
  otherSegments: TimeRange[],
  breaks: TimeRange[],
  now: number,
): WorkDay[] {
  return [...days]
    .sort(([firstDay], [secondDay]) => firstDay - secondDay)
    .map(([dayStart, day]) => ({
      dayStart,
      ...day,
      otherPieces: totalOverlap(otherSegments, day.firstStart, day.lastStop, now),
      onBreak: totalOverlap(breaks, day.firstStart, day.lastStop, now),
    }));
}

export function getWorkDays(
  segments: TimeRange[],
  otherSegments: TimeRange[],
  breaks: TimeRange[],
  now: number,
): WorkDay[] {
  return toWorkDays(spanSegments(segments, now), otherSegments, breaks, now);
}

// Whole days, oldest first. A break counts toward its day when work follows it that day (one
// before the first piece or between pieces), or while it's still running today. A break ended
// by End day with no work after it isn't break time, and a forgotten break doesn't make
// earlier days out of the nights it ran through.
export function getWholeDays(segments: TimeRange[], breaks: TimeRange[], now: number): WorkDay[] {
  const days = spanSegments(segments, now);
  const lastWorkStarts = new Map<number, number>();
  for (const segment of segments) {
    for (const { dayStart, start } of splitAtMidnight(segment, now)) {
      lastWorkStarts.set(dayStart, Math.max(start, lastWorkStarts.get(dayStart) ?? start));
    }
  }
  const today = startOfDay(now);
  for (const onBreak of breaks) {
    for (const part of splitAtMidnight(onBreak, now)) {
      const lastWorkStart = lastWorkStarts.get(part.dayStart);
      const workFollows = lastWorkStart !== undefined && part.stop <= lastWorkStart;
      const runningToday = onBreak.ended_at === null && part.dayStart === today;
      if (workFollows || runningToday) addToDay(days, part, 0);
    }
  }
  return toWorkDays(days, [], breaks, now);
}
