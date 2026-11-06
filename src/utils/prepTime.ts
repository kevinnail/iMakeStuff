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

// What a piece took of a prep, typed as a whole percent ("13" or "13%") or a fraction ("1/8"),
// or null for anything else. It's kept as typed, so eight shares of 1/8 add up to exactly the prep.
export function parseAmount(text: string): Share | null {
  const match = /^(\d+)(?:\s*\/\s*(\d+)|\s*%)?$/.exec(text.trim());
  if (!match) return null;
  const share = {
    share_numerator: Number(match[1]),
    share_denominator: match[2] === undefined ? 100 : Number(match[2]),
  };
  return share.share_numerator >= 1 && share.share_numerator <= share.share_denominator
    ? share
    : null;
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
