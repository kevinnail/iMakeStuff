import { getMonthWeeks } from '@/utils/monthGrid';

describe('getMonthWeeks', () => {
  // Otherwise the 1st would sit under the wrong weekday and every date in the month would be off.
  it('starts the month on its weekday and ends with the last day', () => {
    // November 2026 starts on a Sunday and has 30 days.
    const weeks = getMonthWeeks(2026, 10);

    expect(weeks[0]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(weeks).toHaveLength(5);
    expect(weeks[4]).toEqual([29, 30, null, null, null, null, null]);
  });

  // Otherwise a month starting mid-week would put the 1st under Sunday.
  it('leaves blank squares before a mid-week 1st', () => {
    // October 2026 starts on a Thursday and has 31 days.
    const weeks = getMonthWeeks(2026, 9);

    expect(weeks[0]).toEqual([null, null, null, null, 1, 2, 3]);
    expect(weeks.flat().filter((day) => day !== null)).toHaveLength(31);
  });

  // Otherwise February in a leap year would lose its 29th.
  it('includes February 29 in a leap year only', () => {
    expect(getMonthWeeks(2028, 1).flat()).toContain(29);
    expect(getMonthWeeks(2027, 1).flat()).not.toContain(29);
  });
});
