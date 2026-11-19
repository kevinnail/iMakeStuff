import { parseCaseCount, parseCost } from '@/utils/cost';
import { parseAmount, parseSize } from '@/utils/prepTime';

export type MissingField =
  | 'name'
  | 'countNumber'
  | 'countUnit'
  | 'overlap'
  | 'cost'
  | 'caseCount'
  | 'sizeNumber'
  | 'sizeUnit'
  | 'item'
  | 'amount';

// The count's two boxes share countNumber's message, and the size's two share sizeNumber's.
export const missingMessages: Record<
  Exclude<MissingField, 'overlap' | 'amount' | 'countUnit' | 'sizeUnit'>,
  string
> = {
  name: 'Needs a name.',
  countNumber: "Enter how many it made, like 8 points, or tap I didn't count it.",
  cost: 'Enter a cost, like 40 or 12.50.',
  caseCount: 'Enter how many came in it, like 16.',
  sizeNumber: 'Enter the size of one, like 18 inches, or tap No size.',
  item: 'Choose one first.',
};

function listMissing(checks: Partial<Record<MissingField, boolean>>) {
  return (Object.keys(checks) as MissingField[]).filter((field) => checks[field]);
}

interface PieceForm {
  name: string;
  // The count boxes of counted prep, or null where the form asks for no count.
  countTexts: { amountText: string; unitText: string } | null;
}

// Add Work, the panel after Done, and a piece's Edit.
export function getPieceMissing({ name, countTexts }: PieceForm) {
  return listMissing({
    name: name.trim() === '',
    countNumber: countTexts !== null && parseSize(countTexts.amountText) === null,
    countUnit: countTexts !== null && countTexts.unitText.trim() === '',
  });
}

// Times that overlap an entry they can't. The pickers keep End from going before Start.
export function getOverlapMissing(overlapping: boolean) {
  return listMissing({ overlap: overlapping });
}

// countText: how many came in a case, or null when it was bought singly. sizeTexts: the size
// boxes, or null for a supply with no size.
export function getSupplyMissing(
  name: string,
  costText: string,
  countText: string | null,
  sizeTexts: { amountText: string; unitText: string } | null,
) {
  return listMissing({
    name: name.trim() === '',
    cost: parseCost(costText) === null,
    caseCount: countText !== null && parseCaseCount(countText) === null,
    sizeNumber: sizeTexts !== null && parseSize(sizeTexts.amountText) === null,
    sizeUnit: sizeTexts !== null && sizeTexts.unitText.trim() === '',
  });
}

// The use panel: a prep or supply picked, and how much of it the piece took.
export function getUseMissing(chosen: boolean, amountText: string, sizeAmount: number | null) {
  return listMissing({
    item: !chosen,
    amount: chosen && parseAmount(amountText, sizeAmount) === null,
  });
}
