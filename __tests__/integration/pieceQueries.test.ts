import { getDb } from '@/db/database';
import { endBreak, getRunningBreak, startBreak } from '@/db/queries/breakQueries';
import {
  deletePiece,
  endDay,
  finishPiece,
  getPieceDetail,
  getPieces,
  getTemplates,
  getUnfinishedPieces,
  lapPiece,
  renamePiece,
  reopenPiece,
  setPieceLost,
  setPiecePhoto,
  setPieceRating,
  setPieceTemplate,
  startFromTemplate,
  startPiece,
  switchToPiece,
  updatePiece,
} from '@/db/queries/pieceQueries';
import { addPrepUse, addSupplyUse, setPrepUsedUp } from '@/db/queries/prepQueries';
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
const lostPieceSql = 'SELECT lost, photo_file_name, finished_at FROM pieces WHERE id = ?';

let database: ReturnType<typeof createTestDb>;

beforeEach(() => {
  database = createTestDb();
  (getDb as jest.Mock).mockResolvedValue(database);
});

describe('startPiece', () => {
  // Otherwise pressing Start records nothing and the Work screen has no clock to show.
  it('creates the piece with one running segment', async () => {
    const pieceId = await startPiece('Blue vase', 'piece');

    const segments = await database.getAllAsync<SegmentRow>(segmentsSql);
    expect(segments).toEqual([
      { piece_id: pieceId, started_at: expect.any(String), ended_at: null },
    ]);
    expect(await getUnfinishedPieces()).toEqual([
      {
        id: pieceId,
        name: 'Blue vase',
        category: 'piece',
        notes: null,
        photo_file_name: null,
        worked_milliseconds: 0,
        template_id: null,
        template_counted: 0,
        running_since: segments[0].started_at,
        size_amount: null,
        size_unit: null,
        run_id: null,
        run_made: 0,
      },
    ]);
  });

  // Otherwise the running time shows NaN, because the stored start time can't be parsed.
  it('stores the start time in a format JavaScript parses', async () => {
    const before = Date.now();
    await startPiece('Blue vase', 'piece');

    const [segment] = await database.getAllAsync<SegmentRow>(segmentsSql);

    expect(Date.parse(segment.started_at)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(segment.started_at)).toBeLessThanOrEqual(Date.now());
  });

  // Otherwise starting a new piece would leave the green piece collecting time too.
  it('pauses the running piece when a new one starts', async () => {
    const firstPieceId = await startPiece('Blue vase', 'piece');
    const secondPieceId = await startPiece('Green bowl', 'piece');

    const segments = await database.getAllAsync<SegmentRow>(segmentsSql);
    expect(segments).toEqual([
      { piece_id: firstPieceId, started_at: expect.any(String), ended_at: segments[1].started_at },
      { piece_id: secondPieceId, started_at: expect.any(String), ended_at: null },
    ]);
  });

  // Otherwise prep would be counted as a finished piece and left out of the Prep list.
  it('saves prep with its category', async () => {
    const prepId = await startPiece('Dichroic cane', 'prep');

    expect(await getUnfinishedPieces()).toEqual([
      expect.objectContaining({ id: prepId, name: 'Dichroic cane', category: 'prep' }),
    ]);
  });

  // Otherwise a mistyped category would save work that no list or total recognizes.
  it('rejects a category other than piece or prep', async () => {
    await expect(
      database.runAsync("INSERT INTO pieces (name, category) VALUES ('Dichroic cane', 'tool')"),
    ).rejects.toThrow(/CHECK constraint/);
  });

  // Otherwise a blank name creates a piece nobody can identify later.
  it('rejects a blank name and leaves the running piece running', async () => {
    const pieceId = await startPiece('Blue vase', 'piece');

    await expect(startPiece('   ', 'piece')).rejects.toThrow(/CHECK constraint/);

    expect(await database.getAllAsync('SELECT id FROM pieces')).toHaveLength(1);
    expect(await database.getAllAsync<SegmentRow>(segmentsSql)).toEqual([
      { piece_id: pieceId, started_at: expect.any(String), ended_at: null },
    ]);
  });
});

describe('switchToPiece', () => {
  // Otherwise a swap would leave a gap between pieces, or finish the piece you set down.
  it('pauses the green piece and starts the tapped one at the same moment', async () => {
    const firstPieceId = await startPiece('Blue vase', 'piece');
    const secondPieceId = await startPiece('Green bowl', 'piece');

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
    const pieceId = await startPiece('Blue vase', 'piece');
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
    await startPiece('Blue vase', 'piece');
    const secondPieceId = await startPiece('Green bowl', 'piece');

    await expect(
      database.runAsync('INSERT INTO work_segments (piece_id) VALUES (?)', secondPieceId),
    ).rejects.toThrow(/UNIQUE constraint/);
  });
});

describe('getUnfinishedPieces', () => {
  // Otherwise swapping back would reset a piece's clock instead of resuming its total.
  it('lists each piece with the total of its ended segments', async () => {
    const pieceId = await startPiece('Blue vase', 'piece');
    await database.execAsync(`
      DELETE FROM work_segments;
      INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
        (${pieceId}, '2026-10-30T09:00:00.000Z', '2026-10-30T10:30:00.000Z'),
        (${pieceId}, '2026-10-31T09:00:00.000Z', '2026-10-31T09:15:00.000Z');
    `);

    expect(await getUnfinishedPieces()).toEqual([
      {
        id: pieceId,
        name: 'Blue vase',
        category: 'piece',
        notes: null,
        photo_file_name: null,
        worked_milliseconds: 105 * 60 * 1000,
        template_id: null,
        template_counted: 0,
        running_since: null,
        size_amount: null,
        size_unit: null,
        run_id: null,
        run_made: 0,
      },
    ]);
  });
});

describe('endDay', () => {
  // Otherwise the night would count as work on the green piece, or End day would finish it.
  it('stops the running piece and leaves it unfinished', async () => {
    const pieceId = await startPiece('Blue vase', 'piece');

    await endDay();

    expect(await getUnfinishedPieces()).toEqual([
      {
        id: pieceId,
        name: 'Blue vase',
        category: 'piece',
        notes: null,
        photo_file_name: null,
        worked_milliseconds: expect.any(Number),
        template_id: null,
        template_counted: 0,
        running_since: null,
        size_amount: null,
        size_unit: null,
        run_id: null,
        run_made: 0,
      },
    ]);
  });

  // Otherwise ending the day on a break would count the whole night as break time.
  it('ends a running break', async () => {
    await startPiece('Blue vase', 'piece');
    await startBreak();

    await endDay();

    expect(await getRunningBreak()).toBeNull();
    expect(
      await database.getAllAsync('SELECT id FROM work_segments WHERE ended_at IS NULL'),
    ).toEqual([]);
  });

  // Otherwise a stray End day tap would look like it did something when nothing was running.
  it('fails when nothing is running', async () => {
    const pieceId = await startPiece('Blue vase', 'piece');
    await endDay();

    await expect(endDay()).rejects.toThrow('Nothing is running.');
    expect(await getUnfinishedPieces()).toEqual([
      expect.objectContaining({ id: pieceId, running_since: null }),
    ]);
  });
});

