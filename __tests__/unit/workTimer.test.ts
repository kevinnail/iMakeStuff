import type { UnfinishedPiece } from '@/db/queries/pieceQueries';
import { colors } from '@/theme';
import { getWorkTimerContent } from '@/utils/workTimer';

function piece(overrides: Partial<UnfinishedPiece>): UnfinishedPiece {
  return {
    id: 1,
    name: 'Blue vase',
    category: 'piece',
    photo_file_name: null,
    template_id: null,
    template_counted: 0,
    worked_milliseconds: 0,
    running_since: null,
    size_amount: null,
    size_unit: null,
    ...overrides,
  };
}

describe('getWorkTimerContent', () => {
  // Otherwise the Lock Screen would show a different time than the piece's row on Work.
  it('gives the running piece its name, color, and its total time so far', () => {
    const pieces = [
      piece({ id: 1, name: 'Green bowl', worked_milliseconds: 60 * 60 * 1000 }),
      piece({
        id: 2,
        name: 'Blue vase',
        worked_milliseconds: 30 * 60 * 1000,
        running_since: '2026-11-05T10:00:00.000Z',
      }),
    ];

    expect(getWorkTimerContent(pieces, null)).toEqual({
      title: 'Blue vase',
      color: colors.primary,
      countingFrom: Date.parse('2026-11-05T09:30:00.000Z'),
    });
  });

  // Otherwise prep would show in the piece color, and pass for a piece at a glance.
  it('gives running prep the prep color', () => {
    const pieces = [
      piece({ name: 'Dichroic cane', category: 'prep', running_since: '2026-11-05T10:00:00.000Z' }),
    ];

    expect(getWorkTimerContent(pieces, null)?.color).toBe(colors.prep);
  });

  // Otherwise a break would keep counting on the paused piece, putting break time on it.
  it('gives a break On break, counting from its start', () => {
    const pieces = [piece({ worked_milliseconds: 60 * 60 * 1000 })];
    const runningBreak = { id: 1, started_at: '2026-11-05T12:00:00.000Z' };

    expect(getWorkTimerContent(pieces, runningBreak)).toEqual({
      title: 'On break',
      color: colors.accent,
      countingFrom: Date.parse('2026-11-05T12:00:00.000Z'),
    });
  });

  // Otherwise a timer would stay on the Lock Screen after End day, counting time that isn't work.
  it('gives nothing when nothing is running', () => {
    const pieces = [piece({ worked_milliseconds: 60 * 60 * 1000 })];

    expect(getWorkTimerContent(pieces, null)).toBeNull();
  });
});
