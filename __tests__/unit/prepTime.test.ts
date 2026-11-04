import { getPrepTime } from '@/utils/prepTime';

const hour = 60 * 60 * 1000;
const minute = 60 * 1000;
const second = 1000;

describe('getPrepTime', () => {
  // Otherwise a piece's page would show the wrong share of the time that went into its prep.
  it("gives each prep's worked time times the percent", () => {
    const { lines } = getPrepTime(hour, [
      { estimated_percent: 25, prep_worked_milliseconds: 4 * hour + 40 * minute },
    ]);

    expect(lines).toEqual([
      {
        estimated_percent: 25,
        prep_worked_milliseconds: 4 * hour + 40 * minute,
        milliseconds: hour + 10 * minute,
      },
    ]);
  });

  // Otherwise a piece that used two preps would show only one in its total.
  it('adds every prep into the prep total and the piece worked time into the total', () => {
    const { prep, total } = getPrepTime(3 * hour, [
      { estimated_percent: 25, prep_worked_milliseconds: 4 * hour },
      { estimated_percent: 50, prep_worked_milliseconds: 2 * hour },
    ]);

    expect(prep).toBe(2 * hour);
    expect(total).toBe(5 * hour);
  });

  // Otherwise lines of 3m and 1m would show a prep total of 5m, and the total wouldn't add up.
  it('rounds every part down to whole minutes before adding', () => {
    const { lines, prep, total } = getPrepTime(3 * minute + 40 * second, [
      { estimated_percent: 50, prep_worked_milliseconds: 7 * minute + 20 * second },
      { estimated_percent: 50, prep_worked_milliseconds: 3 * minute + 40 * second },
    ]);

    expect(lines.map((line) => line.milliseconds)).toEqual([3 * minute, minute]);
    expect(prep).toBe(4 * minute);
    expect(total).toBe(7 * minute);
  });

  // Otherwise a piece with no prep would show NaN in place of its worked time.
  it('gives no prep time for a piece with no prep', () => {
    expect(getPrepTime(hour, [])).toEqual({ lines: [], prep: 0, total: hour });
  });
});
