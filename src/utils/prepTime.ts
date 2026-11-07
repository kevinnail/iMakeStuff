// A share of a prep or a supply as it was entered: "1/8" is 1 over 8, and "25" (a percent) is
// 25 over 100.
export interface Share {
  share_numerator: number;
  share_denominator: number;
}

// A use of a prep or a supply, with what's needed to scale its share once it's used up.
export interface UseShare extends Share {
  // 1 once the prep or supply is used up.
  used_up: number;
  // Every piece's share of it added together, 1 being all of it.
  shares_total: number;
}

export interface PrepTimeShare extends UseShare {
  prep_worked_milliseconds: number;
}

const minute = 60 * 1000;

// Ten shares of 1/10 add up to 0.9999999999999999, so shares this close to the whole prep or
// supply count as all of it. The SQL checks use the same number.
export const wholeShare = 1 - 1e-9;

export interface BatchSize {
  size_amount: number | null;
  size_unit: string | null;
}

export interface SizeInput {
  sizeAmount: number | null;
  sizeUnit: string | null;
}

interface Fraction {
  numerator: number;
  denominator: number;
}

function greatestCommonDivisor(first: number, second: number): number {
  return second === 0 ? first : greatestCommonDivisor(second, first % second);
}

function reduce({ numerator, denominator }: Fraction): Fraction {
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

// "2.5" as 25 over 10, so amounts and sizes with decimals stay exact fractions. Up to three
// decimal places.
function parseDecimal(text: string): Fraction | null {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text);
  if (!match) return null;
  const decimals = match[2] ?? '';
  return { numerator: Number(match[1] + decimals), denominator: 10 ** decimals.length };
}

// A size typed on a form, like "8" or "2.5", or null for anything else, including 0.
export function parseSize(text: string): number | null {
  const size = parseDecimal(text.trim());
  return size && size.numerator > 0 ? size.numerator / size.denominator : null;
}

// What a piece took of a prep, typed as a whole percent ("13" or "13%") or a fraction ("1/8"),
// or null for anything else. It's kept as typed, so eight shares of 1/8 add up to exactly the prep.
// With a size, a bare number or fraction is in the batch's unit: "1/3" of 8 points saves as
// 1/24, reduced. A percent is still a percent of the whole.
export function parseAmount(text: string, sizeAmount: number | null = null): Share | null {
  const trimmed = text.trim();
  if (sizeAmount !== null && !trimmed.endsWith('%')) {
    const fractionMatch = /^(\d+)\s*\/\s*(\d+)$/.exec(trimmed);
    const amount = fractionMatch
      ? { numerator: Number(fractionMatch[1]), denominator: Number(fractionMatch[2]) }
      : parseDecimal(trimmed);
    const size = parseDecimal(String(sizeAmount));
    if (!amount || !size || amount.numerator < 1 || amount.denominator < 1) return null;
    const share = reduce({
      numerator: amount.numerator * size.denominator,
      denominator: amount.denominator * size.numerator,
    });
    return share.numerator <= share.denominator
      ? { share_numerator: share.numerator, share_denominator: share.denominator }
      : null;
  }
  const match = /^(\d+)(?:\s*\/\s*(\d+)|\s*%)?$/.exec(trimmed);
  if (!match) return null;
  const share = {
    share_numerator: Number(match[1]),
    share_denominator: match[2] === undefined ? 100 : Number(match[2]),
  };
  return share.share_numerator >= 1 && share.share_numerator <= share.share_denominator
    ? share
    : null;
}

// A share as a number in the batch's unit, for the amount box: a decimal when it has one of up
// to three places ("2.5", "1"), otherwise a fraction ("1/3").
export function formatUnitAmount(share: Share, sizeAmount: number) {
  const size = parseDecimal(String(sizeAmount));
  if (!size) return String(getShareValue(share) * sizeAmount);
  const amount = reduce({
    numerator: share.share_numerator * size.numerator,
    denominator: share.share_denominator * size.denominator,
  });
  return 1000 % amount.denominator === 0
    ? String(amount.numerator / amount.denominator)
    : `${amount.numerator}/${amount.denominator}`;
}

// Every use of a batch added together, in its unit, to two decimal places at most: "3", "2.33".
export function formatUsedAmount(usedShare: number, sizeAmount: number) {
  return String(Number((usedShare * sizeAmount).toFixed(2)));
}

// A use as it's shown: in the batch's unit when it has a size ("1/3 point"), otherwise as entered.
export function formatAmount(share: Share, { size_amount, size_unit }: BatchSize) {
  return size_amount === null
    ? formatShare(share)
    : `${formatUnitAmount(share, size_amount)} ${size_unit}`;
}

export function getShareValue(share: Share) {
  return share.share_numerator / share.share_denominator;
}

// A share out of 100 shows as a percent, anything else as the fraction it was entered as.
export function formatShare(share: Share) {
  return share.share_denominator === 100
    ? `${share.share_numerator}%`
    : `${share.share_numerator}/${share.share_denominator}`;
}

// A worked-out share, such as what's left or an actual share, as a whole percent.
export function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function isUsedUp(sharesTotal: number) {
  return sharesTotal >= wholeShare;
}

// Shares past all of it, so marking it all used scales every share down. Exactly all of it
// scales nothing, with the same tolerance as isUsedUp.
export function isPastWhole(sharesTotal: number) {
  return sharesTotal - 1 > 1 - wholeShare;
}

// Times show as whole minutes, rounded down.
function wholeMinutes(milliseconds: number) {
  return Math.floor(milliseconds / minute) * minute;
}

export function getActualShare(share: UseShare) {
  const estimate = getShareValue(share);
  return share.used_up ? estimate / share.shares_total : estimate;
}

export function getPrepTime<Use extends PrepTimeShare>(worked: number, uses: Use[]) {
  const lines = uses.map((use) => {
    const share = getActualShare(use);
    return {
      ...use,
      share,
      estimated: !use.used_up,
      milliseconds: wholeMinutes(use.prep_worked_milliseconds * share),
    };
  });
  const prep = lines.reduce((total, line) => total + line.milliseconds, 0);
  return {
    lines,
    prep,
    total: wholeMinutes(worked) + prep,
    estimated: lines.some((line) => line.estimated),
  };
}
