import { getDb } from '@/db/database';
import { getRunningBreak, startBreak } from '@/db/queries/breakQueries';
import {
  endDay,
  finishPiece,
  getPieceDetail,
  getPieces,
  getUnfinishedPieces,
  startPiece,
  switchToPiece,
} from '@/db/queries/pieceQueries';
import { createTestDb } from '../setup';

jest.mock('@/db/database', () => ({
  getDb: jest.fn(),
}));

interface SegmentRow {
  piece_id: number;
  started_at: string;
  ended_at: string | null;
}

interface FinishedPieceRow {
  notes: string | null;
  photo_file_name: string | null;
  finished_at: string | null;
}

const segmentsSql = 'SELECT piece_id, started_at, ended_at FROM work_segments ORDER BY id';
const finishedPieceSql = 'SELECT notes, photo_file_name, finished_at FROM pieces WHERE id = ?';

let database: ReturnType<typeof createTestDb>;

beforeEach(() => {
  database = createTestDb();
  (getDb as jest.Mock).mockResolvedValue(database);
});

describe('startPiece', () => {
  // Otherwise pressing Start records nothing and the Work screen has no clock to show.
  it('creates the piece with one running segment', async () => {
    const pieceId = await startPiece('Blue vase');

    const segments = await database.getAllAsync<SegmentRow>(segmentsSql);
    expect(segments).toEqual([
      { piece_id: pieceId, started_at: expect.any(String), ended_at: null },
    ]);
    expect(await getUnfinishedPieces()).toEqual([
      {
        id: pieceId,
        name: 'Blue vase',
        worked_milliseconds: 0,
        running_since: segments[0].started_at,
      },
    ]);
  });

  // Otherwise the running time shows NaN, because the stored start time can't be parsed.
  it('stores the start time in a format JavaScript parses', async () => {
    const before = Date.now();
    await startPiece('Blue vase');

    const [segment] = await database.getAllAsync<SegmentRow>(segmentsSql);

    expect(Date.parse(segment.started_at)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(segment.started_at)).toBeLessThanOrEqual(Date.now());
  });

  // Otherwise starting a new piece would leave the green piece collecting time too.
  it('pauses the running piece when a new one starts', async () => {
    const firstPieceId = await startPiece('Blue vase');
    const secondPieceId = await startPiece('Green bowl');

    const segments = await database.getAllAsync<SegmentRow>(segmentsSql);
    expect(segments).toEqual([
      { piece_id: firstPieceId, started_at: expect.any(String), ended_at: segments[1].started_at },
      { piece_id: secondPieceId, started_at: expect.any(String), ended_at: null },
    ]);
  });

  // Otherwise a blank name creates a piece nobody can identify later.
  it('rejects a blank name and leaves the running piece running', async () => {
    const pieceId = await startPiece('Blue vase');

    await expect(startPiece('   ')).rejects.toThrow(/CHECK constraint/);

    expect(await database.getAllAsync('SELECT id FROM pieces')).toHaveLength(1);
    expect(await database.getAllAsync<SegmentRow>(segmentsSql)).toEqual([
      { piece_id: pieceId, started_at: expect.any(String), ended_at: null },
    ]);
  });
});

describe('switchToPiece', () => {
  // Otherwise a swap would leave a gap between pieces, or finish the piece you set down.
  it('pauses the green piece and starts the tapped one at the same moment', async () => {
    const firstPieceId = await startPiece('Blue vase');
    const secondPieceId = await startPiece('Green bowl');

    await switchToPiece(firstPieceId);

    const segments = await database.getAllAsync<SegmentRow>(segmentsSql);
    expect(segments.slice(1)).toEqual([
      { piece_id: secondPieceId, started_at: expect.any(String), ended_at: segments[2].started_at },
      { piece_id: firstPieceId, started_at: expect.any(String), ended_at: null },
    ]);
    const finished = await database.getAllAsync(
      'SELECT id FROM pieces WHERE finished_at IS NOT NULL',
    );
    expect(finished).toEqual([]);
  });

  // Otherwise tapping a piece during a break would leave the break running while you work.
  it('ends a running break and starts the tapped piece', async () => {
    const pieceId = await startPiece('Blue vase');
    await startBreak();

    await switchToPiece(pieceId);

    const [breakRow] = await database.getAllAsync<{ ended_at: string | null }>(
      'SELECT ended_at FROM breaks',
    );
    const segments = await database.getAllAsync<SegmentRow>(segmentsSql);
    expect(segments[1]).toEqual({
      piece_id: pieceId,
      started_at: breakRow.ended_at,
      ended_at: null,
    });
    expect(await getRunningBreak()).toBeNull();
  });

  // Otherwise two clocks could count at once and the same time would go to two pieces.
  it('rejects a second running segment', async () => {
    await startPiece('Blue vase');
    const secondPieceId = await startPiece('Green bowl');

    await expect(
      database.runAsync('INSERT INTO work_segments (piece_id) VALUES (?)', secondPieceId),
    ).rejects.toThrow(/UNIQUE constraint/);
  });
});

