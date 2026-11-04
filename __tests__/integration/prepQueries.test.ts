import { getDb } from '@/db/database';
import { finishPiece, getPieceDetail, getPieces } from '@/db/queries/pieceQueries';
import {
  addPrepUse,
  changePrepUse,
  getAvailablePrep,
  removePrepUse,
} from '@/db/queries/prepQueries';
import { createTestDb } from '../setup';

jest.mock('@/db/database', () => ({
  getDb: jest.fn(),
}));

const hour = 60 * 60 * 1000;
const minute = 60 * 1000;

// Two finished preps (4h 40m and 2h worked), an unfinished prep, and two pieces.
const caneId = 1;
const fritId = 2;
const unfinishedPrepId = 3;
const vaseId = 4;
const bowlId = 5;

const fixturesSql = `
  INSERT INTO pieces (id, name, category, notes, finished_at) VALUES
    (${caneId}, 'Dichroic cane', 'prep', 'Blue', '2026-10-28T17:00:00.000Z'),
    (${fritId}, 'Frit mix', 'prep', 'Green', '2026-10-29T17:00:00.000Z'),
    (${unfinishedPrepId}, 'Red cane', 'prep', NULL, NULL),
    (${vaseId}, 'Blue vase', 'piece', NULL, NULL),
    (${bowlId}, 'Green bowl', 'piece', 'Lime', '2026-10-30T17:00:00.000Z');
  INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
    (${caneId}, '2026-10-28T09:00:00.000Z', '2026-10-28T13:00:00.000Z'),
    (${caneId}, '2026-10-28T14:00:00.000Z', '2026-10-28T14:40:00.000Z'),
    (${fritId}, '2026-10-29T09:00:00.000Z', '2026-10-29T11:00:00.000Z'),
    (${unfinishedPrepId}, '2026-10-29T12:00:00.000Z', '2026-10-29T13:00:00.000Z'),
    (${vaseId}, '2026-10-30T09:00:00.000Z', '2026-10-30T12:00:00.000Z'),
    (${bowlId}, '2026-10-30T13:00:00.000Z', '2026-10-30T16:00:00.000Z');
`;

const finish = { endedAt: '2026-10-30T12:00:00.000Z', notes: 'Cobalt glaze', photoFileName: null };

let database: ReturnType<typeof createTestDb>;

beforeEach(async () => {
  database = createTestDb();
  (getDb as jest.Mock).mockResolvedValue(database);
  await database.execAsync(fixturesSql);
});

describe('finishPiece with prep', () => {
  // Otherwise the prep picked in the panel after Done would be lost when the piece is saved.
  it('saves each prep used with its percent and the prep worked time', async () => {
    await finishPiece(vaseId, {
      ...finish,
      prepUses: [
        { prepId: caneId, estimatedPercent: 25 },
        { prepId: fritId, estimatedPercent: 10 },
      ],
    });

    const detail = await getPieceDetail(vaseId);
    expect(detail?.piece.finished_at).toBe(finish.endedAt);
    expect(detail?.usedPrep).toEqual([
      {
        id: expect.any(Number),
        piece_id: vaseId,
        prep_id: caneId,
        prep_name: 'Dichroic cane',
        estimated_percent: 25,
        prep_worked_milliseconds: 4 * hour + 40 * minute,
      },
      {
        id: expect.any(Number),
        piece_id: vaseId,
        prep_id: fritId,
        prep_name: 'Frit mix',
        estimated_percent: 10,
        prep_worked_milliseconds: 2 * hour,
      },
    ]);
  });

  // Otherwise a rejected prep would still leave the piece finished without the prep it used.
  it('leaves the piece unfinished when a prep use is rejected', async () => {
    await expect(
      finishPiece(vaseId, {
        ...finish,
        prepUses: [
          { prepId: caneId, estimatedPercent: 25 },
          { prepId: unfinishedPrepId, estimatedPercent: 10 },
        ],
      }),
    ).rejects.toThrow("Only finished prep that isn't used up can be used.");

    const detail = await getPieceDetail(vaseId);
    expect(detail?.piece.finished_at).toBeNull();
    expect(detail?.usedPrep).toEqual([]);
  });
});

