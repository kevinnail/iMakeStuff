import { getDb } from '@/db/database';
import { getGuideSeen, markGuideSeen } from '@/db/queries/settingsQueries';
import { createTestDb } from '../setup';

jest.mock('@/db/database', () => ({
  getDb: jest.fn(),
}));

let database: ReturnType<typeof createTestDb>;

beforeEach(() => {
  database = createTestDb();
  (getDb as jest.Mock).mockResolvedValue(database);
});

describe('first-run guide', () => {
  // Otherwise a new install would open without the guide.
  it('is unseen in a new database', async () => {
    expect(await getGuideSeen()).toBe(false);
  });

  // Otherwise the guide would come back on every open after it was finished or skipped.
  it('stays seen once marked, keeping the first time it was seen', async () => {
    await markGuideSeen();
    const [{ guide_seen_at: firstSeen }] = await database.getAllAsync<{ guide_seen_at: string }>(
      'SELECT guide_seen_at FROM settings',
    );

    await markGuideSeen();

    expect(await getGuideSeen()).toBe(true);
    expect(await database.getAllAsync('SELECT guide_seen_at FROM settings')).toEqual([
      { guide_seen_at: firstSeen },
    ]);
  });
});
