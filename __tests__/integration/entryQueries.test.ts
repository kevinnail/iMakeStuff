import { getDb } from '@/db/database';
import {
  addBreak,
  addPastWork,
  addPieceTime,
  confirmRunningEntry,
  getDayEntries,
  getRunningEntry,
  stopRunningEntry,
  updateEntryTimes,
} from '@/db/queries/entryQueries';
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
    INSERT INTO pieces (id, name, category) VALUES (1, 'Blue vase', 'piece'), (2, 'Green bowl', 'piece');
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

describe('addPastWork', () => {
  const startedAt = '2026-10-30T16:00:00.000Z';
  const endedAt = '2026-10-30T19:00:00.000Z';

  // Otherwise a forgotten day's work could not be recorded at all.
  it('creates a new piece with its work on the chosen day', async () => {
    await addPastWork({
      piece: { name: 'Red cup', category: 'piece', templateId: null },
      startedAt,
      endedAt,
      photoFileName: null,
      finish: null,
      supplyUses: [],
      prepUses: [],
    });

    expect(
      await database.getAllAsync(
        `SELECT pieces.name, pieces.category, pieces.finished_at,
           work_segments.started_at, work_segments.ended_at
         FROM work_segments JOIN pieces ON pieces.id = work_segments.piece_id`,
      ),
    ).toEqual([
      {
        name: 'Red cup',
        category: 'piece',
        finished_at: null,
        started_at: startedAt,
        ended_at: endedAt,
      },
    ]);
  });

  // Otherwise prep made on a forgotten day would be saved as a piece and counted as output.
  it('creates new prep with its category', async () => {
    await addPastWork({
      piece: { name: 'Dichroic cane', category: 'prep', templateId: null },
      startedAt,
      endedAt,
      photoFileName: null,
      finish: null,
      supplyUses: [],
      prepUses: [],
    });

    expect(
      await database.getAllAsync("SELECT category FROM pieces WHERE name = 'Dichroic cane'"),
    ).toEqual([{ category: 'prep' }]);
  });

  // Otherwise a piece made entirely on a forgotten day could never be finished.
  it('finishes the piece at the end of the work', async () => {
    await addPastWork({
      piece: { name: 'Red cup', category: 'piece', templateId: null },
      startedAt,
      endedAt,
      photoFileName: null,
      finish: { notes: 'Copper red', lost: false },
      supplyUses: [],
      prepUses: [],
    });

    expect(
      await database.getAllAsync("SELECT notes, finished_at FROM pieces WHERE name = 'Red cup'"),
    ).toEqual([{ notes: 'Copper red', finished_at: endedAt }]);
  });

  // Otherwise a piece that broke on a forgotten day would count as output once caught up.
  it('saves a lost finish', async () => {
    await addPastWork({
      piece: { name: 'Red cup', category: 'piece', templateId: null },
      startedAt,
      endedAt,
      photoFileName: null,
      finish: { notes: 'Cracked in the kiln', lost: true },
      supplyUses: [],
      prepUses: [],
    });

    expect(
      await database.getAllAsync("SELECT lost, finished_at FROM pieces WHERE name = 'Red cup'"),
    ).toEqual([{ lost: 1, finished_at: endedAt }]);
  });

  // Otherwise a finished piece could be saved with nothing to identify it.
  it('rejects finishing with neither a photo nor notes and saves nothing', async () => {
    await expect(
      addPastWork({
        piece: { name: 'Red cup', category: 'piece', templateId: null },
        startedAt,
        endedAt,
        photoFileName: null,
        finish: { notes: null, lost: false },
        supplyUses: [],
        prepUses: [],
      }),
    ).rejects.toThrow(/CHECK constraint/);

    expect(await database.getAllAsync("SELECT id FROM pieces WHERE name = 'Red cup'")).toEqual([]);
    expect(await database.getAllAsync(segmentsSql)).toEqual([]);
  });

  // Otherwise past work could end before it starts and count negative time.
  it('rejects an end before its start and saves nothing', async () => {
    await expect(
      addPastWork({
        piece: { name: 'Red cup', category: 'piece', templateId: null },
        startedAt: endedAt,
        endedAt: startedAt,
        photoFileName: null,
        finish: null,
        supplyUses: [],
        prepUses: [],
      }),
    ).rejects.toThrow(/CHECK constraint/);

    expect(await database.getAllAsync("SELECT id FROM pieces WHERE name = 'Red cup'")).toEqual([]);
  });

  // Otherwise the same minutes could count as work on two pieces.
  it('rejects work that overlaps another entry', async () => {
    await database.execAsync(`
      INSERT INTO work_segments (piece_id, started_at, ended_at)
        VALUES (1, '2026-10-30T18:00:00.000Z', '2026-10-30T20:00:00.000Z');
    `);

    await expect(
      addPastWork({
        piece: { name: 'Red cup', category: 'piece', templateId: null },
        startedAt,
        endedAt,
        photoFileName: null,
        finish: null,
        supplyUses: [],
        prepUses: [],
      }),
    ).rejects.toThrow('That overlaps another entry.');
    expect(await database.getAllAsync(segmentsSql)).toHaveLength(1);
  });

  // Otherwise a photo added for a new piece that isn't finished yet would be thrown away.
  it('keeps the photo on a new piece that is not finished', async () => {
    await addPastWork({
      piece: { name: 'Red cup', category: 'piece', templateId: null },
      startedAt,
      endedAt,
      photoFileName: 'cup.jpg',
      finish: null,
      supplyUses: [],
      prepUses: [],
    });

    expect(
      await database.getAllAsync(
        "SELECT photo_file_name, finished_at FROM pieces WHERE name = 'Red cup'",
      ),
    ).toEqual([{ photo_file_name: 'cup.jpg', finished_at: null }]);
  });

  // Otherwise making another from a template would change the template or lose its prep.
  it('saves a new piece from a template with its prep and leaves the template unchanged', async () => {
    await database.execAsync(`
      INSERT INTO pieces (id, name, category, notes, photo_file_name, finished_at, is_template) VALUES
        (3, 'Dichroic cane', 'prep', 'Blue', NULL, '2026-10-28T12:00:00.000Z', 0),
        (4, 'Blue vase', 'piece', NULL, 'vase.jpg', '2026-10-29T12:00:00.000Z', 1);
      INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
        (4, '2026-10-29T09:00:00.000Z', '2026-10-29T12:00:00.000Z');
      INSERT INTO prep_uses (piece_id, prep_id, share_numerator, share_denominator)
      VALUES (4, 3, 25, 100);
    `);

    await addPastWork({
      piece: { name: 'Blue vase', category: 'piece', templateId: 4 },
      startedAt,
      endedAt,
      photoFileName: 'second.jpg',
      finish: null,
      supplyUses: [],
      prepUses: [{ prepId: 3, share: { share_numerator: 25, share_denominator: 100 } }],
    });

    expect(
      await database.getAllAsync(
        'SELECT id, template_id, photo_file_name, finished_at FROM pieces WHERE id >= 4 ORDER BY id',
      ),
    ).toEqual([
      {
        id: 4,
        template_id: null,
        photo_file_name: 'vase.jpg',
        finished_at: '2026-10-29T12:00:00.000Z',
      },
      { id: 5, template_id: 4, photo_file_name: 'second.jpg', finished_at: null },
    ]);
    expect(
      await database.getAllAsync(
        'SELECT piece_id, prep_id, share_numerator, share_denominator FROM prep_uses ORDER BY id',
      ),
    ).toEqual([
      { piece_id: 4, prep_id: 3, share_numerator: 25, share_denominator: 100 },
      { piece_id: 5, prep_id: 3, share_numerator: 25, share_denominator: 100 },
    ]);
    expect(await database.getAllAsync<SegmentRow>(segmentsSql)).toEqual([
      { piece_id: 4, started_at: '2026-10-29T09:00:00.000Z', ended_at: '2026-10-29T12:00:00.000Z' },
      { piece_id: 5, started_at: startedAt, ended_at: endedAt },
    ]);
  });

  // Otherwise a prep used up while the form was open could be used past its end.
  it('rejects a prep that was used up in the meantime and saves nothing', async () => {
    await database.execAsync(`
      INSERT INTO pieces (id, name, category, notes, finished_at, used_up_at) VALUES
        (3, 'Dichroic cane', 'prep', 'Blue', '2026-10-28T12:00:00.000Z', '2026-10-29T12:00:00.000Z');
    `);

    await expect(
      addPastWork({
        piece: { name: 'Red cup', category: 'piece', templateId: null },
        startedAt,
        endedAt,
        photoFileName: null,
        finish: null,
        supplyUses: [],
        prepUses: [{ prepId: 3, share: { share_numerator: 25, share_denominator: 100 } }],
      }),
    ).rejects.toThrow("Only finished prep that isn't all used or lost can be added.");
    expect(await database.getAllAsync("SELECT id FROM pieces WHERE name = 'Red cup'")).toEqual([]);
    expect(await database.getAllAsync(segmentsSql)).toEqual([]);
  });
});