describe('addPrepUse', () => {
  // Otherwise a mistyped percent would put no share, or more than the whole prep, on a piece.
  it.each([0, 101])('rejects a percent of %i', async (estimatedPercent) => {
    await expect(addPrepUse(vaseId, { prepId: caneId, estimatedPercent })).rejects.toThrow(
      /CHECK constraint/,
    );
  });

  // Otherwise one piece could carry the same prep twice and count its share twice.
  it('rejects the same prep twice on one piece', async () => {
    await addPrepUse(vaseId, { prepId: caneId, estimatedPercent: 25 });

    await expect(addPrepUse(vaseId, { prepId: caneId, estimatedPercent: 10 })).rejects.toThrow(
      /UNIQUE constraint/,
    );
  });

  // Otherwise a piece's time, or prep still being made, could be counted as prep on another piece.
  it.each([
    ['a piece', bowlId],
    ['unfinished prep', unfinishedPrepId],
  ])('rejects using %s as prep', async (_kind, prepId) => {
    await expect(addPrepUse(vaseId, { prepId, estimatedPercent: 25 })).rejects.toThrow(
      "Only finished prep that isn't used up can be used.",
    );
    expect((await getPieceDetail(vaseId))?.usedPrep).toEqual([]);
  });
});

describe('changePrepUse and removePrepUse', () => {
  // Otherwise a wrong guess on a piece's page could never be corrected.
  it('changes a use and then removes it', async () => {
    await addPrepUse(vaseId, { prepId: caneId, estimatedPercent: 25 });
    const [use] = (await getPieceDetail(vaseId))?.usedPrep ?? [];

    await changePrepUse(use.id, 40);
    expect((await getPieceDetail(vaseId))?.usedPrep).toEqual([
      expect.objectContaining({ id: use.id, estimated_percent: 40 }),
    ]);

    await removePrepUse(use.id);
    expect((await getPieceDetail(vaseId))?.usedPrep).toEqual([]);
  });

  // Otherwise a stale page could report a change to a removed use as saved.
  it('fails for a use that no longer exists', async () => {
    await expect(changePrepUse(999, 40)).rejects.toThrow('That prep use no longer exists.');
    await expect(removePrepUse(999)).rejects.toThrow('That prep use no longer exists.');
  });
});

describe('getAvailablePrep', () => {
  // Otherwise Add prep would offer prep that can't be saved, or the percent left would be wrong.
  it('lists finished prep newest first with what is left, leaving out prep the piece uses', async () => {
    await addPrepUse(bowlId, { prepId: caneId, estimatedPercent: 30 });
    await addPrepUse(vaseId, { prepId: fritId, estimatedPercent: 10 });

    expect(await getAvailablePrep(vaseId)).toEqual([
      { id: caneId, name: 'Dichroic cane', percent_left: 70 },
    ]);
    expect(await getAvailablePrep(bowlId)).toEqual([
      { id: fritId, name: 'Frit mix', percent_left: 90 },
    ]);
  });

  // Otherwise estimates past 100% would block the next use or show a negative amount left.
  it('allows estimates past 100% and shows 0% left', async () => {
    await addPrepUse(vaseId, { prepId: caneId, estimatedPercent: 70 });
    await addPrepUse(bowlId, { prepId: caneId, estimatedPercent: 60 });

    const otherPieceId = 6;
    await database.execAsync(
      `INSERT INTO pieces (id, name, category) VALUES (${otherPieceId}, 'Red cup', 'piece')`,
    );
    expect(await getAvailablePrep(otherPieceId)).toEqual([
      { id: fritId, name: 'Frit mix', percent_left: 100 },
      { id: caneId, name: 'Dichroic cane', percent_left: 0 },
    ]);
  });
});

describe('getPieceDetail for prep', () => {
  // Otherwise the prep's page couldn't show which pieces used it or how much is gone.
  it('lists the pieces that used the prep with their percents', async () => {
    await addPrepUse(vaseId, { prepId: caneId, estimatedPercent: 25 });
    await addPrepUse(bowlId, { prepId: caneId, estimatedPercent: 35 });

    expect((await getPieceDetail(caneId))?.usedBy).toEqual([
      { id: expect.any(Number), piece_id: vaseId, piece_name: 'Blue vase', estimated_percent: 25 },
      { id: expect.any(Number), piece_id: bowlId, piece_name: 'Green bowl', estimated_percent: 35 },
    ]);
  });
});

describe('getPieces with prep', () => {
  // Otherwise the Pieces list would show a different prep time than the piece's own page.
  it('gives each piece its prep time rounded down per prep, and none for a piece without prep', async () => {
    await addPrepUse(vaseId, { prepId: caneId, estimatedPercent: 25 });
    await addPrepUse(vaseId, { prepId: fritId, estimatedPercent: 33 });

    const pieces = await getPieces();
    expect(pieces.find((piece) => piece.id === vaseId)?.prep_milliseconds).toBe((70 + 39) * minute);
    expect(pieces.find((piece) => piece.id === bowlId)?.prep_milliseconds).toBeNull();
  });
});
