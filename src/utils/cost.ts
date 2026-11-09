import {
  getActualShare,
  getShareValue,
  isEstimated,
  type Share,
  type UseShare,
  type UsesByPiece,
} from '@/utils/prepTime';

// A use of a supply by a piece or a prep, with the supply's cost as it is now.
export interface SupplyCostShare extends Share {
  piece_id: number;
  supply_cost_cents: number;
}

// A use of a prep by a piece or another prep. A counted use saved the prep's whole cost once
// nothing behind it was a guess; otherwise it's null and the cost is worked out as it is now.
export interface PrepCostShare extends UseShare {
  piece_id: number;
  prep_id: number;
  prep_cost_cents: number | null;
}

// What was paid for a supply, and how many came for it.
export interface SupplyPrice {
  cost_cents: number;
  case_count: number;
}

// A cost typed as dollars ("40", "40.00", "$40", "12.5") in cents, or null for anything else.
export function parseCost(text: string) {
  const match = /^\$?(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

// "$40.00"
export function formatCost(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

// How many came in a case: a whole number, 1 or more, or null for anything else.
export function parseCaseCount(text: string) {
  const count = /^\d+$/.test(text.trim()) ? Number(text) : 0;
  return count >= 1 ? count : null;
}

// "$15.00 each": the price of one from what was paid for the case.
export function formatEachCost(costCents: number, caseCount: number) {
  return `${formatCost(Math.round(costCents / caseCount))} each`;
}

// "$15.00", or "$15.00 each, case of 16 for $240.00" for a supply bought by the case.
export function formatSupplyPrice({ cost_cents, case_count }: SupplyPrice) {
  const each = formatEachCost(cost_cents, case_count);
  return case_count === 1
    ? formatCost(cost_cents)
    : `${each}, case of ${case_count} for ${formatCost(cost_cents)}`;
}

function sumCents(lines: { cents: number }[]) {
  return lines.reduce((total, line) => total + line.cents, 0);
}

// One piece's or prep's own supplies: each supply's cost times the share entered, to the cent.
function getSupplyLines<SupplyUse extends SupplyCostShare>(
  pieceId: number,
  supplyUses: UsesByPiece<SupplyUse>,
) {
  return (supplyUses.get(pieceId) ?? []).map((use) => ({
    ...use,
    cents: Math.round(use.supply_cost_cents * getShareValue(use)),
  }));
}

interface CostTotal {
  cents: number;
  estimated: boolean;
  hasSupplies: boolean;
}

// A prep's whole cost as it is now, worked out the same way as a piece's. getCost calls itself
// through this, since its own return type can't be inferred from a call to itself.
function getTotalCost(
  prepId: number,
  prepUses: UsesByPiece<PrepCostShare>,
  supplyUses: UsesByPiece<SupplyCostShare>,
): CostTotal {
  return getCost(prepId, prepUses, supplyUses);
}

// A piece's cost: its own supplies, plus its share of each prep's whole cost, which is the prep's
// own supplies and its share of the prep it was made from, all the way down. A counted use that
// saved the prep's cost uses that. Each line is rounded to the cent before adding, so the lines
// shown add up to the total. It's estimated while a by eye prep with supplies behind it is open
// (isEstimated). prepUses and supplyUses can hold other pieces' uses: the piece's own are its
// lines, and they have to hold the uses of every prep behind it.
export function getCost<SupplyUse extends SupplyCostShare, PrepUse extends PrepCostShare>(
  pieceId: number,
  prepUses: UsesByPiece<PrepUse>,
  supplyUses: UsesByPiece<SupplyUse>,
) {
  const supplyLines = getSupplyLines(pieceId, supplyUses);
  const prepLines = (prepUses.get(pieceId) ?? []).map((use) => {
    const prep: CostTotal =
      use.prep_cost_cents === null
        ? getTotalCost(use.prep_id, prepUses, supplyUses)
        : { cents: use.prep_cost_cents, estimated: false, hasSupplies: true };
    return {
      ...use,
      cents: Math.round(prep.cents * getActualShare(use)),
      estimated: prep.hasSupplies && (isEstimated(use) || prep.estimated),
      hasSupplies: prep.hasSupplies,
    };
  });
  return {
    supplyLines,
    prepLines,
    cents: sumCents(supplyLines) + sumCents(prepLines),
    estimated: prepLines.some((line) => line.estimated),
    hasSupplies: supplyLines.length > 0 || prepLines.some((line) => line.hasSupplies),
  };
}
