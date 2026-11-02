// A month as calendar rows, Sunday first. Each square holds its day of the month, or null
// for the blank squares before the 1st and after the last day.
export function getMonthWeeks(year: number, month: number): (number | null)[][] {
  const leadingBlanks = new Date(year, month, 1).getDay();
  const dayCount = new Date(year, month + 1, 0).getDate();
  const squares: (number | null)[] = [
    ...Array<null>(leadingBlanks).fill(null),
    ...Array.from({ length: dayCount }, (_unused, index) => index + 1),
  ];
  while (squares.length % 7 !== 0) squares.push(null);

  const weeks: (number | null)[][] = [];
  for (let weekStart = 0; weekStart < squares.length; weekStart += 7) {
    weeks.push(squares.slice(weekStart, weekStart + 7));
  }
  return weeks;
}
