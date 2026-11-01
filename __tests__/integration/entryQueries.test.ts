import { getDb } from '@/db/database';
import { addBreak, getDayEntries, updateEntryTimes } from '@/db/queries/entryQueries';
import { createTestDb } from '../setup';

jest.mock('@/db/database', () => ({
  getDb: jest.fn(),
}));

interface SegmentRow {
  piece_id: number;
  started_at: string;
  ended_at: string | null;
}

const segmentsSql = 'SELECT piece_id, started_at, ended_at FROM work_segments ORDER BY started_at';
const breaksSql = 'SELECT started_at, ended_at FROM breaks ORDER BY started_at';

let database: ReturnType<typeof createTestDb>;

beforeEach(async () => {
  database = createTestDb();
  (getDb as jest.Mock).mockResolvedValue(database);
  await database.execAsync(`
    INSERT INTO pieces (id, name) VALUES (1, 'Blue vase'), (2, 'Green bowl');
  `);
});

describe('getDayEntries', () => {
  // Otherwise the day's page would miss entries or show another day's.
  it('lists the segments and breaks that touch the day in time order', async () => {
    await database.execAsync(`
      INSERT INTO work_segments (id, piece_id, started_at, ended_at) VALUES
        (1, 1, '2026-10-30T09:00:00.000Z', '2026-10-30T17:00:00.000Z'),
        (2, 1, '2026-10-30T23:00:00.000Z', '2026-10-31T01:00:00.000Z'),
        (3, 2, '2026-10-31T13:00:00.000Z', NULL);
      INSERT INTO breaks (id, started_at, ended_at) VALUES
        (1, '2026-10-31T12:00:00.000Z', '2026-10-31T13:00:00.000Z');
    `);

    expect(await getDayEntries('2026-10-31T00:00:00.000Z', '2026-11-01T00:00:00.000Z')).toEqual([
      {
        kind: 'segment',
        id: 2,
        piece_name: 'Blue vase',
        started_at: '2026-10-30T23:00:00.000Z',
        ended_at: '2026-10-31T01:00:00.000Z',
      },
      {
        kind: 'break',
        id: 1,
        piece_name: null,
        started_at: '2026-10-31T12:00:00.000Z',
        ended_at: '2026-10-31T13:00:00.000Z',
      },
      {
        kind: 'segment',
        id: 3,
        piece_name: 'Green bowl',
        started_at: '2026-10-31T13:00:00.000Z',
        ended_at: null,
      },
    ]);
  });
});

describe('updateEntryTimes', () => {
  beforeEach(async () => {
    await database.execAsync(`
      INSERT INTO work_segments (id, piece_id, started_at, ended_at) VALUES
        (1, 1, '2026-10-31T09:00:00.000Z', '2026-10-31T12:00:00.000Z'),
        (2, 2, '2026-10-31T13:00:00.000Z', NULL);
    `);
  });

  // Otherwise a clock left running overnight couldn't be pulled back to when work stopped.
  it('changes an entry start and end', async () => {
    await updateEntryTimes('segment', 1, '2026-10-31T08:30:00.000Z', '2026-10-31T11:00:00.000Z');

    expect(await database.getAllAsync<SegmentRow>(segmentsSql)).toEqual([
      { piece_id: 1, started_at: '2026-10-31T08:30:00.000Z', ended_at: '2026-10-31T11:00:00.000Z' },
      { piece_id: 2, started_at: '2026-10-31T13:00:00.000Z', ended_at: null },
    ]);
  });

  // Otherwise an entry could end before it starts and count negative time.
  it('rejects an end before its start', async () => {
    await expect(
      updateEntryTimes('segment', 1, '2026-10-31T12:00:00.000Z', '2026-10-31T09:00:00.000Z'),
    ).rejects.toThrow(/CHECK constraint/);
  });

  // Otherwise the same minutes could count as work on two pieces.
  it('rejects a change that overlaps another entry', async () => {
    await expect(
      updateEntryTimes('segment', 1, '2026-10-31T09:00:00.000Z', '2026-10-31T13:30:00.000Z'),
    ).rejects.toThrow('That overlaps another entry.');

    expect((await database.getAllAsync<SegmentRow>(segmentsSql))[0].ended_at).toBe(
      '2026-10-31T12:00:00.000Z',
    );
  });

  // Otherwise fixing a forgotten End day would leave the clock running.
  it('closes a running entry when it is given an end', async () => {
    await updateEntryTimes('segment', 2, '2026-10-31T13:00:00.000Z', '2026-10-31T17:00:00.000Z');

    expect(
      await database.getAllAsync('SELECT id FROM work_segments WHERE ended_at IS NULL'),
    ).toEqual([]);
  });

  // Otherwise moving a running piece's start earlier would stop its clock.
  it('keeps a running entry running when its end stays empty', async () => {
    await updateEntryTimes('segment', 2, '2026-10-31T12:30:00.000Z', null);

    expect((await database.getAllAsync<SegmentRow>(segmentsSql))[1]).toEqual({
      piece_id: 2,
      started_at: '2026-10-31T12:30:00.000Z',
      ended_at: null,
    });
  });
});

