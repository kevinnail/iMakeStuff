import { getDb } from '@/db/database';
import { finishPiece, getRunningPieces, startPiece, startSegment } from '@/db/queries/pieceQueries';
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

const finishedPieceSql = 'SELECT notes, photo_file_name, finished_at FROM pieces WHERE id = ?';

let database: ReturnType<typeof createTestDb>;

beforeEach(() => {
  database = createTestDb();
  (getDb as jest.Mock).mockResolvedValue(database);
});

describe('startPiece', () => {
  // Otherwise pressing Start records nothing and the Work screen has no timer to show.
  it('creates the piece with one running segment', async () => {
    const pieceId = await startPiece('Blue vase');

    const segments = await database.getAllAsync<SegmentRow>(
      'SELECT piece_id, started_at, ended_at FROM work_segments',
    );
    expect(segments).toEqual([
      { piece_id: pieceId, started_at: expect.any(String), ended_at: null },
    ]);
    expect(await getRunningPieces()).toEqual([
      { id: pieceId, name: 'Blue vase', started_at: segments[0].started_at },
    ]);
  });

  // Otherwise the running time shows NaN, because the stored start time can't be parsed.
  it('stores the start time in a format JavaScript parses', async () => {
    const before = Date.now();
    await startPiece('Blue vase');

    const [piece] = await getRunningPieces();

    // SQLite's clock and Date.now() can differ by a few milliseconds either way.
    expect(Date.parse(piece.started_at)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(piece.started_at)).toBeLessThanOrEqual(Date.now() + 1000);
  });

  // Otherwise a blank name creates a piece nobody can identify later.
  it('rejects a blank name and leaves nothing behind', async () => {
    await expect(startPiece('   ')).rejects.toThrow(/CHECK constraint/);

    expect(await database.getAllAsync('SELECT id FROM pieces')).toEqual([]);
    expect(await database.getAllAsync('SELECT id FROM work_segments')).toEqual([]);
  });
});

describe('startSegment', () => {
  // Otherwise one piece could have two timers running and its time would count twice.
  it('rejects starting a piece that is already running', async () => {
    const pieceId = await startPiece('Blue vase');

    await expect(startSegment(pieceId)).rejects.toThrow(/UNIQUE constraint/);
    expect(await getRunningPieces()).toHaveLength(1);
  });
});

describe('finishPiece', () => {
  const endedAt = '2026-10-31T17:30:00.000Z';

  // Otherwise Done loses the photo, or leaves the timer running and the piece keeps collecting time.
  it('saves the photo and ends the running segment at the Done time', async () => {
    const pieceId = await startPiece('Blue vase');

    await finishPiece(pieceId, { endedAt, notes: null, photoFileName: 'vase.jpg' });

    expect(await database.getFirstAsync<FinishedPieceRow>(finishedPieceSql, pieceId)).toEqual({
      notes: null,
      photo_file_name: 'vase.jpg',
      finished_at: endedAt,
    });
    expect(
      await database.getAllAsync<SegmentRow>(
        'SELECT piece_id, started_at, ended_at FROM work_segments',
      ),
    ).toEqual([{ piece_id: pieceId, started_at: expect.any(String), ended_at: endedAt }]);
    expect(await getRunningPieces()).toEqual([]);
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

  // Otherwise a finished piece could have nothing to identify it, and its timer would stop anyway.
  it('rejects a finish with neither a photo nor notes and keeps the timer running', async () => {
    const pieceId = await startPiece('Blue vase');

    await expect(
      finishPiece(pieceId, { endedAt, notes: null, photoFileName: null }),
    ).rejects.toThrow(/CHECK constraint/);

    expect(await database.getFirstAsync<FinishedPieceRow>(finishedPieceSql, pieceId)).toEqual({
      notes: null,
      photo_file_name: null,
      finished_at: null,
    });
    expect(await getRunningPieces()).toHaveLength(1);
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
