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
import type { FinishSupplyUse } from '@/db/queries/supplyQueries';
import { deletePhoto, withSavedPhoto } from '@/utils/photoStorage';
import type { SizeInput } from '@/utils/prepTime';
import { startOfDay } from '@/utils/workDays';
import { getWorkTimerContent } from '@/utils/workTimer';
import { showWorkTimer } from '@/widgets/WorkTimerActivity';

interface FinishInput extends SizeInput {
  notes: string | null;
  // A photo just taken at Done, or null to keep the photo taken before it (if any).
  cameraPhotoUri: string | null;
  savedPhotoFileName: string | null;
  lost: boolean;
  prepUses: FinishPrepUse[];
  supplyUses: FinishSupplyUse[];
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

// Shows what's in the database on the Work screen, then on the Lock Screen and in the Dynamic
// Island, so the timer there changes with every tap that changes what's running.
async function showWork(set: (work: Partial<WorkState>) => void) {
  const work = await readWork();
  set(work);
  await showWorkTimer(getWorkTimerContent(work.pieces, work.runningBreak));
}

export const useWorkStore = create<WorkState>()((set) => ({
  pieces: [],
  runningBreak: null,
  runningEntry: null,
  templates: [],
  today: { segments: [], breaks: [], finishedPieces: [] },

  load: async () => {
    set({ templates: await getTemplates() });
    await showWork(set);
  },
  start: async (name, category) => {
    await startPiece(name, category);
    await showWork(set);
  },
  startFromTemplate: async (templateId) => {
    await startFromTemplate(templateId);
    await showWork(set);
  },
  switchTo: async (pieceId) => {
    await switchToPiece(pieceId);
    await showWork(set);
  },
  addPhoto: async (piece, cameraPhotoUri) => {
    await withSavedPhoto(cameraPhotoUri, (photoFileName) => setPiecePhoto(piece.id, photoFileName));
    if (piece.photo_file_name) deletePhoto(piece.photo_file_name);
    await showWork(set);
  },
  finish: async (
    pieceId,
    { notes, cameraPhotoUri, savedPhotoFileName, lost, prepUses, supplyUses, sizeAmount, sizeUnit },
  ) => {
    const endedAt = new Date().toISOString();
    await withSavedPhoto(cameraPhotoUri, (photoFileName) =>
      finishPiece(pieceId, {
        endedAt,
        notes,
        photoFileName: photoFileName ?? savedPhotoFileName,
        lost,
        prepUses,
        supplyUses,
        sizeAmount,
        sizeUnit,
      }),
    );
    await showWork(set);
  },
  remove: async (pieceId) => {
    const photoFileName = await deletePiece(pieceId);
    if (photoFileName) deletePhoto(photoFileName);
    await showWork(set);
  },
  takeBreak: async () => {
    await startBreak();
    await showWork(set);
  },
  backToWork: async () => {
    await endBreak();
    await showWork(set);
  },
  endDay: async () => {
    await endDay();
    await showWork(set);
  },
  confirmRunning: async (entry) => {
    await confirmRunningEntry(entry.kind, entry.id);
    await showWork(set);
  },
  stopRunning: async (entry, endedAt) => {
    await stopRunningEntry(entry.kind, entry.id, endedAt);
    await showWork(set);
  },
}));