describe('addPieceTime', () => {
  const startedAt = '2026-10-30T16:00:00.000Z';
  const endedAt = '2026-10-30T19:00:00.000Z';

  // Otherwise time worked with the timer forgotten could never be put on the piece.
  it('adds a stretch of work to the piece', async () => {
    await addPieceTime(1, startedAt, endedAt);

    expect(await database.getAllAsync<SegmentRow>(segmentsSql)).toEqual([
      { piece_id: 1, started_at: startedAt, ended_at: endedAt },
    ]);
  });

  // Otherwise forgotten time from before a piece was finished couldn't be added to it.
  it('adds time to a finished piece that ends by when it was finished', async () => {
    await database.execAsync(
      `UPDATE pieces SET finished_at = '${endedAt}', notes = 'Cobalt' WHERE id = 1`,
    );

    await addPieceTime(1, startedAt, endedAt);

    expect(await database.getAllAsync(segmentsSql)).toHaveLength(1);
  });

  // Otherwise a finished piece could collect work dated after it was done.
  it('rejects time on a finished piece that runs past when it was finished', async () => {
    await database.execAsync(
      `UPDATE pieces SET finished_at = '2026-10-30T18:00:00.000Z', notes = 'Cobalt' WHERE id = 1`,
    );

    await expect(addPieceTime(1, startedAt, endedAt)).rejects.toThrow(
      'Time on a finished piece has to end by when it was finished.',
    );
    expect(await database.getAllAsync(segmentsSql)).toEqual([]);
  });

  // Otherwise the same minutes could count on two pieces.
  it('rejects time that overlaps another entry', async () => {
    await database.execAsync(`
      INSERT INTO work_segments (piece_id, started_at, ended_at)
        VALUES (2, '2026-10-30T18:00:00.000Z', '2026-10-30T20:00:00.000Z');
    `);

    await expect(addPieceTime(1, startedAt, endedAt)).rejects.toThrow(
      'That overlaps another entry.',
    );
    expect(await database.getAllAsync(segmentsSql)).toHaveLength(1);
  });

  // Otherwise a page left open on a deleted piece would blame its finish time.
  it('fails for a piece that no longer exists', async () => {
    await expect(addPieceTime(999, startedAt, endedAt)).rejects.toThrow(
      'That piece no longer exists.',
    );
    expect(await database.getAllAsync(segmentsSql)).toEqual([]);
  });
});

