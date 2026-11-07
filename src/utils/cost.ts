import { getActualShare, isEstimated, type UseShare } from '@/utils/prepTime';

// A use of a supply by a piece or a prep, with the supply's cost.
export interface SupplyCostShare extends UseShare {
  piece_id: number;
  supply_cost_cents: number;
}

// A use of a prep by a piece.
export interface PrepCostShare extends UseShare {
  prep_id: number;
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

function sumCents(lines: { cents: number }[]) {
  return lines.reduce((total, line) => total + line.cents, 0);
}

// One piece's or prep's own supplies: each supply's cost times its actual share, to the cent.
function getSupplyLines<SupplyUse extends SupplyCostShare>(
  pieceId: number,
  supplyUses: SupplyUse[],
) {
  return supplyUses
    .filter((use) => use.piece_id === pieceId)
    .map((use) => ({
      ...use,
      estimated: isEstimated(use),
      cents: Math.round(use.supply_cost_cents * getActualShare(use)),
    }));
}

// A piece's cost: its own supplies, plus its share of each prep's cost, the prep's own supplies
// worked out the same way. Each line is rounded to the cent before adding, so the lines shown
// add up to the total. It's estimated while any batch behind it is estimated (isEstimated).
// supplyUses has to hold the supplies of every prep in prepUses.
export function getCost<SupplyUse extends SupplyCostShare, PrepUse extends PrepCostShare>(
  pieceId: number,
  prepUses: PrepUse[],
  supplyUses: SupplyUse[],
) {
  const supplyLines = getSupplyLines(pieceId, supplyUses);
  const prepLines = prepUses.map((use) => {
    const prepSupplies = getSupplyLines(use.prep_id, supplyUses);
    const hasSupplies = prepSupplies.length > 0;
    return {
      ...use,
      cents: Math.round(sumCents(prepSupplies) * getActualShare(use)),
      estimated: hasSupplies && (isEstimated(use) || prepSupplies.some((line) => line.estimated)),
      hasSupplies,
    };
  });
  return {
    supplyLines,
    prepLines,
    cents: sumCents(supplyLines) + sumCents(prepLines),
    estimated: [...supplyLines, ...prepLines].some((line) => line.estimated),
    hasSupplies: supplyLines.length > 0 || prepLines.some((line) => line.hasSupplies),
  };
}
