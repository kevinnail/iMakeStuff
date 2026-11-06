import { formatCost, getCost, parseCost } from '@/utils/cost';

const vaseId = 1;
const caneId = 2;

// A use of a supply as the database returns it. sharesTotal is every share of that supply.
function supplyUse(
  pieceId: number,
  costCents: number,
  [numerator, denominator]: [number, number],
  { usedUp = false, sharesTotal = numerator / denominator } = {},
) {
  return {
    piece_id: pieceId,
    supply_cost_cents: costCents,
    share_numerator: numerator,
    share_denominator: denominator,
    used_up: usedUp ? 1 : 0,
    shares_total: sharesTotal,
  };
}

// The vase's use of the cane.
function caneUse([numerator, denominator]: [number, number], usedUp = false) {
  return {
    prep_id: caneId,
    share_numerator: numerator,
    share_denominator: denominator,
    used_up: usedUp ? 1 : 0,
    shares_total: numerator / denominator,
  };
}

// The cane pulled from a whole $40 tube.
const wholeTube = supplyUse(caneId, 4000, [1, 1], { usedUp: true });

describe('getCost', () => {
  // Otherwise a piece made with an eighth of a cane wouldn't carry its share of the tube.
  it('gives a piece at 1/8 of a cane made from a whole $40 tube $5.00, estimated', () => {
    expect(getCost(vaseId, [caneUse([1, 8])], [wholeTube])).toMatchObject({
      cents: 500,
      estimated: true,
      hasSupplies: true,
    });
  });

  // Otherwise a pendant made from a rod with a bail would carry only one of the two.
  it('adds a supply used directly to the share of a prep', () => {
    const bail = supplyUse(vaseId, 300, [1, 1], { usedUp: true });

    const cost = getCost(vaseId, [caneUse([1, 8])], [wholeTube, bail]);

    expect(cost.supplyLines.map((line) => line.cents)).toEqual([300]);
    expect(cost.prepLines.map((line) => line.cents)).toEqual([500]);
    expect(cost.cents).toBe(800);
  });

  // Otherwise thirds of $10 would show lines of $3.33 that add up to a total of $3.34.
  it('rounds each line to the cent before adding', () => {
    const cost = getCost(
      vaseId,
      [],
      [supplyUse(vaseId, 1000, [1, 3]), supplyUse(vaseId, 1001, [1, 3])],
    );

    expect(cost.supplyLines.map((line) => line.cents)).toEqual([333, 334]);
    expect(cost.cents).toBe(667);
  });

  // Otherwise the leftover of a used-up supply, waste included, would be paid for by nobody.
  it('scales the shares of a used-up supply to the whole cost', () => {
    const quarter = supplyUse(vaseId, 4000, [1, 4], { usedUp: true, sharesTotal: 0.5 });

    expect(getCost(vaseId, [], [quarter])).toMatchObject({ cents: 2000, estimated: false });
  });

  // Otherwise the cost would read final while the cane behind it could still be cut.
  it('is estimated until the prep and every supply behind it are used up', () => {
    expect(getCost(vaseId, [caneUse([1, 8], true)], [wholeTube]).estimated).toBe(false);
    expect(
      getCost(
        vaseId,
        [caneUse([1, 8], true)],
        [supplyUse(caneId, 4000, [1, 2], { sharesTotal: 0.5 })],
      ).estimated,
    ).toBe(true);
  });

  // Otherwise a piece whose prep has no supplies would show a $0.00 cost marked estimated.
  it('has no supplies when neither the piece nor its prep used any', () => {
    expect(getCost(vaseId, [caneUse([1, 8])], [])).toEqual({
      supplyLines: [],
      prepLines: [expect.objectContaining({ cents: 0, estimated: false, hasSupplies: false })],
      cents: 0,
      estimated: false,
      hasSupplies: false,
    });
  });
});

describe('parseCost', () => {
  // Otherwise a cost typed the way a receipt reads would be refused or saved wrong.
  it.each([
    ['40', 4000],
    ['40.00', 4000],
    ['$40', 4000],
    ['12.5', 1250],
    ['0.99', 99],
    [' 7 ', 700],
    ['0', 0],
  ])('reads %p as %i cents', (text, cents) => {
    expect(parseCost(text)).toBe(cents);
  });

  // Otherwise a mistyped cost would save as a negative, a fraction of a cent, or nothing.
  it.each(['', 'abc', '-5', '1.234', '40.', '.5', '$'])('rejects %p', (text) => {
    expect(parseCost(text)).toBeNull();
  });
});

describe('formatCost', () => {
  // Otherwise a cost would show as cents, or without its cents column.
  it.each([
    [4000, '$40.00'],
    [1250, '$12.50'],
    [99, '$0.99'],
  ])('shows %i cents as %p', (cents, shown) => {
    expect(formatCost(cents)).toBe(shown);
  });
});
