import { isQuestionDue } from '@/utils/stillWorking';

const startedAt = Date.parse('2026-10-31T09:00:00.000Z');
const minute = 60 * 1000;
const hour = 60 * minute;

function entry(kind: 'segment' | 'break', confirmedAt: number | null = null) {
  return {
    kind,
    started_at: new Date(startedAt).toISOString(),
    confirmed_at: confirmedAt === null ? null : new Date(confirmedAt).toISOString(),
  };
}

describe('isQuestionDue', () => {
  // Otherwise a forgotten break would never be asked about, or would be asked about too soon.
  it('is due for a break at 1 hour and not at 59 minutes', () => {
    expect(isQuestionDue(entry('break'), startedAt + 59 * minute)).toBe(false);
    expect(isQuestionDue(entry('break'), startedAt + hour)).toBe(true);
  });

  // Otherwise a piece left running would never be asked about, or a long session would be interrupted early.
  it('is due for a piece at 6 hours since its last touch and not at 5h 59m', () => {
    expect(isQuestionDue(entry('segment'), startedAt + 5 * hour + 59 * minute)).toBe(false);
    expect(isQuestionDue(entry('segment'), startedAt + 6 * hour)).toBe(true);
  });

  // Otherwise the question would come straight back after Still working was tapped.
  it('is due again 6 hours after Still working rather than right after it', () => {
    const confirmedAt = startedAt + 6 * hour;

    expect(isQuestionDue(entry('segment', confirmedAt), confirmedAt + minute)).toBe(false);
    expect(isQuestionDue(entry('segment', confirmedAt), confirmedAt + 6 * hour)).toBe(true);
  });
});
