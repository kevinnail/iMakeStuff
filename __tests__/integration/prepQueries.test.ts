import { getDb } from '@/db/database';
import { finishPiece, getPieceDetail, getPieces, setPieceLost } from '@/db/queries/pieceQueries';
import {
  addPrepUse,
  changePrepUse,
  getAvailablePrep,
  removePrepUse,
  setPrepUsedUp,
} from '@/db/queries/prepQueries';
import { getActualPercent } from '@/utils/prepTime';
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

const finish = {
  endedAt: '2026-10-30T12:00:00.000Z',
  notes: 'Cobalt glaze',
  photoFileName: null,
  lost: false,
};

let database: ReturnType<typeof createTestDb>;

function use(prepId: number, estimatedPercent: number) {
  return { prepId, estimatedPercent };
}

async function getUsedUpAt(prepId: number) {
  const prep = await database.getFirstAsync<{ used_up_at: string | null }>(
    'SELECT used_up_at FROM pieces WHERE id = ?',
    prepId,
  );
  return prep?.used_up_at;
}

async function getUseId(pieceId: number, prepId: number) {
  const row = await database.getFirstAsync<{ id: number }>(
    'SELECT id FROM prep_uses WHERE piece_id = ? AND prep_id = ?',
    pieceId,
    prepId,
  );
  return row?.id ?? 0;
}

async function getActualPercents(prepId: number) {
  const usedBy = (await getPieceDetail(prepId))?.usedBy ?? [];
  return usedBy.map((row) => getActualPercent(row));
}

beforeEach(async () => {
  database = createTestDb();
  (getDb as jest.Mock).mockResolvedValue(database);
  await database.execAsync(fixturesSql);
});

describe('finishPiece with prep', () => {
  // Otherwise the prep picked in the panel after Done would be lost when the piece is saved.
  it('saves each prep used with its percent and the prep worked time', async () => {
    await finishPiece(vaseId, { ...finish, prepUses: [use(caneId, 25), use(fritId, 10)] });

    const detail = await getPieceDetail(vaseId);
    expect(detail?.piece.finished_at).toBe(finish.endedAt);
    expect(detail?.usedPrep).toEqual([
      {
        id: expect.any(Number),
        piece_id: vaseId,
        prep_id: caneId,
        prep_name: 'Dichroic cane',
        estimated_percent: 25,
        prep_used_up: 0,
        estimates_total: 25,
        prep_worked_milliseconds: 4 * hour + 40 * minute,
      },
      {
        id: expect.any(Number),
        piece_id: vaseId,
        prep_id: fritId,
        prep_name: 'Frit mix',
        estimated_percent: 10,
        prep_used_up: 0,
        estimates_total: 10,
        prep_worked_milliseconds: 2 * hour,
      },
    ]);
  });

  // Otherwise a rejected prep would still leave the piece finished without the prep it used.
  it('leaves the piece unfinished when a prep use is rejected', async () => {
    await expect(
      finishPiece(vaseId, { ...finish, prepUses: [use(caneId, 25), use(unfinishedPrepId, 10)] }),
    ).rejects.toThrow("Only finished prep that isn't used up or lost can be used.");

    const detail = await getPieceDetail(vaseId);
    expect(detail?.piece.finished_at).toBeNull();
    expect(detail?.usedPrep).toEqual([]);
  });
});

describe('addPrepUse', () => {
  // Otherwise a mistyped percent would put no share, or more than the whole prep, on a piece.
  it.each([0, 101])('rejects a percent of %i', async (estimatedPercent) => {
    await expect(addPrepUse(vaseId, use(caneId, estimatedPercent))).rejects.toThrow(
      /CHECK constraint/,
    );
  });

  // Otherwise one piece could carry the same prep twice and count its share twice.
  it('rejects the same prep twice on one piece', async () => {
    await addPrepUse(vaseId, use(caneId, 25));

    await expect(addPrepUse(vaseId, use(caneId, 10))).rejects.toThrow(/UNIQUE constraint/);
  });

  // Otherwise a piece's time, or prep still being made, could be counted as prep on another piece.
  it.each([
    ['a piece', bowlId],
    ['unfinished prep', unfinishedPrepId],
  ])('rejects using %s as prep', async (_kind, prepId) => {
    await expect(addPrepUse(vaseId, use(prepId, 25))).rejects.toThrow(
      "Only finished prep that isn't used up or lost can be used.",
    );
    expect((await getPieceDetail(vaseId))?.usedPrep).toEqual([]);
  });

  // Otherwise a cane that's gone could keep collecting shares from new pieces.
  it('rejects a new use on used-up prep', async () => {
    await setPrepUsedUp(caneId, true);

    await expect(addPrepUse(vaseId, use(caneId, 25))).rejects.toThrow(
      "Only finished prep that isn't used up or lost can be used.",
    );
  });
});

describe('lost prep and lost pieces', () => {
  // Otherwise a cane that shattered while pulling could be picked for a piece.
  it('rejects a use of lost prep and leaves it out of Add prep', async () => {
    await setPieceLost(caneId, true);

    await expect(addPrepUse(vaseId, use(caneId, 25))).rejects.toThrow(
      "Only finished prep that isn't used up or lost can be used.",
    );
    expect(await getAvailablePrep(vaseId)).toEqual([
      { id: fritId, name: 'Frit mix', percent_left: 100 },
    ]);
  });

  // Otherwise the cane that went in the garbage with a broken piece would drop off its time.
  it('keeps a lost piece its prep uses', async () => {
    await addPrepUse(bowlId, use(caneId, 25));

    await setPieceLost(bowlId, true);

    expect((await getPieceDetail(bowlId))?.usedPrep).toEqual([
      expect.objectContaining({ prep_id: caneId, estimated_percent: 25 }),
    ]);
  });
});