describe('finishPiece', () => {
  // After the start, which is the real current time, so the database accepts the end.
  const endedAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  // Otherwise Done loses the photo, or leaves the clock running and the piece keeps collecting time.
  it('saves the photo and ends the running segment at the Done time', async () => {
    const pieceId = await startPiece('Blue vase', 'piece');

    await finishPiece(pieceId, {
      endedAt,
      notes: null,
      photoFileName: 'vase.jpg',
      lost: false,
      isTemplate: false,
      sizeAmount: null,
      sizeUnit: null,
      supplyUses: [],
      prepUses: [],
    });

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
    const setDownPieceId = await startPiece('Blue vase', 'piece');
    const greenPieceId = await startPiece('Green bowl', 'piece');

    await finishPiece(setDownPieceId, {
      endedAt,
      notes: 'Cobalt glaze',
      photoFileName: null,
      lost: false,
      isTemplate: false,
      sizeAmount: null,
      sizeUnit: null,
      supplyUses: [],
      prepUses: [],
    });

    expect(await getUnfinishedPieces()).toEqual([
      expect.objectContaining({ id: greenPieceId, running_since: expect.any(String) }),
    ]);
  });

  // Otherwise a maker who skips the photo and the notes can't finish, and has to stop working to type.
  it('saves a finished piece with only a name', async () => {
    const pieceId = await startPiece('Blue vase', 'piece');

    await finishPiece(pieceId, {
      endedAt,
      notes: null,
      photoFileName: null,
      lost: false,
      isTemplate: false,
      sizeAmount: null,
      sizeUnit: null,
      supplyUses: [],
      prepUses: [],
    });

    expect(await database.getFirstAsync<FinishedPieceRow>(finishedPieceSql, pieceId)).toEqual({
      notes: null,
      photo_file_name: null,
      finished_at: endedAt,
    });
  });

  // Otherwise finishing twice would overwrite the first photo and finish time.
  it('fails for a piece that is already finished', async () => {
    const pieceId = await startPiece('Blue vase', 'piece');
    await finishPiece(pieceId, {
      endedAt,
      notes: null,
      photoFileName: 'vase.jpg',
      lost: false,
      isTemplate: false,
      sizeAmount: null,
      sizeUnit: null,
      supplyUses: [],
      prepUses: [],
    });

    await expect(
      finishPiece(pieceId, {
        endedAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        notes: null,
        photoFileName: 'other.jpg',
        lost: false,
        isTemplate: false,
        sizeAmount: null,
        sizeUnit: null,
        supplyUses: [],
        prepUses: [],
      }),
    ).rejects.toThrow('That piece is already finished.');
    expect(await database.getFirstAsync<FinishedPieceRow>(finishedPieceSql, pieceId)).toEqual({
      notes: null,
      photo_file_name: 'vase.jpg',
      finished_at: endedAt,
    });
  });
});

describe('finishPiece as lost', () => {
  const endedAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  // Otherwise a piece that cracked at Done would count as output, or lose the photo of what broke.
  it('saves the piece finished, lost, with its photo', async () => {
    const pieceId = await startPiece('Blue vase', 'piece');

    await finishPiece(pieceId, {
      endedAt,
      notes: null,
      photoFileName: 'crack.jpg',
      lost: true,
      isTemplate: false,
      sizeAmount: null,
      sizeUnit: null,
      supplyUses: [],
      prepUses: [],
    });

    expect(await database.getFirstAsync(lostPieceSql, pieceId)).toEqual({
      lost: 1,
      photo_file_name: 'crack.jpg',
      finished_at: endedAt,
    });
  });
});

describe('setPiecePhoto', () => {
  // Otherwise a photo taken with the piece still on the pipe, before Done, would be lost.
  it('saves a photo on a piece that is still unfinished', async () => {
    const pieceId = await startPiece('Blue vase', 'piece');

    await setPiecePhoto(pieceId, 'vase.jpg');

    expect(await getUnfinishedPieces()).toEqual([
      expect.objectContaining({ id: pieceId, photo_file_name: 'vase.jpg' }),
    ]);
  });

  // Otherwise Done would finish the piece without the photo taken before it.
  it('finishes a piece with the photo taken before Done', async () => {
    const pieceId = await startPiece('Blue vase', 'piece');
    await setPiecePhoto(pieceId, 'vase.jpg');

    await finishPiece(pieceId, {
      endedAt: new Date().toISOString(),
      notes: null,
      photoFileName: 'vase.jpg',
      lost: false,
      isTemplate: false,
      sizeAmount: null,
      sizeUnit: null,
      supplyUses: [],
      prepUses: [],
    });

    expect((await getPieceDetail(pieceId))?.piece).toMatchObject({
      photo_file_name: 'vase.jpg',
      finished_at: expect.any(String),
    });
  });

  // Otherwise a photo could be reported as saved on a piece deleted from another screen.
  it('fails for a piece that does not exist', async () => {
    await expect(setPiecePhoto(999, 'vase.jpg')).rejects.toThrow('That piece no longer exists.');
  });
});

describe('setPieceLost', () => {
  // Otherwise a crack found after Done, or a wrong tap, could never be recorded or undone.
  it('marks a finished piece lost and back to good', async () => {
    const pieceId = await startPiece('Blue vase', 'piece');
    await finishPiece(pieceId, {
      endedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      notes: 'Cobalt',
      photoFileName: null,
      lost: false,
      isTemplate: false,
      sizeAmount: null,
      sizeUnit: null,
      supplyUses: [],
      prepUses: [],
    });

    await setPieceLost(pieceId, true);
    expect(await database.getFirstAsync(lostPieceSql, pieceId)).toMatchObject({ lost: 1 });

    await setPieceLost(pieceId, false);
    expect(await database.getFirstAsync(lostPieceSql, pieceId)).toMatchObject({ lost: 0 });
  });

  // Otherwise a piece still being worked could be written off before it was finished.
  it('rejects marking an unfinished piece lost', async () => {
    const pieceId = await startPiece('Blue vase', 'piece');

    await expect(setPieceLost(pieceId, true)).rejects.toThrow(
      'Only a finished piece can be marked lost or good.',
    );
    expect(await database.getFirstAsync(lostPieceSql, pieceId)).toMatchObject({ lost: 0 });
  });
});