describe('getRunningEntry', () => {
  // Otherwise the Still working question couldn't name the piece or tell a piece from a break.
  it('returns the running segment with its piece name, then the running break', async () => {
    await database.execAsync(`
      INSERT INTO work_segments (id, piece_id, started_at) VALUES (1, 1, '2026-10-31T09:00:00.000Z');
    `);

    expect(await getRunningEntry()).toEqual({
      kind: 'segment',
      id: 1,
      piece_name: 'Blue vase',
      started_at: '2026-10-31T09:00:00.000Z',
      confirmed_at: null,
    });

    await database.execAsync(`
      UPDATE work_segments SET ended_at = '2026-10-31T10:00:00.000Z';
      INSERT INTO breaks (id, started_at) VALUES (1, '2026-10-31T10:00:00.000Z');
    `);

    expect(await getRunningEntry()).toEqual({
      kind: 'break',
      id: 1,
      piece_name: null,
      started_at: '2026-10-31T10:00:00.000Z',
      confirmed_at: null,
    });
  });
});

describe('confirmRunningEntry', () => {
  // Otherwise Still working would stop the clock, or the question would come straight back.
  it('saves confirmed_at and leaves the piece running', async () => {
    await database.execAsync(`
      INSERT INTO work_segments (id, piece_id, started_at) VALUES (1, 1, '2026-10-31T09:00:00.000Z');
    `);
    const tappedAfter = Date.now();

    await confirmRunningEntry('segment', 1);

    const [segment] = await database.getAllAsync<{ ended_at: string | null; confirmed_at: string }>(
      'SELECT ended_at, confirmed_at FROM work_segments',
    );
    expect(segment.ended_at).toBeNull();
    expect(Date.parse(segment.confirmed_at)).toBeGreaterThanOrEqual(tappedAfter);
  });

  // Otherwise an old question answered late would mark a clock that already stopped.
  it('fails when the entry was already ended somewhere else', async () => {
    await database.execAsync(`
      INSERT INTO work_segments (id, piece_id, started_at, ended_at) VALUES
        (1, 1, '2026-10-31T09:00:00.000Z', '2026-10-31T17:00:00.000Z');
    `);

    await expect(confirmRunningEntry('segment', 1)).rejects.toThrow("That's already stopped.");
  });
});