describe('changePrepUse and removePrepUse', () => {
  // Otherwise a wrong guess on a piece's page could never be corrected.
  it('changes a use and then removes it', async () => {
    await addPrepUse(vaseId, use(caneId, 25));
    const useId = await getUseId(vaseId, caneId);

    await changePrepUse(useId, 40);
    expect((await getPieceDetail(vaseId))?.usedPrep).toEqual([
      expect.objectContaining({ id: useId, estimated_percent: 40 }),
    ]);

    await removePrepUse(useId);
    expect((await getPieceDetail(vaseId))?.usedPrep).toEqual([]);
  });

  // Otherwise a stale page could report a change to a removed use as saved.
  it('fails for a use that no longer exists', async () => {
    await expect(changePrepUse(999, 40)).rejects.toThrow('That prep use no longer exists.');
    await expect(removePrepUse(999)).rejects.toThrow('That prep use no longer exists.');
  });
});

describe('setPrepUsedUp', () => {
  // Otherwise the cane's leftover time, waste included, would belong to no piece.
  it('scales every estimate to fill 100% when the prep is used up', async () => {
    await addPrepUse(vaseId, use(caneId, 25));
    await addPrepUse(bowlId, use(caneId, 25));

    await setPrepUsedUp(caneId, true);

    expect(await getUsedUpAt(caneId)).toEqual(expect.any(String));
    expect(await getActualPercents(caneId)).toEqual([50, 50]);
  });

  // Otherwise a mistaken Used up would hide the estimates and keep the prep out of Add prep.
  it('puts the prep back in use and the estimates show again', async () => {
    await addPrepUse(vaseId, use(caneId, 25));
    await setPrepUsedUp(caneId, true);

    await setPrepUsedUp(caneId, false);

    expect(await getUsedUpAt(caneId)).toBeNull();
    expect(await getActualPercents(caneId)).toEqual([25]);
    expect(await getAvailablePrep(bowlId)).toEqual([
      { id: fritId, name: 'Frit mix', percent_left: 100 },
      { id: caneId, name: 'Dichroic cane', percent_left: 75 },
    ]);
  });

  // Otherwise a second tap would move the used up date, or prep still being made could be used up.
  it('fails for prep already in the state asked for, or unfinished prep', async () => {
    await setPrepUsedUp(caneId, true);

    await expect(setPrepUsedUp(caneId, true)).rejects.toThrow(
      "Only finished prep that isn't used up can be marked used up.",
    );
    await expect(setPrepUsedUp(unfinishedPrepId, true)).rejects.toThrow(
      "Only finished prep that isn't used up can be marked used up.",
    );
    await expect(setPrepUsedUp(fritId, false)).rejects.toThrow("That prep isn't used up.");
  });
});

describe('getAvailablePrep', () => {
  // Otherwise Add prep would offer prep that can't be saved, or the percent left would be wrong.
  it('lists finished prep newest first with what is left, leaving out prep the piece uses', async () => {
    await addPrepUse(bowlId, use(caneId, 30));
    await addPrepUse(vaseId, use(fritId, 10));

    expect(await getAvailablePrep(vaseId)).toEqual([
      { id: caneId, name: 'Dichroic cane', percent_left: 70 },
    ]);
    expect(await getAvailablePrep(bowlId)).toEqual([
      { id: fritId, name: 'Frit mix', percent_left: 90 },
    ]);
  });

  // Otherwise estimates past 100% would block the next use or show a negative amount left.
  it('allows estimates past 100% and shows 0% left', async () => {
    await addPrepUse(vaseId, use(caneId, 70));
    await addPrepUse(bowlId, use(caneId, 60));

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
    await addPrepUse(vaseId, use(caneId, 25));
    await addPrepUse(bowlId, use(caneId, 35));

    expect((await getPieceDetail(caneId))?.usedBy).toEqual([
      {
        id: expect.any(Number),
        piece_id: vaseId,
        piece_name: 'Blue vase',
        estimated_percent: 25,
        prep_used_up: 0,
        estimates_total: 60,
      },
      {
        id: expect.any(Number),
        piece_id: bowlId,
        piece_name: 'Green bowl',
        estimated_percent: 35,
        prep_used_up: 0,
        estimates_total: 60,
      },
    ]);
  });
});

describe('getPieces with prep', () => {
  // Otherwise the Pieces list would show a different prep time than the piece's own page.
  it('gives each piece its prep time rounded down per prep, and none for a piece without prep', async () => {
    await addPrepUse(vaseId, use(caneId, 25));
    await addPrepUse(vaseId, use(fritId, 33));

    const pieces = await getPieces();
    expect(pieces.find((piece) => piece.id === vaseId)).toMatchObject({
      prep_milliseconds: (70 + 39) * minute,
      prep_estimated: true,
    });
    expect(pieces.find((piece) => piece.id === bowlId)?.prep_milliseconds).toBeNull();
  });

  // Otherwise the list would keep showing estimates after the prep's real shares are known.
  it('switches a piece to actual prep time once its prep is used up', async () => {
    await addPrepUse(vaseId, use(caneId, 25));
    await setPrepUsedUp(caneId, true);

    expect((await getPieces()).find((piece) => piece.id === vaseId)).toMatchObject({
      prep_milliseconds: 4 * hour + 40 * minute,
      prep_estimated: false,
    });
  });
});