describe('grading a piece', () => {
  const ratingSql = 'SELECT rating FROM pieces WHERE id = ?';
  const vaseEdit = {
    name: 'Blue vase',
    category: 'piece' as const,
    notes: null,
    photoFileName: null,
    sizeAmount: null,
    sizeUnit: null,
  };

  beforeEach(() =>
    database.execAsync(`
      INSERT INTO pieces (id, name, category, notes, finished_at, lost, rating) VALUES
        (1, 'Blue vase', 'piece', NULL, '2026-10-30T17:00:00.000Z', 0, 4),
        (2, 'Green bowl', 'piece', NULL, NULL, 0, NULL),
        (3, 'Red cup', 'piece', NULL, '2026-10-30T18:00:00.000Z', 1, NULL),
        (4, 'Blue points', 'prep', NULL, '2026-10-30T19:00:00.000Z', 0, NULL);
    `),
  );

  // Otherwise the stars picked at Done are dropped and the piece page shows no grade.
  it('saves the grade given at Done', async () => {
    const pieceId = await startPiece('Amber bead', 'piece');

    await finishPiece(pieceId, {
      endedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      notes: null,
      photoFileName: null,
      lost: false,
      rating: 5,
      isTemplate: false,
      sizeAmount: null,
      sizeUnit: null,
      supplyUses: [],
      prepUses: [],
    });

    expect(await getPieceDetail(pieceId)).toMatchObject({
      piece: { name: 'Amber bead', rating: 5 },
    });
  });

  // Otherwise a grade given at Done could never be corrected or taken off from the piece's page.
  it('changes and takes off a finished piece grade', async () => {
    await setPieceRating(1, 2);
    expect(await database.getFirstAsync(ratingSql, 1)).toEqual({ rating: 2 });

    await setPieceRating(1, null);
    expect(await database.getFirstAsync(ratingSql, 1)).toEqual({ rating: null });
  });

  // Otherwise a grade could land on work the stars don't apply to, or off the 1 to 5 scale.
  it.each([
    ['an unfinished piece', 2, 3],
    ['a lost piece', 3, 3],
    ['prep', 4, 3],
    ['six stars', 1, 6],
  ])('refuses a grade on %s', async (_case, pieceId, rating) => {
    await expect(setPieceRating(pieceId, rating)).rejects.toThrow(/CHECK constraint/);
  });

  // Otherwise marking a graded piece lost fails, since a lost piece can't have a grade.
  it('takes the grade off a piece marked lost', async () => {
    await setPieceLost(1, true);

    expect(await database.getFirstAsync(ratingSql, 1)).toEqual({ rating: null });
  });

  // Otherwise changing a graded piece to prep fails, since prep can't have a grade.
  it('takes the grade off a piece changed to prep, and keeps it on a piece edited as a piece', async () => {
    await updatePiece(1, vaseEdit);
    expect(await database.getFirstAsync(ratingSql, 1)).toEqual({ rating: 4 });

    await updatePiece(1, { ...vaseEdit, category: 'prep' });
    expect(await database.getFirstAsync(ratingSql, 1)).toEqual({ rating: null });
  });
});

describe('reopenPiece', () => {
  const pieceStateSql = 'SELECT finished_at, lost, rating FROM pieces WHERE id = ?';

  beforeEach(() =>
    database.execAsync(`
      INSERT INTO pieces (id, name, category, notes, photo_file_name, finished_at, lost, rating,
          is_template) VALUES
        (1, 'Blue vase', 'piece', 'Cobalt', 'vase.jpg', '2026-10-30T17:00:00.000Z', 0, 4, 0),
        (2, 'Green bowl', 'piece', NULL, NULL, '2026-10-30T18:00:00.000Z', 1, NULL, 0),
        (3, 'Red cup', 'piece', NULL, NULL, NULL, 0, NULL, 0),
        (4, 'Bead', 'piece', NULL, NULL, '2026-10-30T19:00:00.000Z', 0, NULL, 1),
        (5, 'Blue points', 'prep', NULL, NULL, '2026-10-29T17:00:00.000Z', 0, NULL, 0);
      INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
        (1, '2026-10-30T16:00:00.000Z', '2026-10-30T17:00:00.000Z'),
        (2, '2026-10-30T17:00:00.000Z', '2026-10-30T18:00:00.000Z'),
        (3, '2026-10-31T09:00:00.000Z', NULL);
      INSERT INTO supplies (id, name, cost_cents) VALUES (1, 'Clear tubing', 4000);
      INSERT INTO prep_uses (piece_id, prep_id, share_numerator, share_denominator)
        VALUES (1, 5, 1, 4);
      INSERT INTO supply_uses (piece_id, supply_id, share_numerator, share_denominator)
        VALUES (1, 1, 1, 2);
    `),
  );

  // Otherwise working on a piece again loses its time, notes, photo, or uses, and Done starts empty.
  it('puts a finished piece back running with its time, notes, photo, and uses', async () => {
    await reopenPiece(1);

    expect(await database.getFirstAsync(pieceStateSql, 1)).toEqual({
      finished_at: null,
      lost: 0,
      rating: null,
    });
    const reopened = (await getUnfinishedPieces()).find((piece) => piece.id === 1);
    expect(reopened).toMatchObject({
      notes: 'Cobalt',
      photo_file_name: 'vase.jpg',
      worked_milliseconds: 60 * 60 * 1000,
      running_since: expect.any(String),
    });
    expect(await database.getAllAsync('SELECT prep_id FROM prep_uses WHERE piece_id = 1')).toEqual([
      { prep_id: 5 },
    ]);
    expect(
      await database.getAllAsync('SELECT supply_id FROM supply_uses WHERE piece_id = 1'),
    ).toEqual([{ supply_id: 1 }]);
  });

  // Otherwise reopening a lost piece fails, since an unfinished piece can't be lost.
  it('takes Lost off a lost piece', async () => {
    await reopenPiece(2);

    expect(await database.getFirstAsync(pieceStateSql, 2)).toMatchObject({ lost: 0 });
  });

  // Otherwise two pieces would collect the same minutes.
  it('stops the piece that was running', async () => {
    await reopenPiece(1);

    const running = await database.getAllAsync(
      'SELECT piece_id FROM work_segments WHERE ended_at IS NULL',
    );
    expect(running).toEqual([{ piece_id: 1 }]);
  });

  // Otherwise a template or prep could go back to unfinished, and the pieces made from or using
  // it would lose what they take from it.
  it.each([
    ['a template', 4],
    ['prep', 5],
    ['an unfinished piece', 3],
  ])('refuses %s and leaves it as it was', async (_case, pieceId) => {
    const before = await database.getFirstAsync(pieceStateSql, pieceId);

    await expect(reopenPiece(pieceId)).rejects.toThrow(
      "Only a finished piece that isn't a template can be worked on again.",
    );
    expect(await database.getFirstAsync(pieceStateSql, pieceId)).toEqual(before);
  });
});

