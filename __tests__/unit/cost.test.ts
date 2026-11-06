import { formatCost, parseCost } from '@/utils/cost';

describe('parseCost', () => {
  // Otherwise a cost typed the way a receipt reads would be refused or saved wrong.
  it.each([
    ['40', 4000],
    ['40.00', 4000],
    ['$40', 4000],
    ['12.5', 1250],
    ['0.99', 99],
    [' 7 ', 700],
    ['0', 0],
  ])('reads %p as %i cents', (text, cents) => {
    expect(parseCost(text)).toBe(cents);
  });

  // Otherwise a mistyped cost would save as a negative, a fraction of a cent, or nothing.
  it.each(['', 'abc', '-5', '1.234', '40.', '.5', '$'])('rejects %p', (text) => {
    expect(parseCost(text)).toBeNull();
  });
});

describe('formatCost', () => {
  // Otherwise a cost would show as cents, or without its cents column.
  it.each([
    [4000, '$40.00'],
    [1250, '$12.50'],
    [99, '$0.99'],
  ])('shows %i cents as %p', (cents, shown) => {
    expect(formatCost(cents)).toBe(shown);
  });
});
