import {
  defaultsToTemplate,
  formatAmount,
  formatShare,
  formatUnitAmount,
  parseSize,
  getActualShare,
  getPrepTime,
  groupByPiece,
  parseAmount,
  rescaleShare,
  type PrepTimeShare,
  type UseShare,
} from '@/utils/prepTime';

const hour = 60 * 60 * 1000;
const minute = 60 * 1000;
const second = 1000;

describe('defaultsToTemplate', () => {
  // Otherwise counted prep couldn't be picked by any piece until its page was opened.
  it('is on for counted prep that came out good', () => {
    expect(defaultsToTemplate(true, false)).toBe(true);
  });

  // Otherwise a cracked batch would be offered on the Work screen as something to make again.
  it('is off for lost counted prep', () => {
    expect(defaultsToTemplate(true, true)).toBe(false);
  });

  // Otherwise every piece and by eye prep would fill the template list.
  it('is off for anything not counted prep', () => {
    expect(defaultsToTemplate(false, false)).toBe(false);
  });
});

// A prep's uses as the database returns them, from shares written as "1/8" or "25". A counted
// prep is one made as parts, like 8 points.
function getShares(amounts: string[], usedUp: boolean, measured = false): UseShare[] {
  const shares = amounts.map((amount) => parseAmount(amount)!);
  const sharesTotal = shares.reduce(
    (total, share) => total + share.share_numerator / share.share_denominator,
    0,
  );
  return shares.map((share) => ({
    ...share,
    used_up: usedUp ? 1 : 0,
    measured: measured ? 1 : 0,
    shares_total: sharesTotal,
  }));
}

// Actual shares as percents, so a test reads like the prep's page.
function getActualPercents(amounts: string[], usedUp = true) {
  return getShares(amounts, usedUp).map((share) => getActualShare(share) * 100);
}

// The vase, and the preps behind it.
const vaseId = 1;
const caneId = 2;
const pointsId = 3;

// A use of a prep, by the vase unless another piece or prep is given.
function timeShare(
  amount: string,
  prepWorkedMilliseconds: number,
  usedUp = false,
  measured = false,
  { pieceId = vaseId, prepId = caneId } = {},
) {
  return {
    ...getShares([amount], usedUp, measured)[0],
    piece_id: pieceId,
    prep_id: prepId,
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

  // Otherwise the points other pieces took would change the share of every piece made from them.
  it('keeps the shares of a counted prep as entered, whatever they add up to', () => {
    const shares = getShares(['1/8', '1/8', '1/4'], true, true);

    expect(shares.map((share) => getActualShare(share) * 100)).toEqual([12.5, 12.5, 25]);
  });
});

// getPrepTime with the uses grouped by piece, the way every caller passes them.
function prepTimeOf<Use extends PrepTimeShare>(pieceId: number, worked: number, uses: Use[]) {
  return getPrepTime(pieceId, worked, groupByPiece(uses));
}

