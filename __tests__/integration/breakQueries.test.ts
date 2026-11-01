import { getDb } from '@/db/database';
import { endBreak, getRunningBreak, startBreak } from '@/db/queries/breakQueries';
import { finishPiece, startPiece, switchToPiece } from '@/db/queries/pieceQueries';
import { createTestDb } from '../setup';

jest.mock('@/db/database', () => ({
  getDb: jest.fn(),
}));

interface SegmentRow {
  piece_id: number;
  started_at: string;
  ended_at: string | null;
}

interface BreakRow {
  started_at: string;
  ended_at: string | null;
}

const segmentsSql = 'SELECT piece_id, started_at, ended_at FROM work_segments ORDER BY id';
const breaksSql = 'SELECT started_at, ended_at FROM breaks';
const runningSegmentsSql = 'SELECT piece_id FROM work_segments WHERE ended_at IS NULL';

let database: ReturnType<typeof createTestDb>;

beforeEach(() => {
  database = createTestDb();
  (getDb as jest.Mock).mockResolvedValue(database);
});

describe('startBreak', () => {
  // Otherwise the piece keeps collecting time through the break.
  it('ends the running segment at the moment the break starts', async () => {
    const pieceId = await startPiece('Blue vase');

    await startBreak();

    const [breakRow] = await database.getAllAsync<BreakRow>(breaksSql);
    expect(breakRow).toEqual({ started_at: expect.any(String), ended_at: null });
    expect(await database.getAllAsync<SegmentRow>(segmentsSql)).toEqual([
      { piece_id: pieceId, started_at: expect.any(String), ended_at: breakRow.started_at },
    ]);
    expect(await database.getAllAsync(runningSegmentsSql)).toEqual([]);
    expect(await getRunningBreak()).toEqual({
      id: expect.any(Number),
      started_at: breakRow.started_at,
    });
  });

  // Otherwise a break with no work to pause would be recorded as break time.
  it('rejects a break when nothing is running and records no break', async () => {
    await expect(startBreak()).rejects.toThrow('Nothing is running.');

    expect(await database.getAllAsync(breaksSql)).toEqual([]);
  });

  // Otherwise two overlapping breaks would count the same time twice.
  it('rejects a second break while on break', async () => {
    await startPiece('Blue vase');
    await startBreak();

    await expect(startBreak()).rejects.toThrow(/UNIQUE constraint/);
    expect(await database.getAllAsync(breaksSql)).toHaveLength(1);
  });
});

describe('endBreak', () => {
  // Otherwise Back to work leaves the piece stopped, or restarts it with a gap after the break.
  it('ends the break and restarts the paused piece from the same moment', async () => {
    const pieceId = await startPiece('Blue vase');
    await startBreak();

    await endBreak();

    const [breakRow] = await database.getAllAsync<BreakRow>(breaksSql);
    expect(breakRow.ended_at).toEqual(expect.any(String));
    const segments = await database.getAllAsync<SegmentRow>(segmentsSql);
    expect(segments).toEqual([
      { piece_id: pieceId, started_at: expect.any(String), ended_at: breakRow.started_at },
      { piece_id: pieceId, started_at: breakRow.ended_at, ended_at: null },
    ]);
    expect(await getRunningBreak()).toBeNull();
  });

  // Otherwise Back to work would resume a piece you had set down before the break.
  it('restarts only the piece that was green when the break started', async () => {
    const setDownPieceId = await startPiece('Blue vase');
    const greenPieceId = await startPiece('Green bowl');
    await switchToPiece(setDownPieceId);
    await switchToPiece(greenPieceId);
    await startBreak();

    await endBreak();

    expect(await database.getAllAsync(runningSegmentsSql)).toEqual([{ piece_id: greenPieceId }]);
  });

  // Otherwise a piece finished during the break would start collecting time again.
  it('does not restart a piece finished during the break', async () => {
    const pieceId = await startPiece('Blue vase');
    await startBreak();
    await finishPiece(pieceId, {
      endedAt: new Date().toISOString(),
      notes: 'Cobalt glaze',
      photoFileName: null,
    });

    await endBreak();

    expect(await database.getAllAsync(runningSegmentsSql)).toEqual([]);
    expect(await getRunningBreak()).toBeNull();
  });

  // Otherwise Back to work with no break would fail silently and the screen would show nothing changed.
  it('fails when not on a break', async () => {
    await startPiece('Blue vase');

    await expect(endBreak()).rejects.toThrow('You are not on a break.');
    expect(await database.getAllAsync<SegmentRow>(segmentsSql)).toHaveLength(1);
  });
});
