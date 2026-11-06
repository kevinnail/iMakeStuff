import { startOfNextDay, totalOverlap, type TimeRange, type WorkDay } from '@/utils/workDays';

export type TickKind = 'worked' | 'break' | 'other' | 'none';

export interface Tick {
  kind: TickKind;
  // The clock hour it starts, when it starts one, for the taller hour ticks and the labels.
  hour: number | null;
}

const minute = 60 * 1000;
export const tickLength = 10 * minute;

// What each 10 minutes of the day was: worked, break, other time in the shop, or not in the
// shop, whichever took most of it. A tie goes to worked, then break. The day runs to the next
// midnight, so a daylight saving day has an hour more or less of ticks.
export function getDayTicks(
  day: Pick<WorkDay, 'dayStart' | 'firstStart' | 'lastStop'>,
  segments: TimeRange[],
  breaks: TimeRange[],
  now: number,
): Tick[] {
  const tickCount = (startOfNextDay(day.dayStart) - day.dayStart) / tickLength;
  return Array.from({ length: tickCount }, (_unused, index) => {
    const start = day.dayStart + index * tickLength;
    const end = start + tickLength;
    const inShop = Math.max(0, Math.min(end, day.lastStop) - Math.max(start, day.firstStart));
    const worked = totalOverlap(segments, start, end, now);
    const onBreak = totalOverlap(breaks, start, end, now);
    const shares: [TickKind, number][] = [
      ['worked', worked],
      ['break', onBreak],
      ['other', inShop - worked - onBreak],
      ['none', tickLength - inShop],
    ];
    const startTime = new Date(start);
    return {
      kind: shares.reduce((largest, share) => (share[1] > largest[1] ? share : largest))[0],
      hour: startTime.getMinutes() === 0 ? startTime.getHours() : null,
    };
  });
}
