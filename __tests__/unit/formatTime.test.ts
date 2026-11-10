import { formatTimeRange } from '@/utils/formatTime';

// Node's time formatting puts a narrow no-break space before AM and PM.
function readable(text: string) {
  return text.replace(/ /g, ' ');
}

describe('formatTimeRange', () => {
  // Otherwise a range inside one day would repeat its date at the end.
  it('gives the end only its clock time on the same day', () => {
    const start = new Date(2026, 10, 6, 9, 15).getTime();
    const end = new Date(2026, 10, 6, 10, 0).getTime();

    expect(readable(formatTimeRange(start, end))).toBe('Nov 6, 9:15 AM to 10:00 AM');
  });

  // Otherwise a clock left running overnight would look like it ended earlier the same day.
  it('gives the end its own day when it is on another one', () => {
    const start = new Date(2026, 10, 6, 21, 0).getTime();
    const end = new Date(2026, 10, 7, 8, 30).getTime();

    expect(readable(formatTimeRange(start, end))).toBe('Nov 6, 9:00 PM to Nov 7, 8:30 AM');
  });

  // Otherwise a running entry would show a made-up end time.
  it('ends a running entry at now', () => {
    const start = new Date(2026, 10, 6, 9, 15).getTime();

    expect(readable(formatTimeRange(start, null))).toBe('Nov 6, 9:15 AM to now');
  });
});