describe('production runs', () => {
  const runPieceSql = `SELECT id, name, template_id, kind_id, run_id, finished_at FROM pieces
    WHERE run_id IS NOT NULL ORDER BY id`;

  beforeEach(() =>
    database.execAsync(`
      INSERT INTO pieces (id, name, category, finished_at, is_template) VALUES
        (1, 'Tumbler', 'piece', '2026-10-30T17:00:00.000Z', 1);
    `),
  );

  // Otherwise Lap has no run to put the next copy in, and a run's pieces can't be found together.
  it.each([
    ['on the fly', () => startPiece('Tumbler', 'piece', true)],
    ['from a template', () => startFromTemplate(1, true)],
  ])('makes a piece started in Laps %s the first of its run', async (_case, start) => {
    const pieceId = await start();

    expect(await database.getFirstAsync('SELECT run_id FROM pieces WHERE id = ?', pieceId)).toEqual(
      { run_id: pieceId },
    );
  });

  // Otherwise seconds fall between laps, and a day of 30 pieces loses time no piece ever gets.
  it('finishes the piece in hand and starts the next at the same moment', async () => {
    const firstId = await startPiece('Tumbler', 'piece', true);

    await lapPiece(firstId, { startNext: true });

    const segments = await database.getAllAsync<SegmentRow>(segmentsSql);
    expect(segments).toEqual([
      { piece_id: firstId, started_at: expect.any(String), ended_at: segments[1].started_at },
      { piece_id: firstId + 1, started_at: expect.any(String), ended_at: null },
    ]);
    expect(await database.getFirstAsync<FinishedPieceRow>(finishedPieceSql, firstId)).toEqual({
      notes: null,
      photo_file_name: null,
      finished_at: segments[1].started_at,
    });
  });

  // Otherwise the next copy loses its template or run, and the run's pieces stop adding up.
  it('starts the copy with the same name, template, kind, and run', async () => {
    const firstId = await startFromTemplate(1, true);

    await lapPiece(firstId, { startNext: true });

    expect(await database.getAllAsync(runPieceSql)).toEqual([
      {
        id: firstId,
        name: 'Tumbler',
        template_id: 1,
        kind_id: 1,
        run_id: firstId,
        finished_at: expect.any(String),
      },
      {
        id: firstId + 1,
        name: 'Tumbler',
        template_id: 1,
        kind_id: 1,
        run_id: firstId,
        finished_at: null,
      },
    ]);
  });

  // Otherwise the count on the lap row stays put, and the maker can't see that a lap landed.
  it("counts the run's finished pieces on the piece in hand", async () => {
    const firstId = await startPiece('Tumbler', 'piece', true);
    await lapPiece(firstId, { startNext: true });
    await lapPiece(firstId + 1, { startNext: true });

    expect(await getUnfinishedPieces()).toEqual([
      expect.objectContaining({ id: firstId + 2, run_id: firstId, run_made: 2 }),
    ]);
  });

  // Otherwise End run leaves a copy running, collecting time on a piece that's never made.
  it('finishes the last piece with nothing started after it', async () => {
    const firstId = await startPiece('Tumbler', 'piece', true);

    await lapPiece(firstId, { startNext: false });

    expect(await getUnfinishedPieces()).toEqual([]);
    expect(await database.getAllAsync(runPieceSql)).toEqual([
      expect.objectContaining({ id: firstId, finished_at: expect.any(String) }),
    ]);
  });

  // Otherwise Lap could finish a piece that isn't in a run, or one set down, with time it never had.
  it.each([
    ['a piece not in a run', false, "That piece isn't in a run."],
    ['a paused piece', true, "That piece isn't running."],
  ])('refuses %s and changes nothing', async (_case, inRun, message) => {
    const pieceId = await startPiece('Tumbler', 'piece', inRun);
    if (inRun) await endDay();
    const segmentsBefore = await database.getAllAsync(segmentsSql);

    await expect(lapPiece(pieceId, { startNext: true })).rejects.toThrow(message);

    expect(await database.getAllAsync(segmentsSql)).toEqual(segmentsBefore);
    expect(await database.getAllAsync('SELECT id, finished_at FROM pieces ORDER BY id')).toEqual([
      { id: 1, finished_at: '2026-10-30T17:00:00.000Z' },
      { id: pieceId, finished_at: null },
    ]);
  });

  // Otherwise prep could be made in laps, and a run of canes would count as finished pieces.
  it('refuses a run on prep', async () => {
    await expect(startPiece('Dichroic cane', 'prep', true)).rejects.toThrow(/CHECK constraint/);

    expect(await database.getAllAsync('SELECT id FROM pieces')).toEqual([{ id: 1 }]);
  });

  describe('prep and supplies at each lap', () => {
    const caneId = 2;
    const pointsId = 3;
    const fritId = 4;
    const tubeId = 1;

    // The template's lines: 20% of a by eye cane, 1 of 8 points pulled from a $40 tube, and a
    // quarter tube. The points' whole cost is saved on a counted use once it's made.
    const templateLines = {
      prep: [
        { prep_id: caneId, share_numerator: 20, share_denominator: 100, prep_cost_cents: null },
        { prep_id: pointsId, share_numerator: 1, share_denominator: 8, prep_cost_cents: 4000 },
      ],
      supplies: [{ supply_id: tubeId, share_numerator: 1, share_denominator: 4 }],
    };

    beforeEach(() =>
      database.execAsync(`
        INSERT INTO pieces (id, name, category, finished_at, is_template, size_amount, size_unit) VALUES
          (${caneId}, 'Dichroic cane', 'prep', '2026-10-29T17:00:00.000Z', 0, NULL, NULL),
          (${pointsId}, 'Points', 'prep', '2026-10-29T18:00:00.000Z', 1, 8, 'points'),
          (${fritId}, 'Frit mix', 'prep', '2026-10-29T19:00:00.000Z', 0, NULL, NULL);
        INSERT INTO supplies (id, name, cost_cents) VALUES (${tubeId}, 'Clear tube', 4000);
        INSERT INTO supply_uses (piece_id, supply_id, share_numerator, share_denominator) VALUES
          (${pointsId}, ${tubeId}, 1, 1),
          (1, ${tubeId}, 1, 4);
        INSERT INTO prep_uses (piece_id, prep_id, share_numerator, share_denominator) VALUES
          (1, ${caneId}, 20, 100),
          (1, ${pointsId}, 1, 8);
      `),
    );

    async function getUses(pieceId: number) {
      return {
        prep: await database.getAllAsync(
          `SELECT prep_id, share_numerator, share_denominator, prep_cost_cents FROM prep_uses
           WHERE piece_id = ? ORDER BY prep_id`,
          pieceId,
        ),
        supplies: await database.getAllAsync(
          `SELECT supply_id, share_numerator, share_denominator FROM supply_uses
           WHERE piece_id = ? ORDER BY supply_id`,
          pieceId,
        ),
      };
    }

    // Otherwise a run's pieces carry no prep or supplies, and every lap shows No cost.
    it("gives the first lap the template's lines as they are, and each next lap the piece before it's", async () => {
      // All used, so a piece's Done would look for another cane. A run keeps this one.
      await setPrepUsedUp(caneId, true);
      const firstId = await startFromTemplate(1, true);
      await lapPiece(firstId, { startNext: true });
      // Added on the first piece's page, so the next lap is seen to copy it and not the template.
      await addPrepUse(firstId, {
        prepId: fritId,
        share: { share_numerator: 10, share_denominator: 100 },
      });

      await lapPiece(firstId + 1, { startNext: true });

      const fritLine = {
        prep_id: fritId,
        share_numerator: 10,
        share_denominator: 100,
        prep_cost_cents: null,
      };
      const firstLines = { ...templateLines, prep: [...templateLines.prep, fritLine] };
      expect(await getUses(firstId)).toEqual(firstLines);
      expect(await getUses(firstId + 1)).toEqual(firstLines);
      expect(await getUses(firstId + 2)).toEqual({ prep: [], supplies: [] });
    });

    // Otherwise a line added on the running piece's page would keep the run's other lines off it
    // and every lap after, or its lap would fail on a line it already has.
    it('adds the lines a piece is missing and leaves out a kind it already has', async () => {
      const newCaneId = 5;
      await database.execAsync(`
        INSERT INTO pieces (id, name, category, finished_at, kind_id) VALUES
          (${newCaneId}, 'Dichroic cane', 'prep', '2026-10-29T20:00:00.000Z', ${caneId});
      `);
      const firstId = await startFromTemplate(1, true);
      // On the running piece's page: frit the template doesn't have, a newer cane of the
      // template's cane's kind, and half a tube where the template has a quarter.
      await addPrepUse(firstId, {
        prepId: fritId,
        share: { share_numerator: 10, share_denominator: 100 },
      });
      await addPrepUse(firstId, {
        prepId: newCaneId,
        share: { share_numerator: 25, share_denominator: 100 },
      });
      await addSupplyUse(firstId, {
        supplyId: tubeId,
        share: { share_numerator: 1, share_denominator: 2 },
      });

      await lapPiece(firstId, { startNext: true });

      expect(await getUses(firstId)).toEqual({
        prep: [
          templateLines.prep[1],
          { prep_id: fritId, share_numerator: 10, share_denominator: 100, prep_cost_cents: null },
          {
            prep_id: newCaneId,
            share_numerator: 25,
            share_denominator: 100,
            prep_cost_cents: null,
          },
        ],
        supplies: [{ supply_id: tubeId, share_numerator: 1, share_denominator: 2 }],
      });
    });

    // Otherwise a tap landing after its lap, like a double tap, would start an extra piece or
    // stack lines on the one just made.
    it('refuses a lap on a finished piece and copies nothing', async () => {
      const firstId = await startFromTemplate(1, true);
      await lapPiece(firstId, { startNext: true });
      const usesBefore = [await getUses(firstId), await getUses(firstId + 1)];

      await expect(lapPiece(firstId, { startNext: true })).rejects.toThrow(
        "That piece isn't running.",
      );

      expect([await getUses(firstId), await getUses(firstId + 1)]).toEqual(usesBefore);
      expect(await getUnfinishedPieces()).toEqual([expect.objectContaining({ id: firstId + 1 })]);
    });
  });
});

