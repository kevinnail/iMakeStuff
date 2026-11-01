import { create } from 'zustand';

import {
  endBreak,
  getRunningBreak,
  startBreak,
  type RunningBreak,
} from '@/db/queries/breakQueries';
import {
  endDay,
  finishPiece,
  getUnfinishedPieces,
  startPiece,
  switchToPiece,
  type UnfinishedPiece,
} from '@/db/queries/pieceQueries';
import { deletePhoto, savePhoto } from '@/utils/photoStorage';

interface FinishInput {
  notes: string | null;
  cameraPhotoUri: string | null;
}

interface WorkState {
  pieces: UnfinishedPiece[];
  runningBreak: RunningBreak | null;
  load: () => Promise<void>;
  start: (name: string) => Promise<void>;
  switchTo: (pieceId: number) => Promise<void>;
  finish: (pieceId: number, input: FinishInput) => Promise<void>;
  takeBreak: () => Promise<void>;
  backToWork: () => Promise<void>;
  endDay: () => Promise<void>;
}

async function readWork() {
  const [pieces, runningBreak] = await Promise.all([getUnfinishedPieces(), getRunningBreak()]);
  return { pieces, runningBreak };
}

export const useWorkStore = create<WorkState>()((set) => ({
  pieces: [],
  runningBreak: null,
  load: async () => {
    set(await readWork());
  },
  start: async (name) => {
    await startPiece(name);
    set(await readWork());
  },
  switchTo: async (pieceId) => {
    await switchToPiece(pieceId);
    set(await readWork());
  },
  // The finish time is the moment Save is tapped.
  finish: async (pieceId, { notes, cameraPhotoUri }) => {
    const endedAt = new Date().toISOString();
    const photoFileName = cameraPhotoUri ? await savePhoto(cameraPhotoUri) : null;
    try {
      await finishPiece(pieceId, { endedAt, notes, photoFileName });
    } catch (error) {
      if (photoFileName) deletePhoto(photoFileName);
      throw error;
    }
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
