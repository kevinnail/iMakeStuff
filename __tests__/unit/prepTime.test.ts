import { getActualPercent, getPrepTime, parseAmount, type PrepShare } from '@/utils/prepTime';

const hour = 60 * 60 * 1000;
const minute = 60 * 1000;
const second = 1000;

// A prep's uses as the database returns them.
function getShares(estimates: number[], usedUp: boolean): PrepShare[] {
  const estimatesTotal = estimates.reduce((total, percent) => total + percent, 0);
  return estimates.map((percent) => ({
    estimated_percent: percent,
    prep_used_up: usedUp ? 1 : 0,
    estimates_total: estimatesTotal,
  }));
}

function getActualPercents(estimates: number[], usedUp = true) {
  return getShares(estimates, usedUp).map(getActualPercent);
}

function timeShare(estimatedPercent: number, prepWorkedMilliseconds: number, usedUp = false) {
  return {
    ...getShares([estimatedPercent], usedUp)[0],
    prep_worked_milliseconds: prepWorkedMilliseconds,
  };
}

describe('getActualPercent', () => {
  // Otherwise the part of a used-up cane nobody estimated, waste included, would count on no piece.
  it('scales estimates up to add to 100% once the prep is used up', () => {
    expect(getActualPercents([20, 20, 10])).toEqual([40, 40, 20]);
  });

  // Otherwise estimates that ran high would put more than the prep's time on its pieces.
  it('scales estimates that add past 100% down to 100%', () => {
    expect(getActualPercents([60, 60, 30])).toEqual([40, 40, 20]);
  });

  // Otherwise a piece that used a whole prep alone would get only its guess of it.
  it('gives a single use all of the prep', () => {
    expect(getActualPercents([30])).toEqual([100]);
  });

  // Otherwise a prep still in use would show made-up actual shares.
  it('keeps the estimates of a prep that is not used up', () => {
    expect(getActualPercents([25, 25], false)).toEqual([25, 25]);
  });
});

describe('getPrepTime', () => {
  // Otherwise a piece's page would show the wrong share of the time that went into its prep.
  it("gives each prep's worked time times the percent, marked estimated", () => {
    const { lines, estimated } = getPrepTime(hour, [timeShare(25, 4 * hour + 40 * minute)]);

    expect(lines).toEqual([
      expect.objectContaining({ percent: 25, estimated: true, milliseconds: hour + 10 * minute }),
    ]);
    expect(estimated).toBe(true);
  });

  // Otherwise a used-up prep would keep showing the piece's guess instead of its real share.
  it('uses the actual percent once the prep is used up', () => {
    const { lines, estimated } = getPrepTime(hour, [timeShare(25, 4 * hour, true)]);

    expect(lines).toEqual([
      expect.objectContaining({ percent: 100, estimated: false, milliseconds: 4 * hour }),
    ]);
    expect(estimated).toBe(false);
  });

  // Otherwise a piece that used two preps would show only one in its total.
  it('adds every prep into the prep total and the piece worked time into the total', () => {
    const { prep, total } = getPrepTime(3 * hour, [
      timeShare(25, 4 * hour),
      timeShare(50, 2 * hour),
    ]);

    expect(prep).toBe(2 * hour);
    expect(total).toBe(5 * hour);
  });

  // Otherwise lines of 3m and 1m would show a prep total of 5m, and the total wouldn't add up.
  it('rounds every part down to whole minutes before adding', () => {
    const { lines, prep, total } = getPrepTime(3 * minute + 40 * second, [
      timeShare(50, 7 * minute + 20 * second),
      timeShare(50, 3 * minute + 40 * second),
    ]);

    expect(lines.map((line) => line.milliseconds)).toEqual([3 * minute, minute]);
    expect(prep).toBe(4 * minute);
    expect(total).toBe(7 * minute);
  });

  // Otherwise a piece with no prep would show NaN in place of its worked time.
  it('gives no prep time for a piece with no prep', () => {
    expect(getPrepTime(hour, [])).toEqual({ lines: [], prep: 0, total: hour, estimated: false });
  });
});

describe('parseAmount', () => {
  // Otherwise a cane split into eighths or thirds couldn't be entered the way it was cut.
  it.each([
    ['1/2', 50],
    ['1/4', 25],
    ['1/8', 12],
    ['1/3', 33],
    ['2/3', 66],
    ['7/100', 7],
    [' 3 / 8 ', 37],
  ])('turns the fraction %s into %i%%', (text, percent) => {
    expect(parseAmount(text)).toBe(percent);
  });

  // Otherwise a cane cut into 16ths would reach 100% at the 15th piece and lock out the 16th.
  it('keeps every cut but the last of a prep split evenly under 100%', () => {
    for (let pieces = 2; pieces <= 100; pieces++) {
      expect((pieces - 1) * (parseAmount(`1/${pieces}`) ?? 0)).toBeLessThan(100);
    }
  });

  // Otherwise typing a plain percent would stop working.
  it.each([
    ['13', 13],
    ['100', 100],
  ])('keeps the whole percent %s', (text, percent) => {
    expect(parseAmount(text)).toBe(percent);
  });

  // Otherwise a mistyped amount would save no share, more than the whole prep, or a fraction of a percent.
  it.each(['', '0', '101', '12.5', '3/2', '1/0', '0/4', '1/200', 'abc', '1/'])(
    'rejects %p',
    (text) => {
      expect(parseAmount(text)).toBeNull();
    },
  );
});
