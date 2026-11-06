import { create } from 'zustand';

import {
  endBreak,
  getRunningBreak,
  startBreak,
  type RunningBreak,
} from '@/db/queries/breakQueries';
import { getWorkRecords, type WorkRecords } from '@/db/queries/dayQueries';
import {
  confirmRunningEntry,
  getRunningEntry,
  stopRunningEntry,
  type RunningEntry,
} from '@/db/queries/entryQueries';
import {
  deletePiece,
  endDay,
  finishPiece,
  getTemplates,
  getUnfinishedPieces,
  setPiecePhoto,
  startFromTemplate,
  startPiece,
  switchToPiece,
  type PieceCategory,
  type Template,
  type UnfinishedPiece,
} from '@/db/queries/pieceQueries';
import type { FinishPrepUse } from '@/db/queries/prepQueries';
import { deletePhoto, withSavedPhoto } from '@/utils/photoStorage';
import { startOfDay } from '@/utils/workDays';

interface FinishInput {
  notes: string | null;
  // A photo just taken at Done, or null to keep the photo taken before it (if any).
  cameraPhotoUri: string | null;
  savedPhotoFileName: string | null;
  lost: boolean;
  prepUses: FinishPrepUse[];
}

interface WorkState {
  pieces: UnfinishedPiece[];
  runningBreak: RunningBreak | null;
  // The running piece's segment or the running break, for the Still working question.
  runningEntry: RunningEntry | null;
  // For starting another one like a piece made before.
  templates: Template[];
  // Everything since midnight, for the line about today on the Work screen.
  today: WorkRecords;
  load: () => Promise<void>;
  start: (name: string, category: PieceCategory) => Promise<void>;
  startFromTemplate: (templateId: number) => Promise<void>;
  switchTo: (pieceId: number) => Promise<void>;
  addPhoto: (piece: UnfinishedPiece, cameraPhotoUri: string) => Promise<void>;
  finish: (pieceId: number, input: FinishInput) => Promise<void>;
  remove: (pieceId: number) => Promise<void>;
  takeBreak: () => Promise<void>;
  backToWork: () => Promise<void>;
  endDay: () => Promise<void>;
  confirmRunning: (entry: RunningEntry) => Promise<void>;
  stopRunning: (entry: RunningEntry, endedAt: string | null) => Promise<void>;
}

async function readWork() {
  const midnight = new Date(startOfDay(Date.now())).toISOString();
  const [pieces, runningBreak, runningEntry, today] = await Promise.all([
    getUnfinishedPieces(),
    getRunningBreak(),
    getRunningEntry(),
    getWorkRecords(midnight),
  ]);
  return { pieces, runningBreak, runningEntry, today };
}

export const useWorkStore = create<WorkState>()((set) => ({
  pieces: [],
  runningBreak: null,
  runningEntry: null,
  templates: [],
  today: { segments: [], breaks: [], finishedPieces: [] },

  load: async () => {
    const [work, templates] = await Promise.all([readWork(), getTemplates()]);
    set({ ...work, templates });
  },
  start: async (name, category) => {
    await startPiece(name, category);
    set(await readWork());
  },
  startFromTemplate: async (templateId) => {
    await startFromTemplate(templateId);
    set(await readWork());
  },
  switchTo: async (pieceId) => {
    await switchToPiece(pieceId);
    set(await readWork());
  },
  addPhoto: async (piece, cameraPhotoUri) => {
    await withSavedPhoto(cameraPhotoUri, (photoFileName) => setPiecePhoto(piece.id, photoFileName));
    if (piece.photo_file_name) deletePhoto(piece.photo_file_name);
    set(await readWork());
  },
  finish: async (pieceId, { notes, cameraPhotoUri, savedPhotoFileName, lost, prepUses }) => {
    const endedAt = new Date().toISOString();
    await withSavedPhoto(cameraPhotoUri, (photoFileName) =>
      finishPiece(pieceId, {
        endedAt,
        notes,
        photoFileName: photoFileName ?? savedPhotoFileName,
        lost,
        prepUses,
      }),
    );
    set(await readWork());
  },
  remove: async (pieceId) => {
    const photoFileName = await deletePiece(pieceId);
    if (photoFileName) deletePhoto(photoFileName);
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
  confirmRunning: async (entry) => {
    await confirmRunningEntry(entry.kind, entry.id);
    set(await readWork());
  },
  stopRunning: async (entry, endedAt) => {
    await stopRunningEntry(entry.kind, entry.id, endedAt);
    set(await readWork());
  },
}));
