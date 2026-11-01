import { getDb } from '@/db/database';
import { getWorkRecords } from '@/db/queries/dayQueries';
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
      INSERT INTO pieces (id, name, notes, finished_at) VALUES
        (1, 'Blue vase', 'Cobalt', '2026-10-30T17:00:00.000Z'),
        (2, 'Green bowl', 'Lime', '2026-10-31T10:00:00.000Z'),
        (3, 'Red cup', NULL, NULL);
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
          photo_file_name: null,
          finished_at: '2026-10-31T10:00:00.000Z',
        },
      ],
    });
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
