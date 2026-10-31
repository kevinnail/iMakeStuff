import { getDb } from '@/db/database';
import { getRunningPieces, startPiece, startSegment, stopPiece } from '@/db/queries/pieceQueries';
import { createTestDb } from '../setup';

jest.mock('@/db/database', () => ({
  getDb: jest.fn(),
}));

interface SegmentRow {
  piece_id: number;
  started_at: string;
  ended_at: string | null;
}

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
    expect(Date.parse(piece.started_at)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(piece.started_at)).toBeLessThanOrEqual(Date.now());
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

describe('stopPiece', () => {
  // Otherwise Stop leaves the timer running and the piece keeps collecting time.
  it('ends the running segment', async () => {
    const pieceId = await startPiece('Blue vase');

    await stopPiece(pieceId);

    const segment = await database.getFirstAsync<SegmentRow>(
      'SELECT piece_id, started_at, ended_at FROM work_segments',
    );
    expect(segment?.ended_at).not.toBeNull();
    expect(Date.parse(segment!.ended_at!)).toBeGreaterThanOrEqual(Date.parse(segment!.started_at));
    expect(await getRunningPieces()).toEqual([]);
  });

  // Otherwise a second tap on Stop looks like it worked when nothing was running.
  it('fails for a piece that is not running', async () => {
    const pieceId = await startPiece('Blue vase');
    await stopPiece(pieceId);

    await expect(stopPiece(pieceId)).rejects.toThrow('That piece is not running.');
  });
});
