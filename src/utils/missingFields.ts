import { parseCost } from '@/utils/cost';
import { parseAmount, parseSize } from '@/utils/prepTime';

export type MissingField =
  'name' | 'identity' | 'countNumber' | 'countUnit' | 'overlap' | 'cost' | 'item' | 'amount';

export const missingMessages: Record<Exclude<MissingField, 'overlap' | 'amount'>, string> = {
  name: 'Needs a name.',
  identity: 'Needs a photo or notes, so you can tell later which one it was.',
  countNumber: "Enter how many it made, like 8 points, or tap I didn't count it.",
  countUnit: "Enter how many it made, like 8 points, or tap I didn't count it.",
  cost: 'Enter a cost, like 40 or 12.50.',
  item: 'Choose one first.',
};

function listMissing(checks: Partial<Record<MissingField, boolean>>) {
  return (Object.keys(checks) as MissingField[]).filter((field) => checks[field]);
}

interface PieceForm {
  name: string;
  finished: boolean;
  hasPhoto: boolean;
  notes: string;
  // The count boxes of counted prep, or null where the form asks for no count.
  countTexts: { amountText: string; unitText: string } | null;
}

// Add Work, the panel after Done, and a piece's Edit.
export function getPieceMissing({ name, finished, hasPhoto, notes, countTexts }: PieceForm) {
  return listMissing({
    name: name.trim() === '',
    identity: finished && !hasPhoto && notes.trim() === '',
    countNumber: countTexts !== null && parseSize(countTexts.amountText) === null,
    countUnit: countTexts !== null && countTexts.unitText.trim() === '',
  });
}

// Times that overlap an entry they can't. The pickers keep End from going before Start.
export function getOverlapMissing(overlapping: boolean) {
  return listMissing({ overlap: overlapping });
}

export function getSupplyMissing(name: string, costText: string) {
  return listMissing({ name: name.trim() === '', cost: parseCost(costText) === null });
}

// The use panel: a prep or supply picked, and how much of it the piece took.
export function getUseMissing(chosen: boolean, amountText: string, sizeAmount: number | null) {
  return listMissing({
    item: !chosen,
    amount: chosen && parseAmount(amountText, sizeAmount) === null,
  });
}