describe('getPieces', () => {
  // Otherwise the Pieces tab would bury unfinished work or show finished pieces out of order.
  it('lists unfinished pieces first, then finished ones newest first, with their worked time', async () => {
    await database.execAsync(`
      INSERT INTO pieces (id, name, category, notes, finished_at) VALUES
        (1, 'Blue vase', 'piece', 'Cobalt', '2026-10-30T17:00:00.000Z'),
        (2, 'Green bowl', 'piece', 'Lime', '2026-10-31T17:00:00.000Z'),
        (3, 'Red cup', 'prep', NULL, NULL);
      INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
        (1, '2026-10-30T09:00:00.000Z', '2026-10-30T10:00:00.000Z'),
        (2, '2026-10-31T09:00:00.000Z', '2026-10-31T11:00:00.000Z'),
        (3, '2026-10-31T12:00:00.000Z', '2026-10-31T12:30:00.000Z');
    `);

    expect(await getPieces()).toEqual([
      {
        id: 3,
        name: 'Red cup',
        category: 'prep',
        photo_file_name: null,
        finished_at: null,
        lost: 0,
        size_amount: null,
        size_unit: null,
        worked_milliseconds: 30 * 60 * 1000,
        prep_milliseconds: null,
        prep_estimated: false,
        used_share: 0,
        used_by_count: 0,
        used_up: 0,
        usable: 0,
        no_cost: 0,
        cost_cents: null,
        cost_estimated: false,
      },
      {
        id: 2,
        name: 'Green bowl',
        category: 'piece',
        photo_file_name: null,
        finished_at: '2026-10-31T17:00:00.000Z',
        lost: 0,
        size_amount: null,
        size_unit: null,
        worked_milliseconds: 2 * 60 * 60 * 1000,
        prep_milliseconds: null,
        prep_estimated: false,
        used_share: 0,
        used_by_count: 0,
        used_up: 0,
        usable: 0,
        no_cost: 1,
        cost_cents: null,
        cost_estimated: false,
      },
      {
        id: 1,
        name: 'Blue vase',
        category: 'piece',
        photo_file_name: null,
        finished_at: '2026-10-30T17:00:00.000Z',
        lost: 0,
        size_amount: null,
        size_unit: null,
        worked_milliseconds: 60 * 60 * 1000,
        prep_milliseconds: null,
        prep_estimated: false,
        used_share: 0,
        used_by_count: 0,
        used_up: 0,
        usable: 0,
        no_cost: 1,
        cost_cents: null,
        cost_estimated: false,
      },
    ]);
  });

  // Otherwise deleting a prep from the Pieces tab wouldn't warn that it comes off the pieces that used it.
  it('counts the pieces and prep that used each prep, and none for a piece', async () => {
    await database.execAsync(`
      INSERT INTO pieces (id, name, category, notes, finished_at) VALUES
        (1, 'Blue points', 'prep', 'Cobalt', '2026-10-30T10:00:00.000Z'),
        (2, 'Blue vase', 'piece', 'Tall', '2026-10-30T12:00:00.000Z'),
        (3, 'Blue cane', 'prep', 'Twisted', '2026-10-30T14:00:00.000Z');
      INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
        (1, '2026-10-30T09:00:00.000Z', '2026-10-30T10:00:00.000Z'),
        (2, '2026-10-30T11:00:00.000Z', '2026-10-30T12:00:00.000Z'),
        (3, '2026-10-30T13:00:00.000Z', '2026-10-30T14:00:00.000Z');
      INSERT INTO prep_uses (piece_id, prep_id, share_numerator, share_denominator) VALUES
        (2, 1, 1, 4),
        (3, 1, 2, 4);
    `);

    const counts = (await getPieces()).map(({ id, used_by_count }) => ({ id, used_by_count }));
    expect(counts).toEqual([
      { id: 3, used_by_count: 0 },
      { id: 2, used_by_count: 0 },
      { id: 1, used_by_count: 2 },
    ]);
  });

  // Otherwise the piece being worked on right now would show only its earlier sittings.
  it('counts a running piece up to now', async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await database.execAsync(`
      INSERT INTO pieces (id, name, category) VALUES (1, 'Blue vase', 'piece');
      INSERT INTO work_segments (piece_id, started_at) VALUES (1, '${oneHourAgo}');
    `);

    const [piece] = await getPieces();
    expect(piece.worked_milliseconds).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1000);
    expect(piece.worked_milliseconds).toBeLessThanOrEqual(60 * 60 * 1000 + 5000);
  });
});