describe('getUnfinishedPieces', () => {
  // Otherwise swapping back would reset a piece's clock instead of resuming its total.
  it('lists each piece with the total of its ended segments', async () => {
    const pieceId = await startPiece('Blue vase');
    await database.execAsync(`
      DELETE FROM work_segments;
      INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
        (${pieceId}, '2026-10-30T09:00:00.000Z', '2026-10-30T10:30:00.000Z'),
        (${pieceId}, '2026-10-31T09:00:00.000Z', '2026-10-31T09:15:00.000Z');
    `);

    expect(await getUnfinishedPieces()).toEqual([
      { id: pieceId, name: 'Blue vase', worked_milliseconds: 105 * 60 * 1000, running_since: null },
    ]);
  });
});

describe('endDay', () => {
  // Otherwise the night would count as work on the green piece, or End day would finish it.
  it('stops the running piece and leaves it unfinished', async () => {
    const pieceId = await startPiece('Blue vase');

    await endDay();

    expect(await getUnfinishedPieces()).toEqual([
      {
        id: pieceId,
        name: 'Blue vase',
        worked_milliseconds: expect.any(Number),
        running_since: null,
      },
    ]);
  });

  // Otherwise ending the day on a break would count the whole night as break time.
  it('ends a running break', async () => {
    await startPiece('Blue vase');
    await startBreak();

    await endDay();

    expect(await getRunningBreak()).toBeNull();
    expect(
      await database.getAllAsync('SELECT id FROM work_segments WHERE ended_at IS NULL'),
    ).toEqual([]);
  });

  // Otherwise a stray End day tap would look like it did something when nothing was running.
  it('fails when nothing is running', async () => {
    const pieceId = await startPiece('Blue vase');
    await endDay();

    await expect(endDay()).rejects.toThrow('Nothing is running.');
    expect(await getUnfinishedPieces()).toEqual([
      expect.objectContaining({ id: pieceId, running_since: null }),
    ]);
  });
});

describe('finishPiece', () => {
  const endedAt = '2026-10-31T17:30:00.000Z';

  // Otherwise Done loses the photo, or leaves the clock running and the piece keeps collecting time.
  it('saves the photo and ends the running segment at the Done time', async () => {
    const pieceId = await startPiece('Blue vase');

    await finishPiece(pieceId, { endedAt, notes: null, photoFileName: 'vase.jpg' });

    expect(await database.getFirstAsync<FinishedPieceRow>(finishedPieceSql, pieceId)).toEqual({
      notes: null,
      photo_file_name: 'vase.jpg',
      finished_at: endedAt,
    });
    expect(await database.getAllAsync<SegmentRow>(segmentsSql)).toEqual([
      { piece_id: pieceId, started_at: expect.any(String), ended_at: endedAt },
    ]);
    expect(await getUnfinishedPieces()).toEqual([]);
  });

  // Otherwise finishing a piece you set down would stop the piece in your hands.
  it('leaves the green piece running when another piece is finished', async () => {
    const setDownPieceId = await startPiece('Blue vase');
    const greenPieceId = await startPiece('Green bowl');

    await finishPiece(setDownPieceId, { endedAt, notes: 'Cobalt glaze', photoFileName: null });

    expect(await getUnfinishedPieces()).toEqual([
      expect.objectContaining({ id: greenPieceId, running_since: expect.any(String) }),
    ]);
  });

  // Otherwise skipping the camera would make a piece impossible to finish.
  it('saves a piece with notes and no photo', async () => {
    const pieceId = await startPiece('Blue vase');

    await finishPiece(pieceId, { endedAt, notes: 'Cobalt glaze', photoFileName: null });

    expect(await database.getFirstAsync<FinishedPieceRow>(finishedPieceSql, pieceId)).toEqual({
      notes: 'Cobalt glaze',
      photo_file_name: null,
      finished_at: endedAt,
    });
  });

  // Otherwise a finished piece could have nothing to identify it, and its clock would stop anyway.
  it('rejects a finish with neither a photo nor notes and keeps the clock running', async () => {
    const pieceId = await startPiece('Blue vase');

    await expect(
      finishPiece(pieceId, { endedAt, notes: null, photoFileName: null }),
    ).rejects.toThrow(/CHECK constraint/);

    expect(await database.getFirstAsync<FinishedPieceRow>(finishedPieceSql, pieceId)).toEqual({
      notes: null,
      photo_file_name: null,
      finished_at: null,
    });
    expect(await getUnfinishedPieces()).toEqual([
      expect.objectContaining({ id: pieceId, running_since: expect.any(String) }),
    ]);
  });

  // Otherwise finishing twice would overwrite the first photo and finish time.
  it('fails for a piece that is already finished', async () => {
    const pieceId = await startPiece('Blue vase');
    await finishPiece(pieceId, { endedAt, notes: null, photoFileName: 'vase.jpg' });

    await expect(
      finishPiece(pieceId, {
        endedAt: '2026-10-31T18:00:00.000Z',
        notes: null,
        photoFileName: 'other.jpg',
      }),
    ).rejects.toThrow('That piece is already finished.');
    expect(await database.getFirstAsync<FinishedPieceRow>(finishedPieceSql, pieceId)).toEqual({
      notes: null,
      photo_file_name: 'vase.jpg',
      finished_at: endedAt,
    });
  });
});

