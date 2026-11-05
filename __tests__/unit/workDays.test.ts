import { getWholeDays, getWorkDays, type TimeRange } from '@/utils/workDays';

// Times are built in local time, so day boundaries line up in any time zone.
function at(day: number, hours: number, minutes = 0) {
  return new Date(2026, 9, day, hours, minutes).getTime();
}

function range(start: number, end: number | null): TimeRange {
  return {
    started_at: new Date(start).toISOString(),
    ended_at: end === null ? null : new Date(end).toISOString(),
  };
}

const hour = 60 * 60 * 1000;
const minute = 60 * 1000;

describe('getWorkDays', () => {
  // Otherwise a piece worked on two days would show as one long day with the night in it.
  it('gives a piece worked across two days one line per day', () => {
    const days = getWorkDays(
      [range(at(28, 9), at(28, 12)), range(at(29, 10), at(29, 11))],
      [],
      [],
      at(31, 12),
    );

    expect(days).toEqual([
      {
        dayStart: at(28, 0),
        firstStart: at(28, 9),
        lastStop: at(28, 12),
        worked: 3 * hour,
        otherPieces: 0,
        onBreak: 0,
      },
      {
        dayStart: at(29, 0),
        firstStart: at(29, 10),
        lastStop: at(29, 11),
        worked: hour,
        otherPieces: 0,
        onBreak: 0,
      },
    ]);
  });

  // Otherwise a piece being worked on right now would show no time for today.
  it('counts a running segment up to now', () => {
    const [today] = getWorkDays([range(at(31, 9), null)], [], [], at(31, 10, 30));

    expect(today).toMatchObject({ lastStop: at(31, 10, 30), worked: 90 * minute });
  });

  // Otherwise swapping pieces would look like slacking, or real breaks would be missed.
  it('counts time on other pieces and on break between the first start and last stop', () => {
    const [day] = getWorkDays(
      [range(at(28, 9), at(28, 10)), range(at(28, 14), at(28, 17))],
      [range(at(28, 10), at(28, 12))],
      [range(at(28, 12), at(28, 13))],
      at(31, 12),
    );

    expect(day).toEqual({
      dayStart: at(28, 0),
      firstStart: at(28, 9),
      lastStop: at(28, 17),
      worked: 4 * hour,
      otherPieces: 2 * hour,
      onBreak: hour,
    });
  });

  // Otherwise work on other pieces before this one started would count against it.
  it('ignores other pieces and breaks outside the first start and last stop', () => {
    const [day] = getWorkDays(
      [range(at(28, 13), at(28, 14)), range(at(28, 14, 30), at(28, 15))],
      [range(at(28, 8), at(28, 12)), range(at(28, 15), at(28, 18))],
      [range(at(28, 12), at(28, 13)), range(at(28, 14), at(28, 14, 30))],
      at(31, 12),
    );

    expect(day).toMatchObject({ otherPieces: 0, onBreak: 30 * minute });
  });

  // Otherwise working past midnight would put the whole stretch on the day it started.
  it('splits a segment that crosses midnight between the two days', () => {
    const days = getWorkDays([range(at(28, 23), at(29, 1))], [], [], at(31, 12));

    expect(days).toEqual([
      expect.objectContaining({ dayStart: at(28, 0), lastStop: at(29, 0), worked: hour }),
      expect.objectContaining({ dayStart: at(29, 0), firstStart: at(29, 0), worked: hour }),
    ]);
  });

  // Otherwise a break taken after the piece was set down for the day would count against it.
  it("does not count a break after the piece's last stop of the day", () => {
    const [day] = getWorkDays(
      [range(at(28, 9), at(28, 17))],
      [],
      [range(at(28, 17), at(28, 19))],
      at(31, 12),
    );

    expect(day).toMatchObject({ lastStop: at(28, 17), onBreak: 0 });
  });
});

describe('getWholeDays', () => {
  // Otherwise Days would show one piece's time instead of the whole day's work.
  it('combines every piece worked that day into one day', () => {
    const [day] = getWholeDays(
      [range(at(28, 9), at(28, 11)), range(at(28, 11), at(28, 12)), range(at(28, 13), at(28, 15))],
      [range(at(28, 12), at(28, 13))],
      at(31, 12),
    );

    expect(day).toEqual({
      dayStart: at(28, 0),
      firstStart: at(28, 9),
      lastStop: at(28, 15),
      worked: 5 * hour,
      otherPieces: 0,
      onBreak: hour,
    });
  });

  // Otherwise time in the shop on break before starting the first piece would go uncounted.
  it('starts the day at a break taken before the first piece', () => {
    const [day] = getWholeDays(
      [range(at(28, 10), at(28, 12))],
      [range(at(28, 9), at(28, 10))],
      at(31, 12),
    );

    expect(day).toEqual({
      dayStart: at(28, 0),
      firstStart: at(28, 9),
      lastStop: at(28, 12),
      worked: 2 * hour,
      otherPieces: 0,
      onBreak: hour,
    });
  });

  // Otherwise Today's Break would sit still during a break between pieces until the next one started.
  it('counts a break running after the last piece up to now', () => {
    const [day] = getWholeDays(
      [range(at(31, 9), at(31, 10))],
      [range(at(31, 10), null)],
      at(31, 10, 45),
    );

    expect(day).toMatchObject({ lastStop: at(31, 10, 45), worked: hour, onBreak: 45 * minute });
  });

  // Otherwise a Break tapped after the last piece and ended by End day would add hours of break to the day.
  it('does not count a break ended with no work after it', () => {
    const [day] = getWholeDays(
      [range(at(28, 9), at(28, 17))],
      [range(at(28, 17), at(28, 19))],
      at(31, 12),
    );

    expect(day).toMatchObject({ lastStop: at(28, 17), onBreak: 0 });
  });

  // Otherwise a break left running overnight would add a day of nothing but break before today.
  it('counts a forgotten running break only on today', () => {
    const days = getWholeDays([range(at(30, 9), at(30, 17))], [range(at(30, 17), null)], at(31, 8));

    expect(days).toEqual([
      expect.objectContaining({ dayStart: at(30, 0), lastStop: at(30, 17), onBreak: 0 }),
      expect.objectContaining({ dayStart: at(31, 0), worked: 0, onBreak: 8 * hour }),
    ]);
  });

  // Otherwise a day spent on break before any piece started wouldn't show up at all.
  it('gives a day with only a break no worked time', () => {
    const days = getWholeDays([], [range(at(31, 9), null)], at(31, 9, 30));

    expect(days).toEqual([
      {
        dayStart: at(31, 0),
        firstStart: at(31, 9),
        lastStop: at(31, 9, 30),
        worked: 0,
        otherPieces: 0,
        onBreak: 30 * minute,
      },
    ]);
  });
});