describe('addBreak', () => {
  // Otherwise a clock left running through lunch would count lunch as work.
  it('splits a running segment around a break added inside it', async () => {
    await database.execAsync(`
      INSERT INTO work_segments (piece_id, started_at) VALUES (1, '2026-10-31T09:00:00.000Z');
    `);

    await addBreak('2026-10-31T12:00:00.000Z', '2026-10-31T13:00:00.000Z');

    expect(await database.getAllAsync<SegmentRow>(segmentsSql)).toEqual([
      { piece_id: 1, started_at: '2026-10-31T09:00:00.000Z', ended_at: '2026-10-31T12:00:00.000Z' },
      { piece_id: 1, started_at: '2026-10-31T13:00:00.000Z', ended_at: null },
    ]);
    expect(await database.getAllAsync(breaksSql)).toEqual([
      { started_at: '2026-10-31T12:00:00.000Z', ended_at: '2026-10-31T13:00:00.000Z' },
    ]);
  });

  // Otherwise splitting an ended segment would lose the time after the break.
  it('keeps the original end on the second half of an ended segment', async () => {
    await database.execAsync(`
      INSERT INTO work_segments (piece_id, started_at, ended_at)
        VALUES (1, '2026-10-31T09:00:00.000Z', '2026-10-31T17:00:00.000Z');
    `);

    await addBreak('2026-10-31T12:00:00.000Z', '2026-10-31T13:00:00.000Z');

    expect((await database.getAllAsync<SegmentRow>(segmentsSql))[1]).toEqual({
      piece_id: 1,
      started_at: '2026-10-31T13:00:00.000Z',
      ended_at: '2026-10-31T17:00:00.000Z',
    });
  });

  // Otherwise a break taken while nothing was running couldn't be recorded.
  it('adds a break in a gap without touching any segment', async () => {
    await database.execAsync(`
      INSERT INTO work_segments (piece_id, started_at, ended_at)
        VALUES (1, '2026-10-31T09:00:00.000Z', '2026-10-31T12:00:00.000Z');
    `);

    await addBreak('2026-10-31T12:00:00.000Z', '2026-10-31T12:30:00.000Z');

    expect(await database.getAllAsync<SegmentRow>(segmentsSql)).toHaveLength(1);
    expect(await database.getAllAsync(breaksSql)).toHaveLength(1);
  });

  // Otherwise a break across a swap would have to guess which piece to cut.
  it('rejects a break that crosses more than one entry', async () => {
    await database.execAsync(`
      INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
        (1, '2026-10-31T09:00:00.000Z', '2026-10-31T12:00:00.000Z'),
        (2, '2026-10-31T12:00:00.000Z', '2026-10-31T15:00:00.000Z');
    `);

    await expect(addBreak('2026-10-31T11:30:00.000Z', '2026-10-31T12:30:00.000Z')).rejects.toThrow(
      'That break crosses more than one entry. Change their times first.',
    );
    expect(await database.getAllAsync(breaksSql)).toEqual([]);
  });

  // Otherwise a break hanging off the end of a segment would overlap the work.
  it('rejects a break that only partly overlaps an entry', async () => {
    await database.execAsync(`
      INSERT INTO work_segments (piece_id, started_at, ended_at)
        VALUES (1, '2026-10-31T09:00:00.000Z', '2026-10-31T12:00:00.000Z');
    `);

    await expect(addBreak('2026-10-31T11:30:00.000Z', '2026-10-31T12:30:00.000Z')).rejects.toThrow(
      'A break has to fall inside the entry it interrupts.',
    );
  });

  // Otherwise the same minutes could count as break time twice.
  it('rejects a break that overlaps another break', async () => {
    await database.execAsync(`
      INSERT INTO breaks (started_at, ended_at)
        VALUES ('2026-10-31T12:00:00.000Z', '2026-10-31T13:00:00.000Z');
    `);

    await expect(addBreak('2026-10-31T12:30:00.000Z', '2026-10-31T13:30:00.000Z')).rejects.toThrow(
      'That overlaps another break.',
    );
  });
});
