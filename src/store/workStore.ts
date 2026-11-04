import { create } from 'zustand';

import {
  endBreak,
  getRunningBreak,
  startBreak,
  type RunningBreak,
} from '@/db/queries/breakQueries';
import { getWorkRecords, type WorkRecords } from '@/db/queries/dayQueries';
import {
  endDay,
  finishPiece,
  getUnfinishedPieces,
  startPiece,
  switchToPiece,
  type PieceCategory,
  type UnfinishedPiece,
} from '@/db/queries/pieceQueries';
import type { NewPrepUse } from '@/db/queries/prepQueries';
import { withSavedPhoto } from '@/utils/photoStorage';
import { startOfDay } from '@/utils/workDays';

interface FinishInput {
  notes: string | null;
  cameraPhotoUri: string | null;
  prepUses: NewPrepUse[];
}

interface WorkState {
  pieces: UnfinishedPiece[];
  runningBreak: RunningBreak | null;
  // Everything since midnight, for the line about today on the Work screen.
  today: WorkRecords;
  load: () => Promise<void>;
  start: (name: string, category: PieceCategory) => Promise<void>;
  switchTo: (pieceId: number) => Promise<void>;
  finish: (pieceId: number, input: FinishInput) => Promise<void>;
  takeBreak: () => Promise<void>;
  backToWork: () => Promise<void>;
  endDay: () => Promise<void>;
}

async function readWork() {
  const midnight = new Date(startOfDay(Date.now())).toISOString();
  const [pieces, runningBreak, today] = await Promise.all([
    getUnfinishedPieces(),
    getRunningBreak(),
    getWorkRecords(midnight),
  ]);
  return { pieces, runningBreak, today };
}

export const useWorkStore = create<WorkState>()((set) => ({
  pieces: [],
  runningBreak: null,
  today: { segments: [], breaks: [], finishedPieces: [] },
  load: async () => {
    set(await readWork());
  },
  start: async (name, category) => {
    await startPiece(name, category);
    set(await readWork());
  },
  switchTo: async (pieceId) => {
    await switchToPiece(pieceId);
    set(await readWork());
  },
  finish: async (pieceId, { notes, cameraPhotoUri, prepUses }) => {
    const endedAt = new Date().toISOString();
    await withSavedPhoto(cameraPhotoUri, (photoFileName) =>
      finishPiece(pieceId, { endedAt, notes, photoFileName, prepUses }),
    );
    set(await readWork());
  },
  takeBreak: async () => {
    await startBreak();
    set(await readWork());
  },
  backToWork: async () => {
    await endBreak();
    set(await readWork());
  },
  endDay: async () => {
    await endDay();
    set(await readWork());
  },
}));