describe('getPieces', () => {
  // Otherwise the Pieces tab would bury unfinished work or show finished pieces out of order.
  it('lists unfinished pieces first, then finished ones newest first, with their worked time', async () => {
    await database.execAsync(`
      INSERT INTO pieces (id, name, notes, finished_at) VALUES
        (1, 'Blue vase', 'Cobalt', '2026-10-30T17:00:00.000Z'),
        (2, 'Green bowl', 'Lime', '2026-10-31T17:00:00.000Z'),
        (3, 'Red cup', NULL, NULL);
      INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
        (1, '2026-10-30T09:00:00.000Z', '2026-10-30T10:00:00.000Z'),
        (2, '2026-10-31T09:00:00.000Z', '2026-10-31T11:00:00.000Z'),
        (3, '2026-10-31T12:00:00.000Z', '2026-10-31T12:30:00.000Z');
    `);

    expect(await getPieces()).toEqual([
      {
        id: 3,
        name: 'Red cup',
        photo_file_name: null,
        finished_at: null,
        worked_milliseconds: 30 * 60 * 1000,
      },
      {
        id: 2,
        name: 'Green bowl',
        photo_file_name: null,
        finished_at: '2026-10-31T17:00:00.000Z',
        worked_milliseconds: 2 * 60 * 60 * 1000,
      },
      {
        id: 1,
        name: 'Blue vase',
        photo_file_name: null,
        finished_at: '2026-10-30T17:00:00.000Z',
        worked_milliseconds: 60 * 60 * 1000,
      },
    ]);
  });

  // Otherwise the piece being worked on right now would show only its earlier sittings.
  it('counts a running piece up to now', async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await database.execAsync(`
      INSERT INTO pieces (id, name) VALUES (1, 'Blue vase');
      INSERT INTO work_segments (piece_id, started_at) VALUES (1, '${oneHourAgo}');
    `);

    const [piece] = await getPieces();
    expect(piece.worked_milliseconds).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1000);
    expect(piece.worked_milliseconds).toBeLessThanOrEqual(60 * 60 * 1000 + 5000);
  });
});

describe('getPieceDetail', () => {
  // Otherwise the piece page would be missing the other pieces and breaks its day lines are split from.
  it('returns the piece, its segments, and other segments and breaks since its first start', async () => {
    await database.execAsync(`
      INSERT INTO pieces (id, name, notes) VALUES (1, 'Blue vase', NULL), (2, 'Green bowl', NULL);
      INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
        (2, '2026-10-30T09:00:00.000Z', '2026-10-30T10:00:00.000Z'),
        (1, '2026-10-31T11:00:00.000Z', '2026-10-31T12:00:00.000Z'),
        (1, '2026-10-31T09:00:00.000Z', '2026-10-31T10:00:00.000Z'),
        (2, '2026-10-31T10:00:00.000Z', '2026-10-31T10:30:00.000Z');
      INSERT INTO breaks (started_at, ended_at) VALUES
        ('2026-10-30T12:00:00.000Z', '2026-10-30T13:00:00.000Z'),
        ('2026-10-31T10:30:00.000Z', '2026-10-31T11:00:00.000Z');
    `);

    expect(await getPieceDetail(1)).toEqual({
      piece: { id: 1, name: 'Blue vase', notes: null, photo_file_name: null, finished_at: null },
      segments: [
        { started_at: '2026-10-31T09:00:00.000Z', ended_at: '2026-10-31T10:00:00.000Z' },
        { started_at: '2026-10-31T11:00:00.000Z', ended_at: '2026-10-31T12:00:00.000Z' },
      ],
      otherSegments: [
        { started_at: '2026-10-31T10:00:00.000Z', ended_at: '2026-10-31T10:30:00.000Z' },
      ],
      breaks: [{ started_at: '2026-10-31T10:30:00.000Z', ended_at: '2026-10-31T11:00:00.000Z' }],
    });
  });

  // Otherwise a link to a deleted or mistyped piece would crash the page instead of saying so.
  it('returns null for a piece that does not exist', async () => {
    expect(await getPieceDetail(999)).toBeNull();
  });
});
