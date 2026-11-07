import {
  formatShare,
  getActualShare,
  getPrepTime,
  parseAmount,
  isPastWhole,
  isUsedUp,
  type UseShare,
} from '@/utils/prepTime';

const hour = 60 * 60 * 1000;
const minute = 60 * 1000;
const second = 1000;

// A prep's uses as the database returns them, from shares written as "1/8" or "25".
function getShares(amounts: string[], usedUp: boolean): UseShare[] {
  const shares = amounts.map((amount) => parseAmount(amount)!);
  const sharesTotal = shares.reduce(
    (total, share) => total + share.share_numerator / share.share_denominator,
    0,
  );
  return shares.map((share) => ({
    ...share,
    used_up: usedUp ? 1 : 0,
    shares_total: sharesTotal,
  }));
}

// Actual shares as percents, so a test reads like the prep's page.
function getActualPercents(amounts: string[], usedUp = true) {
  return getShares(amounts, usedUp).map((share) => getActualShare(share) * 100);
}

function timeShare(amount: string, prepWorkedMilliseconds: number, usedUp = false) {
  return {
    ...getShares([amount], usedUp)[0],
    prep_worked_milliseconds: prepWorkedMilliseconds,
  };
}

describe('getActualShare', () => {
  // Otherwise the part of a used-up cane nobody estimated, waste included, would count on no piece.
  it('scales estimates up to add to 100% once the prep is used up', () => {
    expect(getActualPercents(['20', '20', '10'])).toEqual([40, 40, 20]);
  });

  // Otherwise estimates that ran high would put more than the prep's time on its pieces.
  it('scales estimates that add past 100% down to 100%', () => {
    expect(getActualPercents(['60', '60', '30'])).toEqual([40, 40, 20]);
  });

  // Otherwise a cane cut in eighths and quarters would split its time by the wrong amounts.
  it('scales fractions of a used-up prep: 1/8, 1/8, and 1/4 give 25%, 25%, and 50%', () => {
    expect(getActualPercents(['1/8', '1/8', '1/4'])).toEqual([25, 25, 50]);
  });

  // Otherwise a piece that used a whole prep alone would get only its guess of it.
  it('gives a single use all of the prep', () => {
    expect(getActualPercents(['30'])).toEqual([100]);
  });

  // Otherwise a prep still in use would show made-up actual shares.
  it('keeps the estimates of a prep that is not used up', () => {
    expect(getActualPercents(['25', '1/8'], false)).toEqual([25, 12.5]);
  });
});

describe('getPrepTime', () => {
  // Otherwise a piece's page would show the wrong share of the time that went into its prep.
  it("gives each prep's worked time times the share, marked estimated", () => {
    const { lines, estimated } = getPrepTime(hour, [timeShare('25', 4 * hour + 40 * minute)]);

    expect(lines).toEqual([
      expect.objectContaining({ share: 0.25, estimated: true, milliseconds: hour + 10 * minute }),
    ]);
    expect(estimated).toBe(true);
  });

  // Otherwise a piece that took 1/8 of a cane would carry a rounded share of its time.
  it('works from the fraction: 1/8 of 8h 40m is 1h 05m', () => {
    const { lines } = getPrepTime(hour, [timeShare('1/8', 8 * hour + 40 * minute)]);

    expect(lines[0].milliseconds).toBe(hour + 5 * minute);
  });

  // Otherwise a used-up prep would keep showing the piece's guess instead of its real share.
  it('uses the actual share once the prep is used up', () => {
    const { lines, estimated } = getPrepTime(hour, [timeShare('25', 4 * hour, true)]);

    expect(lines).toEqual([
      expect.objectContaining({ share: 1, estimated: false, milliseconds: 4 * hour }),
    ]);
    expect(estimated).toBe(false);
  });

  // Otherwise a piece that used two preps would show only one in its total.
  it('adds every prep into the prep total and the piece worked time into the total', () => {
    const { prep, total } = getPrepTime(3 * hour, [
      timeShare('25', 4 * hour),
      timeShare('1/2', 2 * hour),
    ]);

    expect(prep).toBe(2 * hour);
    expect(total).toBe(5 * hour);
  });

  // Otherwise lines of 3m and 1m would show a prep total of 5m, and the total wouldn't add up.
  it('rounds every part down to whole minutes before adding', () => {
    const { lines, prep, total } = getPrepTime(3 * minute + 40 * second, [
      timeShare('50', 7 * minute + 20 * second),
      timeShare('50', 3 * minute + 40 * second),
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

describe('parseAmount and formatShare', () => {
  // Otherwise a cane cut into eighths would save a rounded share and show a percent nobody typed.
  it.each([
    ['1/8', 1, 8, '1/8'],
    [' 3 / 8 ', 3, 8, '3/8'],
    ['1/3', 1, 3, '1/3'],
    ['2/16', 2, 16, '2/16'],
  ])('saves the fraction %p as %i/%i and shows it as %p', (text, numerator, denominator, shown) => {
    const share = parseAmount(text);

    expect(share).toEqual({ share_numerator: numerator, share_denominator: denominator });
    expect(formatShare(share!)).toBe(shown);
  });

  // Otherwise typing a plain percent would stop working, or show as a fraction out of 100.
  it.each([
    ['25', 25],
    ['25%', 25],
    ['100', 100],
  ])('saves the percent %p as %i/100 and shows it as a percent', (text, numerator) => {
    const share = parseAmount(text);

    expect(share).toEqual({ share_numerator: numerator, share_denominator: 100 });
    expect(formatShare(share!)).toBe(`${numerator}%`);
  });

  // Otherwise a mistyped amount would save no share or more than the whole prep.
  it.each(['', '0', '101', '12.5', '3/2', '1/0', '0/4', 'abc', '1/', '%'])('rejects %p', (text) => {
    expect(parseAmount(text)).toBeNull();
  });
});

describe('isUsedUp', () => {
  // Otherwise ten pieces at 1/10 would add to 0.9999999999999999 and leave the cane in use.
  it('counts shares that add to the whole prep in floating point as all of it', () => {
    const tenths = Array.from({ length: 10 }, () => 1 / 10).reduce((total, tenth) => total + tenth);

    expect(tenths).toBeLessThan(1);
    expect(isUsedUp(tenths)).toBe(true);
  });

  // Otherwise a cane with one eighth still on the bench would read as used up.
  it('leaves seven eighths in use', () => {
    expect(isUsedUp(7 / 8)).toBe(false);
  });
});

describe('isPastWhole', () => {
  // Otherwise a prep using a whole tube, or ten pieces at 1/10, would get a warning for an exact fit.
  it('counts exactly all of it, in floating point too, as not past it', () => {
    const tenths = Array.from({ length: 10 }, () => 1 / 10).reduce((total, tenth) => total + tenth);

    expect(isPastWhole(1)).toBe(false);
    expect(isPastWhole(tenths)).toBe(false);
  });

  // Otherwise estimates that run over would scale every share down without asking.
  it('counts 101% as past it', () => {
    expect(isPastWhole(1.01)).toBe(true);
  });
});