describe('stopRunningEntry', () => {
  // Otherwise I stopped at would keep the forgotten hours on the piece, or leave it running.
  it('ends a never confirmed segment at its start, leaving nothing running', async () => {
    await database.execAsync(`
      INSERT INTO work_segments (id, piece_id, started_at) VALUES (1, 1, '2026-10-31T09:00:00.000Z');
    `);

    await stopRunningEntry('segment', 1, null);

    expect(await database.getAllAsync<SegmentRow>(segmentsSql)).toEqual([
      { piece_id: 1, started_at: '2026-10-31T09:00:00.000Z', ended_at: '2026-10-31T09:00:00.000Z' },
    ]);
    expect(await getRunningEntry()).toBeNull();
  });

  // Otherwise the time worked up to the last Still working tap would be thrown away.
  it('ends a confirmed segment at confirmed_at', async () => {
    await database.execAsync(`
      INSERT INTO work_segments (id, piece_id, started_at, confirmed_at) VALUES
        (1, 1, '2026-10-31T09:00:00.000Z', '2026-10-31T15:00:00.000Z');
    `);

    await stopRunningEntry('segment', 1, null);

    expect(await database.getAllAsync<SegmentRow>(segmentsSql)).toEqual([
      { piece_id: 1, started_at: '2026-10-31T09:00:00.000Z', ended_at: '2026-10-31T15:00:00.000Z' },
    ]);
  });

  // Otherwise a break that never happened would stay on the day, or restart the piece it paused.
  it('removes a never confirmed break and leaves the pieces it paused stopped', async () => {
    await database.execAsync(`
      INSERT INTO breaks (id, started_at) VALUES (1, '2026-10-31T10:00:00.000Z');
      INSERT INTO work_segments (id, piece_id, started_at, ended_at, paused_by_break_id) VALUES
        (1, 1, '2026-10-31T09:00:00.000Z', '2026-10-31T10:00:00.000Z', 1);
    `);

    await stopRunningEntry('break', 1, null);

    expect(await database.getAllAsync(breaksSql)).toEqual([]);
    expect(await database.getAllAsync<SegmentRow>(segmentsSql)).toEqual([
      { piece_id: 1, started_at: '2026-10-31T09:00:00.000Z', ended_at: '2026-10-31T10:00:00.000Z' },
    ]);
    expect(await getRunningEntry()).toBeNull();
  });

  // Otherwise Pick a time would save some other end than the one picked.
  it('ends the entry at the picked time', async () => {
    await database.execAsync(`
      INSERT INTO breaks (id, started_at) VALUES (1, '2026-10-31T10:00:00.000Z');
    `);

    await stopRunningEntry('break', 1, '2026-10-31T10:45:00.000Z');

    expect(await database.getAllAsync(breaksSql)).toEqual([
      { started_at: '2026-10-31T10:00:00.000Z', ended_at: '2026-10-31T10:45:00.000Z' },
    ]);
  });

  // Otherwise a mistyped time would save a negative entry or one that ends in the future.
  it('rejects a picked time before the start or after now', async () => {
    await database.execAsync(`
      INSERT INTO work_segments (id, piece_id, started_at) VALUES (1, 1, '2026-10-31T09:00:00.000Z');
    `);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await expect(stopRunningEntry('segment', 1, '2026-10-31T08:00:00.000Z')).rejects.toThrow(
      "The end can't be before it started.",
    );
    await expect(stopRunningEntry('segment', 1, tomorrow)).rejects.toThrow(
      "The end can't be later than now.",
    );
    expect(await getRunningEntry()).toMatchObject({ kind: 'segment', id: 1 });
  });

  // Otherwise an old question answered late would move the end of a clock that already stopped.
  it('fails when the entry was already ended somewhere else', async () => {
    await database.execAsync(`
      INSERT INTO breaks (id, started_at, ended_at) VALUES
        (1, '2026-10-31T10:00:00.000Z', '2026-10-31T10:30:00.000Z');
    `);

    await expect(stopRunningEntry('break', 1, null)).rejects.toThrow("That's already stopped.");
    expect(await database.getAllAsync(breaksSql)).toEqual([
      { started_at: '2026-10-31T10:00:00.000Z', ended_at: '2026-10-31T10:30:00.000Z' },
    ]);
  });
});
