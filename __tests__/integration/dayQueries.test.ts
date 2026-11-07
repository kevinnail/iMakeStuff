import { getDb } from '@/db/database';
import { getWorkRecords } from '@/db/queries/dayQueries';
import { getWholeDays } from '@/utils/workDays';
import { createTestDb } from '../setup';

jest.mock('@/db/database', () => ({
  getDb: jest.fn(),
}));

let database: ReturnType<typeof createTestDb>;

beforeEach(() => {
  database = createTestDb();
  (getDb as jest.Mock).mockResolvedValue(database);
});

describe('getWorkRecords', () => {
  // Otherwise today's line would count yesterday's work, or miss the piece running now.
  it('returns only records running or ended after the given time', async () => {
    await database.execAsync(`
      INSERT INTO pieces (id, name, category, notes, finished_at) VALUES
        (1, 'Blue vase', 'piece', 'Cobalt', '2026-10-30T17:00:00.000Z'),
        (2, 'Green bowl', 'piece', 'Lime', '2026-10-31T10:00:00.000Z'),
        (3, 'Red cup', 'piece', NULL, NULL);
      INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
        (1, '2026-10-30T09:00:00.000Z', '2026-10-30T17:00:00.000Z'),
        (2, '2026-10-31T09:00:00.000Z', '2026-10-31T10:00:00.000Z'),
        (3, '2026-10-31T10:00:00.000Z', NULL);
      INSERT INTO breaks (started_at, ended_at) VALUES
        ('2026-10-30T12:00:00.000Z', '2026-10-30T12:30:00.000Z'),
        ('2026-10-31T08:30:00.000Z', '2026-10-31T09:00:00.000Z');
    `);

    expect(await getWorkRecords('2026-10-31T00:00:00.000Z')).toEqual({
      segments: [
        { started_at: '2026-10-31T09:00:00.000Z', ended_at: '2026-10-31T10:00:00.000Z' },
        { started_at: '2026-10-31T10:00:00.000Z', ended_at: null },
      ],
      breaks: [{ started_at: '2026-10-31T08:30:00.000Z', ended_at: '2026-10-31T09:00:00.000Z' }],
      finishedPieces: [
        {
          id: 2,
          name: 'Green bowl',
          category: 'piece',
          photo_file_name: null,
          finished_at: '2026-10-31T10:00:00.000Z',
          lost: 0,
          no_cost: 1,
        },
      ],
    });
  });

  // Otherwise prep would add to the Finished count, or its hours would go missing from the day.
  it('returns prep with its category and its time with the day', async () => {
    await database.execAsync(`
      INSERT INTO pieces (id, name, category, notes, finished_at) VALUES
        (1, 'Blue vase', 'piece', 'Cobalt', '2026-10-31T10:00:00.000Z'),
        (2, 'Dichroic cane', 'prep', 'Blue and gold', '2026-10-31T12:00:00.000Z');
      INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
        (1, '2026-10-31T09:00:00.000Z', '2026-10-31T10:00:00.000Z'),
        (2, '2026-10-31T10:00:00.000Z', '2026-10-31T12:00:00.000Z');
    `);

    const { segments, finishedPieces } = await getWorkRecords('2026-10-31T00:00:00.000Z');

    expect(segments).toEqual([
      { started_at: '2026-10-31T09:00:00.000Z', ended_at: '2026-10-31T10:00:00.000Z' },
      { started_at: '2026-10-31T10:00:00.000Z', ended_at: '2026-10-31T12:00:00.000Z' },
    ]);
    expect(finishedPieces.map(({ name, category }) => ({ name, category }))).toEqual([
      { name: 'Blue vase', category: 'piece' },
      { name: 'Dichroic cane', category: 'prep' },
    ]);
  });

  // Otherwise a lost piece would add to the Finished count, or its hours would vanish from the day.
  it('returns a lost piece marked lost, with its time in the day', async () => {
    await database.execAsync(`
      INSERT INTO pieces (id, name, category, notes, finished_at, lost) VALUES
        (1, 'Blue vase', 'piece', 'Cracked', '2026-10-31T10:00:00.000Z', 1);
      INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
        (1, '2026-10-31T09:00:00.000Z', '2026-10-31T10:00:00.000Z');
    `);

    const { segments, breaks, finishedPieces } = await getWorkRecords('2026-10-31T00:00:00.000Z');

    expect(finishedPieces).toEqual([expect.objectContaining({ name: 'Blue vase', lost: 1 })]);
    const [day] = getWholeDays(segments, breaks, Date.now());
    expect(day.worked).toBe(60 * 60 * 1000);
  });

  // Otherwise a fresh install with no work would break the Work screen and the Days tab.
  it('returns empty lists when nothing has been recorded', async () => {
    expect(await getWorkRecords(new Date(0).toISOString())).toEqual({
      segments: [],
      breaks: [],
      finishedPieces: [],
    });
  });
});

describe('the No cost tag on getWorkRecords', () => {
  // Otherwise Days would list a piece with nothing behind its cost with no sign of it.
  it('marks a finished piece with no supply behind it', async () => {
    await database.execAsync(`
      INSERT INTO supplies (id, name, cost_cents) VALUES (1, 'Silver bail', 300);
      INSERT INTO pieces (id, name, category, notes, finished_at) VALUES
        (1, 'Blue vase', 'piece', 'Cobalt', '2026-10-31T10:00:00.000Z'),
        (2, 'Pendant', 'piece', 'Silver', '2026-10-31T11:00:00.000Z');
      INSERT INTO supply_uses (piece_id, supply_id, share_numerator, share_denominator)
        VALUES (2, 1, 1, 1);
    `);

    const { finishedPieces } = await getWorkRecords('2026-10-31T00:00:00.000Z');

    expect(finishedPieces.map(({ name, no_cost }) => ({ name, no_cost }))).toEqual([
      { name: 'Blue vase', no_cost: 1 },
      { name: 'Pendant', no_cost: 0 },
    ]);
  });
});
