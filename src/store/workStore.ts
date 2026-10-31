import { create } from 'zustand';

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
  load: () => Promise<void>;
  start: (name: string) => Promise<void>;
  finish: (pieceId: number, input: FinishInput) => Promise<void>;
}

// Every action rereads the running pieces from the database, so the screen always
// shows what is stored, including timers that kept running while the app was closed.
export const useWorkStore = create<WorkState>()((set) => ({
  runningPieces: [],
  load: async () => {
    set({ runningPieces: await getRunningPieces() });
  },
  start: async (name) => {
    await startPiece(name);
    set({ runningPieces: await getRunningPieces() });
  },
  finish: async (pieceId, { endedAt, notes, cameraPhotoUri }) => {
    const photoFileName = cameraPhotoUri ? await savePhoto(cameraPhotoUri) : null;
    try {
      await finishPiece(pieceId, { endedAt, notes, photoFileName });
    } catch (error) {
      if (photoFileName) deletePhoto(photoFileName);
      throw error;
    }
    set({ runningPieces: await getRunningPieces() });
  },
}));
