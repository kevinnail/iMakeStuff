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
  // 1 when the batch is counted: its shares are exact, so they're final and never scale.
  measured: number;
  // Every piece's share of it added together, 1 being all of it.
  shares_total: number;
}

// A use of a prep by a piece or another prep.
export interface PrepTimeShare extends UseShare {
  piece_id: number;
  prep_id: number;
  // The prep's own worked time as it is now, without the prep behind it.
  prep_worked_milliseconds: number;
}

const minute = 60 * 1000;

// Uses grouped by the piece or prep that made them, so each level of prep behind a piece finds its
// own uses in one lookup rather than a pass over every use.
export type UsesByPiece<Use> = ReadonlyMap<number, Use[]>;

export function groupByPiece<Use extends { piece_id: number }>(uses: Use[]): UsesByPiece<Use> {
  const groups = new Map<number, Use[]>();
  for (const use of uses) {
    const group = groups.get(use.piece_id);
    if (group) group.push(use);
    else groups.set(use.piece_id, [use]);
  }
  return groups;
}

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

// An amount in a count's unit: "1", "2.5", "1/3", or a whole number and a fraction, "1 1/2".
function parseUnitAmount(text: string): Fraction | null {
  const fractionMatch = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (!fractionMatch) return parseDecimal(text);
  const denominator = Number(fractionMatch[3]);
  return {
    numerator: Number(fractionMatch[1] ?? 0) * denominator + Number(fractionMatch[2]),
    denominator,
  };
}

// What a piece took of a prep, typed as a whole percent ("13" or "13%") or a fraction ("1/8"),
// or null for anything else. It's kept as typed, so eight shares of 1/8 add up to exactly the prep.
// With a count, a bare number or fraction is in the batch's unit: "1/3" of 8 points saves as
// 1/24, reduced, and more than the count is allowed, since a count only divides the cost. A
// percent is still a percent of the whole.
export function parseAmount(text: string, sizeAmount: number | null = null): Share | null {
  const trimmed = text.trim();
  if (sizeAmount !== null && !trimmed.endsWith('%')) {
    const amount = parseUnitAmount(trimmed);
    const size = parseDecimal(String(sizeAmount));
    if (!amount || !size || amount.numerator < 1 || amount.denominator < 1) return null;
    const share = reduce({
      numerator: amount.numerator * size.denominator,
      denominator: amount.denominator * size.numerator,
    });
    return { share_numerator: share.numerator, share_denominator: share.denominator };
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
// to three places ("2.5", "1"), otherwise a fraction ("1/3"), with its whole number past one
// ("2 1/3").
export function formatUnitAmount(share: Share, sizeAmount: number) {
  const size = parseDecimal(String(sizeAmount));
  if (!size) return String(getShareValue(share) * sizeAmount);
  const amount = reduce({
    numerator: share.share_numerator * size.numerator,
    denominator: share.share_denominator * size.denominator,
  });
  if (1000 % amount.denominator === 0) return String(amount.numerator / amount.denominator);
  const whole = Math.floor(amount.numerator / amount.denominator);
  const fraction = `${amount.numerator % amount.denominator}/${amount.denominator}`;
  return whole === 0 ? fraction : `${whole} ${fraction}`;
}

// A counted use kept at the parts it entered when its batch's count is corrected: 1 point of 8
// (1/8) becomes 1/10 once the count is fixed to 10. A count is always read from parseSize, so it
// has a decimal form.
export function rescaleShare(share: Share, oldCount: number, newCount: number): Share {
  const before = parseDecimal(String(oldCount))!;
  const after = parseDecimal(String(newCount))!;
  const scaled = reduce({
    numerator: share.share_numerator * before.numerator * after.denominator,
    denominator: share.share_denominator * before.denominator * after.numerator,
  });
  return { share_numerator: scaled.numerator, share_denominator: scaled.denominator };
}

// A use as it's shown: in the batch's unit when it's counted ("1/3 point"), a count from a case of
// supplies ("3"), otherwise as entered.
export function formatAmount(share: Share, { size_amount, size_unit }: BatchSize) {
  if (size_amount === null) return formatShare(share);
  const amount = formatUnitAmount(share, size_amount);
  return size_unit === null ? amount : `${amount} ${size_unit}`;
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

// Save as template, until it's tapped: pieces use counted prep through its template, and lost prep
// can't be used.
export function defaultsToTemplate(countedPrep: boolean, lost: boolean) {
  return countedPrep && !lost;
}

// A share is a guess while its batch is by eye and isn't all used yet.
export function isEstimated(use: UseShare) {
  return !use.used_up && !use.measured;
}

// Times show as whole minutes, rounded down.
function wholeMinutes(milliseconds: number) {
  return Math.floor(milliseconds / minute) * minute;
}

// A by eye batch, once all used, spreads all of it over what used it. A counted batch's shares
// are exact, so they never scale.
export function getActualShare(share: UseShare) {
  const estimate = getShareValue(share);
  return share.used_up && !share.measured ? estimate / share.shares_total : estimate;
}

interface TimeTotal {
  milliseconds: number;
  estimated: boolean;
}

// A piece's or prep's worked time plus its share of each prep it used, all the way down (a cane
// carries the points it was made from), not rounded. Estimated while any share behind it is a
// guess. uses has to hold the uses of every prep behind it.
export function getTotalTime(
  pieceId: number,
  worked: number,
  uses: UsesByPiece<PrepTimeShare>,
): TimeTotal {
  return (uses.get(pieceId) ?? []).reduce<TimeTotal>(
    (total, use) => {
      const prep = getTotalTime(use.prep_id, use.prep_worked_milliseconds, uses);
      return {
        milliseconds: total.milliseconds + prep.milliseconds * getActualShare(use),
        estimated: total.estimated || isEstimated(use) || prep.estimated,
      };
    },
    { milliseconds: worked, estimated: false },
  );
}

// A piece's prep lines and totals. uses can hold other pieces' uses: the piece's own are its
// lines, and the rest are the prep behind them.
export function getPrepTime<Use extends PrepTimeShare>(
  pieceId: number,
  worked: number,
  uses: UsesByPiece<Use>,
) {
  const lines = (uses.get(pieceId) ?? []).map((use) => {
    const share = getActualShare(use);
    const prep = getTotalTime(use.prep_id, use.prep_worked_milliseconds, uses);
    return {
      ...use,
      share,
      estimated: isEstimated(use) || prep.estimated,
      milliseconds: wholeMinutes(prep.milliseconds * share),
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
