import { getDb } from '@/db/database';
import type { PieceCategory } from '@/db/queries/pieceQueries';
import { getUsedPrep, noCostSql } from '@/db/queries/prepQueries';
import { getUsedSupplies } from '@/db/queries/supplyQueries';
import { getCost } from '@/utils/cost';
import { groupByPiece } from '@/utils/prepTime';
import type { TimeRange } from '@/utils/workDays';

export interface FinishedPiece {
  id: number;
  name: string;
  category: PieceCategory;
  photo_file_name: string | null;
  finished_at: string;
  lost: number;
  no_cost: number;
}

export interface WorkRecords {
  segments: TimeRange[];
  breaks: TimeRange[];
  finishedPieces: FinishedPiece[];
}

export interface DayCost {
  cents: number;
  // true when any piece's cost includes a by eye guess.
  estimated: boolean;
  pieceCount: number;
}

// The supply cost of the pieces finished in the range, lost ones included since their supplies
// were spent, each worked out the same way as on the Pieces tab. Prep is left out: its cost
// reaches the day through the pieces that use it. Null when no piece finished.
export async function getDayCost(from: string, to: string): Promise<DayCost | null> {
  const database = await getDb();
  const [pieces, usedPrep, usedSupplies] = await Promise.all([
    database.getAllAsync<{ id: number }>(
      `SELECT id FROM pieces
       WHERE category = 'piece' AND finished_at >= ? AND finished_at < ?`,
      from,
      to,
    ),
    getUsedPrep(database, null),
    getUsedSupplies(database, null),
  ]);
  if (pieces.length === 0) return null;
  const prepByPiece = groupByPiece(usedPrep);
  const supplyByPiece = groupByPiece(usedSupplies);
  const costs = pieces.map((piece) => getCost(piece.id, prepByPiece, supplyByPiece));
  return {
    cents: costs.reduce((total, cost) => total + cost.cents, 0),
    estimated: costs.some((cost) => cost.estimated),
    pieceCount: pieces.length,
  };
}

export async function getWorkRecords(since: string): Promise<WorkRecords> {
  const database = await getDb();
  const [segments, breaks, finishedPieces] = await Promise.all([
    database.getAllAsync<TimeRange>(
      `SELECT started_at, ended_at FROM work_segments
       WHERE ended_at IS NULL OR ended_at > ? ORDER BY started_at`,
      since,
    ),
    database.getAllAsync<TimeRange>(
      `SELECT started_at, ended_at FROM breaks
       WHERE ended_at IS NULL OR ended_at > ? ORDER BY started_at`,
      since,
    ),
    database.getAllAsync<FinishedPiece>(
      `SELECT id, name, category, photo_file_name, finished_at, lost, ${noCostSql} AS no_cost
       FROM pieces WHERE finished_at > ? ORDER BY finished_at`,
      since,
    ),
  ]);
  return { segments, breaks, finishedPieces };
}
