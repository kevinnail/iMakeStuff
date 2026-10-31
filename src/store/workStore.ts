import { create } from 'zustand';

import {
  endBreak,
  getRunningBreak,
  startBreak,
  type RunningBreak,
} from '@/db/queries/breakQueries';
import {
  finishPiece,
  getRunningPieces,
  startPiece,
  type RunningPiece,
} from '@/db/queries/pieceQueries';
import { deletePhoto, savePhoto } from '@/utils/photoStorage';

interface FinishInput {
  endedAt: string;
  notes: string | null;
  cameraPhotoUri: string | null;
}

interface WorkState {
  runningPieces: RunningPiece[];
  runningBreak: RunningBreak | null;
  load: () => Promise<void>;
  start: (name: string) => Promise<void>;
  finish: (pieceId: number, input: FinishInput) => Promise<void>;
  takeBreak: () => Promise<void>;
  backToWork: () => Promise<void>;
}

async function readWork() {
  const [runningPieces, runningBreak] = await Promise.all([getRunningPieces(), getRunningBreak()]);
  return { runningPieces, runningBreak };
}

// Every action rereads the running pieces and break from the database, so the screen
// always shows what is stored, including timers that kept running while the app was closed.
export const useWorkStore = create<WorkState>()((set) => ({
  runningPieces: [],
  runningBreak: null,
  load: async () => {
    set(await readWork());
  },
  start: async (name) => {
    await startPiece(name);
    set(await readWork());
  },
  finish: async (pieceId, { endedAt, notes, cameraPhotoUri }) => {
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
}));
