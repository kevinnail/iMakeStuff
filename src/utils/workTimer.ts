import type { RunningBreak } from '@/db/queries/breakQueries';
import type { UnfinishedPiece } from '@/db/queries/pieceQueries';
import { colors } from '@/theme';

// What the Lock Screen and the Dynamic Island show. iOS counts up from countingFrom on its own.
export interface WorkTimerContent {
  title: string;
  color: string;
  // Milliseconds since 1970.
  countingFrom: number;
}

export function getWorkTimerContent(
  pieces: UnfinishedPiece[],
  runningBreak: RunningBreak | null,
): WorkTimerContent | null {
  if (runningBreak) {
    return {
      title: 'On break',
      color: colors.accent,
      countingFrom: Date.parse(runningBreak.started_at),
    };
  }
  const runningPiece = pieces.find((piece) => piece.running_since !== null);
  if (!runningPiece?.running_since) return null;
  return {
    title: runningPiece.name,
    color: runningPiece.category === 'prep' ? colors.prep : colors.primary,
    countingFrom: Date.parse(runningPiece.running_since) - runningPiece.worked_milliseconds,
  };
}