describe('getPieceDetail', () => {
  // Otherwise the piece page would be missing the other pieces and breaks its day lines are split from, or Edit couldn't tell which segment's times to change.
  it('returns the piece, its segments with their ids, and other segments and breaks since its first start', async () => {
    await database.execAsync(`
      INSERT INTO pieces (id, name, category) VALUES (1, 'Blue vase', 'piece'), (2, 'Green bowl', 'piece');
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
      piece: {
        id: 1,
        name: 'Blue vase',
        category: 'piece',
        notes: null,
        photo_file_name: null,
        finished_at: null,
        used_up_at: null,
        lost: 0,
        rating: null,
        is_template: 0,
        size_amount: null,
        size_unit: null,
        template_counted: 0,
        no_cost: 0,
      },
      segments: [
        { id: 3, started_at: '2026-10-31T09:00:00.000Z', ended_at: '2026-10-31T10:00:00.000Z' },
        { id: 2, started_at: '2026-10-31T11:00:00.000Z', ended_at: '2026-10-31T12:00:00.000Z' },
      ],
      otherSegments: [
        { started_at: '2026-10-31T10:00:00.000Z', ended_at: '2026-10-31T10:30:00.000Z' },
      ],
      breaks: [{ started_at: '2026-10-31T10:30:00.000Z', ended_at: '2026-10-31T11:00:00.000Z' }],
      usedPrep: [],
      usedBy: [],
      usedSupplies: [],
    });
  });

  // Otherwise a link to a deleted or mistyped piece would crash the page instead of saying so.
  it('returns null for a piece that does not exist', async () => {
    expect(await getPieceDetail(999)).toBeNull();
  });
});

// A finished vase with a photo, a finished bowl with notes that used a cane, the cane, and a
// used-up frit mix.
const editFixturesSql = `
  INSERT INTO pieces (id, name, category, notes, photo_file_name, finished_at, used_up_at) VALUES
    (1, 'Blue vase', 'piece', NULL, 'vase.jpg', '2026-10-30T17:00:00.000Z', NULL),
    (2, 'Green bowl', 'piece', 'Lime', NULL, '2026-10-30T18:00:00.000Z', NULL),
    (3, 'Dichroic cane', 'prep', 'Blue', NULL, '2026-10-28T17:00:00.000Z', NULL),
    (4, 'Frit mix', 'prep', 'Green', NULL, '2026-10-29T17:00:00.000Z', '2026-10-31T10:00:00.000Z');
  INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
    (1, '2026-10-30T09:00:00.000Z', '2026-10-30T10:00:00.000Z'),
    (2, '2026-10-30T10:00:00.000Z', '2026-10-30T11:00:00.000Z'),
    (3, '2026-10-28T09:00:00.000Z', '2026-10-28T13:00:00.000Z'),
    (4, '2026-10-29T09:00:00.000Z', '2026-10-29T11:00:00.000Z');
  INSERT INTO prep_uses (piece_id, prep_id, share_numerator, share_denominator)
      VALUES (2, 3, 25, 100);
`;

const vaseChanges = {
  name: 'Blue vase',
  category: 'piece' as const,
  notes: null,
  photoFileName: 'vase.jpg',
  sizeAmount: null,
  sizeUnit: null,
};

const noSize = { sizeAmount: null, sizeUnit: null };

const pieceRowSql = 'SELECT name, category, notes, photo_file_name FROM pieces WHERE id = ?';

describe('updatePiece', () => {
  beforeEach(() => database.execAsync(editFixturesSql));

  // Otherwise a piece recorded under the wrong name would keep it.
  it('saves the new name', async () => {
    await updatePiece(1, { ...vaseChanges, name: 'Cobalt vase' });

    expect(await database.getFirstAsync(pieceRowSql, 1)).toEqual({
      name: 'Cobalt vase',
      category: 'piece',
      notes: null,
      photo_file_name: 'vase.jpg',
    });
  });

  // Otherwise a piece could be renamed to nothing and become unidentifiable.
  it('rejects a blank name', async () => {
    await expect(updatePiece(1, { ...vaseChanges, name: '   ' })).rejects.toThrow(
      /CHECK constraint/,
    );
  });

  // Otherwise prep recorded as a piece by mistake would stay counted as output.
  it('changes a piece with no prep uses to prep', async () => {
    await updatePiece(1, { ...vaseChanges, category: 'prep' });

    expect(await database.getFirstAsync(pieceRowSql, 1)).toMatchObject({ category: 'prep' });
  });

  // Otherwise prep couldn't be counted in points after it was made.
  it('saves a count on prep nothing has used', async () => {
    await updatePiece(4, {
      name: 'Frit mix',
      category: 'prep',
      notes: 'Green',
      photoFileName: null,
      sizeAmount: 8,
      sizeUnit: 'points',
    });

    expect(
      await database.getFirstAsync('SELECT size_amount, size_unit FROM pieces WHERE id = 4'),
    ).toEqual({ size_amount: 8, size_unit: 'points' });
  });

  // Otherwise a by eye guess of 1/4 would turn into 2 points, changing what the piece cost.
  it('rejects a count on prep a piece has used, and saves nothing', async () => {
    await expect(
      updatePiece(3, {
        name: 'Renamed cane',
        category: 'prep',
        notes: 'Blue',
        photoFileName: null,
        sizeAmount: 8,
        sizeUnit: 'points',
      }),
    ).rejects.toThrow("Counted or By eye can't change once a piece used it.");

    expect(
      await database.getFirstAsync('SELECT name, size_amount FROM pieces WHERE id = 3'),
    ).toEqual({ name: 'Dichroic cane', size_amount: null });
  });

  // Otherwise editing a used prep's name or notes would be refused along with its count.
  it('saves other changes on prep a piece has used', async () => {
    await updatePiece(3, {
      name: 'Renamed cane',
      category: 'prep',
      notes: 'Blue',
      photoFileName: null,
      ...noSize,
    });

    expect(await database.getFirstAsync(pieceRowSql, 3)).toMatchObject({ name: 'Renamed cane' });
  });

  // Otherwise a piece, which nothing uses, could carry a size that means nothing.
  it('rejects a size on a piece', async () => {
    await expect(
      updatePiece(1, { ...vaseChanges, sizeAmount: 8, sizeUnit: 'points' }),
    ).rejects.toThrow(/CHECK constraint/);
  });

  // Otherwise a cane recorded as a piece by mistake couldn't be fixed once it had the points it was made from.
  it('changes a piece that uses prep to prep, keeping its prep', async () => {
    await updatePiece(2, {
      name: 'Green bowl',
      category: 'prep',
      notes: 'Lime',
      photoFileName: null,
      ...noSize,
    });

    expect(await getPieceDetail(2)).toMatchObject({
      piece: { category: 'prep' },
      usedPrep: [expect.objectContaining({ piece_id: 2 })],
    });
  });

  // Otherwise pieces would keep shares of a prep that no longer exists as prep.
  it.each([
    ['a prep a piece used', 3, 'Dichroic cane', 'Blue'],
    ['a used-up prep', 4, 'Frit mix', 'Green'],
  ])('rejects changing %s to a piece', async (_kind, prepId, name, notes) => {
    await expect(
      updatePiece(prepId, { name, category: 'piece', notes, photoFileName: null, ...noSize }),
    ).rejects.toThrow("Prep that pieces used, or that's all used, can't become a piece.");
    expect(await database.getFirstAsync(pieceRowSql, prepId)).toMatchObject({ category: 'prep' });
  });
});

describe('deletePiece', () => {
  // Otherwise a deleted piece's time would stay on its days, or its prep would keep its share.
  it('removes its segments and prep uses, returns its photo, and leaves other pieces alone', async () => {
    await database.execAsync(editFixturesSql);

    expect(await deletePiece(2)).toBeNull();
    expect(await deletePiece(1)).toBe('vase.jpg');

    expect(await database.getAllAsync('SELECT id FROM pieces ORDER BY id')).toEqual([
      { id: 3 },
      { id: 4 },
    ]);
    expect(await database.getAllAsync('SELECT piece_id FROM work_segments ORDER BY id')).toEqual([
      { piece_id: 3 },
      { piece_id: 4 },
    ]);
    expect(await database.getAllAsync('SELECT id FROM prep_uses')).toEqual([]);
  });

  // Otherwise a prep's deleted time would still show on the pieces that used it.
  it('removes a deleted prep from the pieces that used it', async () => {
    await database.execAsync(editFixturesSql);

    await deletePiece(3);

    expect((await getPieceDetail(2))?.usedPrep).toEqual([]);
  });

  // Otherwise the clock would keep counting on a piece that no longer exists.
  it('leaves nothing running when the running piece is deleted', async () => {
    const pieceId = await startPiece('Blue vase', 'piece');

    await deletePiece(pieceId);

    expect(await database.getAllAsync('SELECT id FROM work_segments')).toEqual([]);
    expect(await getUnfinishedPieces()).toEqual([]);
  });

  // Otherwise Back to work would try to restart a piece that's gone.
  it('lets Back to work restart only the pieces left after the paused one is deleted', async () => {
    const setDownPieceId = await startPiece('Blue vase', 'piece');
    const pausedPieceId = await startPiece('Green bowl', 'piece');
    await startBreak();

    await deletePiece(pausedPieceId);
    await endBreak();

    expect(await getRunningBreak()).toBeNull();
    expect(await getUnfinishedPieces()).toEqual([
      expect.objectContaining({ id: setDownPieceId, running_since: null }),
    ]);
  });

  // Otherwise a stale page could report a piece as deleted when nothing was.
  it('fails for a piece that does not exist', async () => {
    await expect(deletePiece(999)).rejects.toThrow('That piece no longer exists.');
  });
});

describe('renamePiece', () => {
  const nameAndNotesSql = 'SELECT name, notes FROM pieces WHERE id = 1';

  beforeEach(() =>
    database.execAsync(
      "INSERT INTO pieces (id, name, category, notes) VALUES (1, 'Sherlock bubbler', 'piece', 'Blue')",
    ),
  );

  // Otherwise a piece started under the wrong name would keep it until it's finished.
  it('changes the name and leaves the notes alone', async () => {
    await renamePiece(1, 'Goblet');

    expect(await database.getFirstAsync(nameAndNotesSql)).toEqual({
      name: 'Goblet',
      notes: 'Blue',
    });
  });

  // Otherwise a running piece could be renamed to nothing and show as a blank row.
  it('rejects a blank name and keeps the old one', async () => {
    await expect(renamePiece(1, '   ')).rejects.toThrow(/CHECK constraint/);
    expect(await database.getFirstAsync(nameAndNotesSql)).toEqual({
      name: 'Sherlock bubbler',
      notes: 'Blue',
    });
  });

  // Otherwise renaming a piece deleted meanwhile would look like it worked.
  it('fails for a piece that does not exist', async () => {
    await expect(renamePiece(999, 'Goblet')).rejects.toThrow('That piece no longer exists.');
  });
});

describe('setPieceTemplate', () => {
  const templateSql = 'SELECT is_template FROM pieces WHERE id = 1';

  // Otherwise a piece could never be offered on Add Work's Existing, or never taken off it.
  it('marks a finished piece as a template and back', async () => {
    await database.execAsync(`
      INSERT INTO pieces (id, name, category, notes, finished_at) VALUES
        (1, 'Blue vase', 'piece', 'Cobalt', '2026-10-30T12:00:00.000Z');
    `);

    await setPieceTemplate(1, true);
    expect(await database.getFirstAsync(templateSql)).toEqual({ is_template: 1 });

    await setPieceTemplate(1, false);
    expect(await database.getFirstAsync(templateSql)).toEqual({ is_template: 0 });
  });

  // Otherwise a piece still being made could be copied before anyone knows how it turns out.
  it('rejects marking an unfinished piece', async () => {
    await database.execAsync(
      "INSERT INTO pieces (id, name, category) VALUES (1, 'Blue vase', 'piece')",
    );

    await expect(setPieceTemplate(1, true)).rejects.toThrow(
      'Only a finished piece can be a template.',
    );
    expect(await database.getFirstAsync(templateSql)).toEqual({ is_template: 0 });
  });
});

describe('getTemplates', () => {
  // Otherwise Existing would offer every piece again, adding to one would be back, or a prep template's size wouldn't fill in.
  it('lists only templates, pieces and prep, by name', async () => {
    await database.execAsync(`
      INSERT INTO pieces (id, name, category, notes, photo_file_name, finished_at, is_template)
      VALUES
        (1, 'blue vase', 'piece', 'Cobalt', 'vase.jpg', '2026-10-30T12:00:00.000Z', 1),
        (2, 'Green bowl', 'piece', 'Lime', NULL, '2026-10-30T13:00:00.000Z', 0),
        (3, 'Dichroic cane', 'prep', 'Blue', NULL, '2026-10-30T14:00:00.000Z', 1);
      INSERT INTO pieces (id, name, category) VALUES (4, 'Red cup', 'piece');
      UPDATE pieces SET size_amount = 8, size_unit = 'points' WHERE id = 3;
    `);

    expect(await getTemplates()).toEqual([
      {
        id: 1,
        name: 'blue vase',
        category: 'piece',
        photo_file_name: 'vase.jpg',
        size_amount: null,
        size_unit: null,
      },
      {
        id: 3,
        name: 'Dichroic cane',
        category: 'prep',
        photo_file_name: null,
        size_amount: 8,
        size_unit: 'points',
      },
    ]);
  });
});

describe('deleting a template', () => {
  // Otherwise deleting a template would fail, or take the pieces made from it with it.
  it('leaves the pieces made from it with no template', async () => {
    await database.execAsync(`
      INSERT INTO pieces (id, name, category, notes, finished_at, is_template) VALUES
        (1, 'Blue vase', 'piece', 'Cobalt', '2026-10-30T12:00:00.000Z', 1);
      INSERT INTO pieces (id, name, category, template_id) VALUES (2, 'Blue vase', 'piece', 1);
    `);

    await deletePiece(1);

    expect(await database.getAllAsync('SELECT id, template_id FROM pieces')).toEqual([
      { id: 2, template_id: null },
    ]);
  });
});

describe('the No cost tag', () => {
  // A cane with a tube behind it, a frit mix with none, and pieces made from them.
  const noCostFixturesSql = `
    INSERT INTO supplies (id, name, cost_cents) VALUES (1, '5 ft tube', 4000);
    INSERT INTO pieces (id, name, category, notes, finished_at) VALUES
      (1, 'Dichroic cane', 'prep', 'Blue', '2026-10-28T12:00:00.000Z'),
      (2, 'Frit mix', 'prep', 'Green', '2026-10-28T13:00:00.000Z'),
      (3, 'Blue vase', 'piece', 'Cobalt', '2026-10-29T12:00:00.000Z'),
      (4, 'Green bowl', 'piece', 'Lime', '2026-10-29T13:00:00.000Z'),
      (5, 'Red cup', 'piece', 'Plain', '2026-10-29T14:00:00.000Z'),
      (6, 'Pendant', 'piece', 'Silver', '2026-10-29T15:00:00.000Z');
    INSERT INTO pieces (id, name, category) VALUES (7, 'Gray mug', 'piece');
    INSERT INTO supply_uses (piece_id, supply_id, share_numerator, share_denominator)
      VALUES (1, 1, 1, 1), (6, 1, 1, 8);
    INSERT INTO prep_uses (piece_id, prep_id, share_numerator, share_denominator)
      VALUES (3, 1, 25, 100), (4, 2, 25, 100);
    INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
      (1, '2026-10-28T09:00:00.000Z', '2026-10-28T12:00:00.000Z'),
      (2, '2026-10-28T12:00:00.000Z', '2026-10-28T13:00:00.000Z'),
      (3, '2026-10-29T09:00:00.000Z', '2026-10-29T12:00:00.000Z'),
      (4, '2026-10-29T12:00:00.000Z', '2026-10-29T13:00:00.000Z'),
      (5, '2026-10-29T13:00:00.000Z', '2026-10-29T14:00:00.000Z'),
      (6, '2026-10-29T14:00:00.000Z', '2026-10-29T15:00:00.000Z'),
      (7, '2026-10-29T15:00:00.000Z', '2026-10-29T16:00:00.000Z');
  `;

  async function getNoCost(pieceId: number) {
    const pieces = await getPieces();
    return pieces.find((piece) => piece.id === pieceId)?.no_cost;
  }

  beforeEach(() => database.execAsync(noCostFixturesSql));

  // Otherwise a piece saved with nothing behind its cost would look like a complete record.
  it('tags a finished piece with no supply behind it', async () => {
    expect(await getNoCost(5)).toBe(1);
  });

  // Otherwise a pendant with its own supply would still be flagged as missing a cost.
  it('does not tag a piece with a supply of its own', async () => {
    expect(await getNoCost(6)).toBe(0);
  });

  // Otherwise a piece costed through its cane would be flagged as if it had no cost.
  it('does not tag a piece whose prep has a supply', async () => {
    expect(await getNoCost(3)).toBe(0);
  });

  // Otherwise the fix would only be pointed at on the piece, when it belongs on the prep.
  it('tags a piece whose only prep has no supplies, and that prep too', async () => {
    expect(await getNoCost(4)).toBe(1);
    expect(await getNoCost(2)).toBe(1);
    expect(await getNoCost(1)).toBe(0);
  });

  // Otherwise a piece whose supply was deleted after it was made would show its saved cost and No cost together.
  it("does not tag a piece with a counted prep's cost saved on its use", async () => {
    await database.execAsync(`
      INSERT INTO prep_uses (piece_id, prep_id, share_numerator, share_denominator, prep_cost_cents)
        VALUES (5, 2, 1, 8, 188);
    `);

    expect(await getNoCost(5)).toBe(0);
  });

  // Otherwise every later batch of points would be flagged, with no way to give it a supply.
  it('does not tag a batch of a counted template', async () => {
    await database.execAsync(`
      INSERT INTO pieces (id, name, category, notes, finished_at, is_template, size_amount, size_unit)
        VALUES (8, 'Points', 'prep', 'Clear', '2026-10-30T12:00:00.000Z', 1, 8, 'points');
      INSERT INTO pieces (id, name, category, notes, finished_at, template_id, size_amount, size_unit)
        VALUES (9, 'Points', 'prep', 'Clear', '2026-10-31T12:00:00.000Z', 8, 8, 'points');
      INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
        (8, '2026-10-30T11:00:00.000Z', '2026-10-30T12:00:00.000Z'),
        (9, '2026-10-31T11:00:00.000Z', '2026-10-31T12:00:00.000Z');
    `);

    expect(await getNoCost(9)).toBe(0);
  });

  // Otherwise a piece still being made would be tagged before Done has filled in its supplies.
  it('does not tag an unfinished piece', async () => {
    expect(await getNoCost(7)).toBe(0);
  });

  // Otherwise a piece's page wouldn't show the tag the list shows.
  it('carries the tag on the piece page', async () => {
    expect((await getPieceDetail(5))?.piece.no_cost).toBe(1);
    expect((await getPieceDetail(6))?.piece.no_cost).toBe(0);
  });
});
