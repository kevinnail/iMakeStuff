import { create } from 'zustand';

import {
  getRunningPieces,
  startPiece,
  stopPiece,
  type RunningPiece,
} from '@/db/queries/pieceQueries';

interface WorkState {
  runningPieces: RunningPiece[];
  load: () => Promise<void>;
  start: (name: string) => Promise<void>;
  stop: (pieceId: number) => Promise<void>;
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
  stop: async (pieceId) => {
    await stopPiece(pieceId);
    set({ runningPieces: await getRunningPieces() });
  },
}));
