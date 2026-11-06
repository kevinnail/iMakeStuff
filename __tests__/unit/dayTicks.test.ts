import { getDayTicks } from '@/utils/dayTicks';
import type { TimeRange } from '@/utils/workDays';

// Times are built in local time, so the day lines up in any time zone.
function at(hours: number, minutes = 0) {
  return new Date(2026, 9, 28, hours, minutes).getTime();
}

function range(start: number, end: number | null): TimeRange {
  return {
    started_at: new Date(start).toISOString(),
    ended_at: end === null ? null : new Date(end).toISOString(),
  };
}

// The tick for the 10 minutes starting at the given time.
function tickIndex(hours: number, minutes = 0) {
  return (hours * 60 + minutes) / 10;
}

const dayStart = at(0);

describe('getDayTicks', () => {
  // Otherwise the row would have gaps or extra ticks, and the hours under it would drift.
  it('gives one tick per 10 minutes of the day', () => {
    const ticks = getDayTicks({ dayStart, firstStart: at(9), lastStop: at(10) }, [], [], at(23));

    expect(ticks).toHaveLength(144);
  });

  // Otherwise the taller hour ticks and the 6am, 12pm, and 6pm labels would sit at the wrong times.
  it('marks the tick that starts each hour with its hour', () => {
    const ticks = getDayTicks({ dayStart, firstStart: at(9), lastStop: at(10) }, [], [], at(23));

    expect(ticks[0].hour).toBe(0);
    expect(ticks[tickIndex(9)].hour).toBe(9);
    expect(ticks[tickIndex(9, 10)].hour).toBeNull();
    expect(ticks.filter((tick) => tick.hour !== null)).toHaveLength(24);
  });

  // Otherwise the row would mislabel the day: work as break, or time at home as shop time.
  it('colors work, breaks, time between, and time out of the shop', () => {
    const ticks = getDayTicks(
      { dayStart, firstStart: at(9), lastStop: at(15) },
      [range(at(9), at(12)), range(at(14), at(15))],
      [range(at(12), at(12, 30))],
      at(23),
    );

    expect(ticks[tickIndex(8, 50)].kind).toBe('none');
    expect(ticks[tickIndex(9)].kind).toBe('worked');
    expect(ticks[tickIndex(12)].kind).toBe('break');
    expect(ticks[tickIndex(13)].kind).toBe('other');
    expect(ticks[tickIndex(14)].kind).toBe('worked');
    expect(ticks[tickIndex(15)].kind).toBe('none');
  });

  // Otherwise a 4 minute break would paint its whole 10 minutes orange and overstate breaks.
  it('gives a tick to whatever took most of its 10 minutes', () => {
    const ticks = getDayTicks(
      { dayStart, firstStart: at(9), lastStop: at(10) },
      [range(at(9), at(9, 6)), range(at(9, 10), at(9, 14))],
      [range(at(9, 6), at(9, 10)), range(at(9, 14), at(9, 20))],
      at(23),
    );

    expect(ticks[tickIndex(9)].kind).toBe('worked');
    expect(ticks[tickIndex(9, 10)].kind).toBe('break');
  });

  // Otherwise a running piece would show as worked into the rest of the day.
  it('counts a running piece up to now', () => {
    const ticks = getDayTicks(
      { dayStart, firstStart: at(13), lastStop: at(14) },
      [range(at(13), null)],
      [],
      at(14),
    );

    expect(ticks[tickIndex(12, 50)].kind).toBe('none');
    expect(ticks[tickIndex(13)].kind).toBe('worked');
    expect(ticks[tickIndex(13, 50)].kind).toBe('worked');
    expect(ticks[tickIndex(14)].kind).toBe('none');
  });
});

describe('getDayTicks on daylight saving days', () => {
  const savedTimeZone = process.env.TZ;

  // New York's clocks go back at 2am on Nov 1, 2026 and forward at 2am on Mar 8, 2026.
  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });

  afterAll(() => {
    process.env.TZ = savedTimeZone;
  });

  // Otherwise the last hour of the day the clocks go back would have no ticks, hiding late work.
  it('gives the 25 hour day 150 ticks, with work up to midnight on the last one', () => {
    const fallBackStart = new Date(2026, 10, 1).getTime();
    const lateStart = new Date(2026, 10, 1, 23, 30).getTime();
    const midnight = new Date(2026, 10, 2).getTime();
    const ticks = getDayTicks(
      { dayStart: fallBackStart, firstStart: lateStart, lastStop: midnight },
      [range(lateStart, midnight)],
      [],
      midnight,
    );

    expect(ticks).toHaveLength(150);
    expect(ticks[149]).toEqual({ kind: 'worked', hour: null });
    expect(ticks.findIndex((tick) => tick.hour === 6)).toBe(7 * 6);
  });

  // Otherwise the day the clocks go forward would run 6 ticks into the next day, with its hours an hour late.
  it('gives the 23 hour day 138 ticks, with its hours where the clock says', () => {
    const springForwardStart = new Date(2026, 2, 8).getTime();
    const ticks = getDayTicks(
      {
        dayStart: springForwardStart,
        firstStart: springForwardStart,
        lastStop: springForwardStart,
      },
      [],
      [],
      springForwardStart,
    );

    expect(ticks).toHaveLength(138);
    expect(ticks.findIndex((tick) => tick.hour === 6)).toBe(5 * 6);
    expect(ticks.some((tick) => tick.hour === 2)).toBe(false);
  });
});
