import { getWorkDays, type TimeRange } from '@/utils/workDays';

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

  // Otherwise Days would show one piece's time instead of the whole day's work.
  it('combines every piece worked that day into one day', () => {
    const [day] = getWorkDays(
      [range(at(28, 9), at(28, 11)), range(at(28, 11), at(28, 12)), range(at(28, 13), at(28, 15))],
      [],
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

  // Otherwise a break left running when End day was tapped would count as break time.
  it('does not count a break after the last stop of the day', () => {
    const [day] = getWorkDays(
      [range(at(28, 9), at(28, 17))],
      [],
      [range(at(28, 17), at(28, 19))],
      at(31, 12),
    );

    expect(day).toMatchObject({ lastStop: at(28, 17), onBreak: 0 });
  });
});
