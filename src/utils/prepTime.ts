// A use of a prep, with what's needed to scale its estimate once the prep is used up.
export interface PrepShare {
  estimated_percent: number;
  // 1 once the prep is used up.
  prep_used_up: number;
  // Every piece's estimate on the prep added together.
  estimates_total: number;
}

export interface PrepTimeShare extends PrepShare {
  prep_worked_milliseconds: number;
}

const minute = 60 * 1000;

// What a piece took of a prep, typed as a whole percent ("13") or a fraction ("1/8"), as a whole
// percent from 1 to 100, or null for anything else. A fraction rounds down, so a prep split
// evenly never reaches 100% before its last cut is used; Used up then fills in what's left.
export function parseAmount(text: string) {
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(text.trim());
  const percent = fraction
    ? Math.floor((Number(fraction[1]) * 100) / Number(fraction[2]))
    : Number(text);
  return Number.isInteger(percent) && percent >= 1 && percent <= 100 ? percent : null;
}

// Times show as whole minutes, rounded down.
function wholeMinutes(milliseconds: number) {
  return Math.floor(milliseconds / minute) * minute;
}

// The share of a prep a piece really took. Until the prep is used up it's the estimate. After,
// the estimates scale to add up to 100%, so all of the prep's time lands on the pieces that
// used it, waste included.
export function getActualPercent(share: PrepShare) {
  if (!share.prep_used_up) return share.estimated_percent;
  return (share.estimated_percent * 100) / share.estimates_total;
}

// A piece's share of each prep's worked time (the prep's time times its actual percent), the
// prep total, and the piece's worked time plus prep. Each part is cut to whole minutes before
// it's added, so the lines shown add up to the totals shown.
export function getPrepTime<Use extends PrepTimeShare>(worked: number, uses: Use[]) {
  const lines = uses.map((use) => {
    const percent = getActualPercent(use);
    return {
      ...use,
      percent,
      estimated: !use.prep_used_up,
      milliseconds: wholeMinutes((use.prep_worked_milliseconds * percent) / 100),
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
