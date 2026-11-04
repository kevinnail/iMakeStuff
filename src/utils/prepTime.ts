export interface PrepShare {
  estimated_percent: number;
  prep_worked_milliseconds: number;
}

const minute = 60 * 1000;

// Times show as whole minutes, rounded down.
function wholeMinutes(milliseconds: number) {
  return Math.floor(milliseconds / minute) * minute;
}

// A piece's share of each prep's worked time (the prep's time times the percent), the prep
// total, and the piece's worked time plus prep. Each part is cut to whole minutes before it's
// added, so the lines shown add up to the totals shown.
export function getPrepTime<Use extends PrepShare>(worked: number, uses: Use[]) {
  const lines = uses.map((use) => ({
    ...use,
    milliseconds: wholeMinutes((use.prep_worked_milliseconds * use.estimated_percent) / 100),
  }));
  const prep = lines.reduce((total, line) => total + line.milliseconds, 0);
  return { lines, prep, total: wholeMinutes(worked) + prep };
}
