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
