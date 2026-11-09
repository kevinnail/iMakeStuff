import {
  formatCost,
  formatSupplyPrice,
  getCost,
  parseCaseCount,
  parseCost,
  type PrepCostShare,
  type SupplyCostShare,
} from '@/utils/cost';
import { groupByPiece } from '@/utils/prepTime';

const vaseId = 1;
const caneId = 2;
// The prep behind the cane in tests of prep made from prep.
const pointsId = 3;

// A use of a supply as the database returns it.
function supplyUse(pieceId: number, costCents: number, [numerator, denominator]: [number, number]) {
  return {
    piece_id: pieceId,
    supply_cost_cents: costCents,
    share_numerator: numerator,
    share_denominator: denominator,
  };
}

// The vase's use of the cane. A counted cane is one made as parts, like 8 points, whose use
// saved the cane's whole cost.
function caneUse(
  [numerator, denominator]: [number, number],
  usedUp = false,
  measured = false,
  prepCostCents: number | null = null,
) {
  return {
    piece_id: vaseId,
    prep_id: caneId,
    share_numerator: numerator,
    share_denominator: denominator,
    used_up: usedUp ? 1 : 0,
    measured: measured ? 1 : 0,
    shares_total: numerator / denominator,
    prep_cost_cents: prepCostCents,
  };
}

// getCost with the uses grouped by piece, the way every caller passes them.
function costOf(pieceId: number, prepUses: PrepCostShare[], supplyUses: SupplyCostShare[]) {
  return getCost(pieceId, groupByPiece(prepUses), groupByPiece(supplyUses));
}

// The cane pulled from a whole $40 tube.
const wholeTube = supplyUse(caneId, 4000, [1, 1]);

describe('getCost', () => {
  // Otherwise a piece made with an eighth of a cane wouldn't carry its share of the tube.
  it('gives a piece at 1/8 of a cane made from a whole $40 tube $5.00, estimated', () => {
    expect(costOf(vaseId, [caneUse([1, 8])], [wholeTube])).toMatchObject({
      cents: 500,
      estimated: true,
      hasSupplies: true,
    });
  });

  // Otherwise a pendant made from a rod with a bail would carry only one of the two.
  it('adds a supply used directly to the share of a prep', () => {
    const bail = supplyUse(vaseId, 300, [1, 1]);

    const cost = costOf(vaseId, [caneUse([1, 8])], [wholeTube, bail]);

    expect(cost.supplyLines.map((line) => line.cents)).toEqual([300]);
    expect(cost.prepLines.map((line) => line.cents)).toEqual([500]);
    expect(cost.cents).toBe(800);
  });

  // Otherwise thirds of $10 would show lines of $3.33 that add up to a total of $3.34.
  it('rounds each line to the cent before adding', () => {
    const cost = costOf(
      vaseId,
      [],
      [supplyUse(vaseId, 1000, [1, 3]), supplyUse(vaseId, 1001, [1, 3])],
    );

    expect(cost.supplyLines.map((line) => line.cents)).toEqual([333, 334]);
    expect(cost.cents).toBe(667);
  });

  // Otherwise a rod's price would be marked a guess, or spread, instead of paid by its share.
  it('prices a supply used directly at its share of the cost, never estimated', () => {
    const quarter = supplyUse(vaseId, 4000, [1, 4]);

    expect(costOf(vaseId, [], [quarter])).toMatchObject({ cents: 1000, estimated: false });
  });

  // Otherwise the cost would read final while the cane behind it could still be cut.
  it('is estimated until the by eye prep behind it is used up', () => {
    expect(costOf(vaseId, [caneUse([1, 8])], [wholeTube]).estimated).toBe(true);
    expect(costOf(vaseId, [caneUse([1, 8], true)], [wholeTube]).estimated).toBe(false);
  });

  // Otherwise a piece made from points would show its cost as a guess while the points are open.
  it('is not estimated from an open counted prep', () => {
    expect(costOf(vaseId, [caneUse([1, 8], false, true)], [wholeTube])).toMatchObject({
      cents: 500,
      estimated: false,
    });
  });

  // Otherwise a new price for the tube would change what a piece made last month cost.
  it('prices a counted use from the prep cost saved with it, not its supplies today', () => {
    expect(costOf(vaseId, [caneUse([1, 8], false, true, 1500)], [wholeTube])).toMatchObject({
      cents: 188,
      estimated: false,
      hasSupplies: true,
    });
  });

  // Otherwise a cane made from points would leave out the tube the points were pulled from.
  it('carries the prep behind a prep: a quarter of a cane made from 2 of 8 points of a $15 tube', () => {
    const tube = supplyUse(pointsId, 1500, [1, 1]);
    const caneTakesTwoPoints = {
      ...caneUse([2, 8], false, true),
      piece_id: caneId,
      prep_id: pointsId,
    };

    expect(costOf(caneId, [caneTakesTwoPoints], [tube])).toMatchObject({ cents: 375 });
    expect(costOf(vaseId, [caneUse([1, 4]), caneTakesTwoPoints], [tube]).prepLines).toEqual([
      expect.objectContaining({ prep_id: caneId, cents: 94, estimated: true }),
    ]);
  });

  // Otherwise a piece made from counted beads would read final while the frit in them is a guess.
  it('is estimated while a by eye prep behind a counted one is open', () => {
    const frit = supplyUse(pointsId, 1000, [1, 1]);
    const beadsTakeHalfTheFrit = { ...caneUse([1, 2]), piece_id: caneId, prep_id: pointsId };

    expect(
      costOf(vaseId, [caneUse([2, 20], false, true), beadsTakeHalfTheFrit], [frit]),
    ).toMatchObject({ cents: 50, estimated: true });
  });

  // Otherwise a piece whose prep has no supplies would show a $0.00 cost marked estimated.
  it('has no supplies when neither the piece nor its prep used any', () => {
    expect(costOf(vaseId, [caneUse([1, 8])], [])).toEqual({
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

describe('parseCaseCount', () => {
  // Otherwise a case count typed as 16 wouldn't read, and Add would refuse it.
  it.each([
    ['16', 16],
    [' 4 ', 4],
    ['1', 1],
  ])('reads %p as %i', (text, count) => {
    expect(parseCaseCount(text)).toBe(count);
  });

  // Otherwise a case of 0, part of a tube, or nothing would divide the cost into a wrong price.
  it.each(['', '0', '1.5', '-2', 'abc'])('rejects %p', (text) => {
    expect(parseCaseCount(text)).toBeNull();
  });
});

describe('formatSupplyPrice', () => {
  // Otherwise a supply bought singly would read like a case of one.
  it('shows a supply bought singly as its cost', () => {
    expect(formatSupplyPrice({ cost_cents: 1500, case_count: 1 })).toBe('$15.00');
  });

  // Otherwise a case would show only what was paid, and the price of one would need a calculator.
  it('shows a case as the price of one, then the case', () => {
    expect(formatSupplyPrice({ cost_cents: 24000, case_count: 16 })).toBe(
      '$15.00 each, case of 16 for $240.00',
    );
    expect(formatSupplyPrice({ cost_cents: 25000, case_count: 16 })).toBe(
      '$15.63 each, case of 16 for $250.00',
    );
  });
});