describe('getPrepTime', () => {
  // Otherwise a piece's page would show the wrong share of the time that went into its prep.
  it("gives each prep's worked time times the share, marked estimated", () => {
    const { lines, estimated } = prepTimeOf(vaseId, hour, [
      timeShare('25', 4 * hour + 40 * minute),
    ]);

    expect(lines).toEqual([
      expect.objectContaining({ share: 0.25, estimated: true, milliseconds: hour + 10 * minute }),
    ]);
    expect(estimated).toBe(true);
  });

  // Otherwise a piece that took 1/8 of a cane would carry a rounded share of its time.
  it('works from the fraction: 1/8 of 8h 40m is 1h 05m', () => {
    const { lines } = prepTimeOf(vaseId, hour, [timeShare('1/8', 8 * hour + 40 * minute)]);

    expect(lines[0].milliseconds).toBe(hour + 5 * minute);
  });

  // Otherwise a used-up prep would keep showing the piece's guess instead of its real share.
  it('uses the actual share once the prep is used up', () => {
    const { lines, estimated } = prepTimeOf(vaseId, hour, [timeShare('25', 4 * hour, true)]);

    expect(lines).toEqual([
      expect.objectContaining({ share: 1, estimated: false, milliseconds: 4 * hour }),
    ]);
    expect(estimated).toBe(false);
  });

  // Otherwise a piece made from points would show its prep time as a guess when it's exact.
  it('marks a share of a counted prep as not estimated', () => {
    const { lines, estimated } = prepTimeOf(vaseId, hour, [
      timeShare('1/8', 8 * hour, false, true),
    ]);

    expect(lines).toEqual([
      expect.objectContaining({ share: 0.125, estimated: false, milliseconds: hour }),
    ]);
    expect(estimated).toBe(false);
  });

  // Otherwise a piece that used two preps would show only one in its total.
  it('adds every prep into the prep total and the piece worked time into the total', () => {
    const { prep, total } = prepTimeOf(vaseId, 3 * hour, [
      timeShare('25', 4 * hour),
      timeShare('1/2', 2 * hour),
    ]);

    expect(prep).toBe(2 * hour);
    expect(total).toBe(5 * hour);
  });

  // Otherwise lines of 3m and 1m would show a prep total of 5m, and the total wouldn't add up.
  it('rounds every part down to whole minutes before adding', () => {
    const { lines, prep, total } = prepTimeOf(vaseId, 3 * minute + 40 * second, [
      timeShare('50', 7 * minute + 20 * second),
      timeShare('50', 3 * minute + 40 * second),
    ]);

    expect(lines.map((line) => line.milliseconds)).toEqual([3 * minute, minute]);
    expect(prep).toBe(4 * minute);
    expect(total).toBe(7 * minute);
  });

  // Otherwise a piece using a cane made from points would leave out the time pulling the points.
  it('carries the prep behind a prep: a quarter of a 30m cane made from 2 of 8 points pulled in 40m', () => {
    const { lines, estimated } = prepTimeOf(vaseId, hour, [
      timeShare('25', 30 * minute),
      timeShare('2/8', 40 * minute, false, true, { pieceId: caneId, prepId: pointsId }),
    ]);

    expect(lines).toEqual([
      expect.objectContaining({ prep_id: caneId, estimated: true, milliseconds: 10 * minute }),
    ]);
    expect(estimated).toBe(true);
  });

  // Otherwise a piece made from counted beads would show exact time while the frit in them is a guess.
  it('is estimated while a by eye prep behind a counted one is open', () => {
    const { lines } = prepTimeOf(vaseId, hour, [
      timeShare('1/20', 20 * minute, false, true),
      timeShare('50', 40 * minute, false, false, { pieceId: caneId, prepId: pointsId }),
    ]);

    expect(lines[0]).toMatchObject({ estimated: true, milliseconds: 2 * minute });
  });

  // Otherwise a piece with no prep would show NaN in place of its worked time.
  it('gives no prep time for a piece with no prep', () => {
    expect(prepTimeOf(vaseId, hour, [])).toEqual({
      lines: [],
      prep: 0,
      total: hour,
      estimated: false,
    });
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

describe('amounts in a batch unit', () => {
  // Otherwise a third of one of 8 points would need dividing in your head mid-work.
  it('saves "1/3" of an 8 point batch as 1/24 and shows it back as 1/3 point', () => {
    const share = parseAmount('1/3', 8);

    expect(share).toEqual({ share_numerator: 1, share_denominator: 24 });
    expect(formatAmount(share!, { size_amount: 8, size_unit: 'point' })).toBe('1/3 point');
  });

  // Otherwise a fiber artist weighing roving couldn't enter grams with a decimal.
  it('saves "2.5" of a 500 g batch as 1/200 and shows it back as 2.5 g', () => {
    const share = parseAmount('2.5', 500);

    expect(share).toEqual({ share_numerator: 1, share_denominator: 200 });
    expect(formatAmount(share!, { size_amount: 500, size_unit: 'g' })).toBe('2.5 g');
  });

  // Otherwise a quick percent guess on a sized batch would be read as 25 points.
  it('saves "25%" of a sized batch as 25/100, shown in its unit', () => {
    const share = parseAmount('25%', 8);

    expect(share).toEqual({ share_numerator: 25, share_denominator: 100 });
    expect(formatUnitAmount(share!, 8)).toBe('2');
  });

  // Otherwise batches with no size would change what "1/8" means.
  it('still reads "1/8" as an eighth of a batch with no size', () => {
    expect(parseAmount('1/8')).toEqual({ share_numerator: 1, share_denominator: 8 });
    expect(
      formatAmount(
        { share_numerator: 1, share_denominator: 8 },
        { size_amount: null, size_unit: null },
      ),
    ).toBe('1/8');
  });

  // Otherwise a bubbler on 1 1/2 points couldn't be entered without working out 3/16 by hand.
  it('reads "1 1/2" as 3/2 of a part, and shows "2 1/3" back the way it was typed', () => {
    expect(parseAmount('1 1/2', 1)).toEqual({ share_numerator: 3, share_denominator: 2 });

    const share = parseAmount('2 1/3', 8);
    expect(share).toEqual({ share_numerator: 7, share_denominator: 24 });
    expect(formatAmount(share!, { size_amount: 8, size_unit: 'points' })).toBe('2 1/3 points');
  });

  // Otherwise a big piece that took more points than one tube made would be refused.
  it('takes more parts than the count, since the count only divides the cost', () => {
    expect(parseAmount('12', 8)).toEqual({ share_numerator: 3, share_denominator: 2 });
  });

  // Otherwise a use could claim none of a batch, or save text as an amount.
  it('rejects zero, a fraction with 0 at the bottom, and text', () => {
    expect(parseAmount('0', 8)).toBeNull();
    expect(parseAmount('1 1/0', 8)).toBeNull();
    expect(parseAmount('half', 8)).toBeNull();
  });

  // Otherwise a size of 0 would divide by zero, and "2.5 lb" couldn't be entered.
  it('reads a size with decimals and rejects 0 and text', () => {
    expect(parseSize('2.5')).toBe(2.5);
    expect(parseSize('0')).toBeNull();
    expect(parseSize('lots')).toBeNull();
  });

  // Otherwise correcting a count would change how many parts each piece entered.
  it('keeps the parts entered when a count is corrected, decimals included', () => {
    expect(rescaleShare({ share_numerator: 1, share_denominator: 8 }, 8, 10)).toEqual({
      share_numerator: 1,
      share_denominator: 10,
    });

    const third = parseAmount('1/3', 8)!;
    const corrected = rescaleShare(third, 8, 2.5);
    expect(formatAmount(corrected, { size_amount: 2.5, size_unit: 'lb' })).toBe('1/3 lb');
  });
});
