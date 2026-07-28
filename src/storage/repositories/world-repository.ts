import type { CaelianDatabase } from '@/storage/database';

export class WorldRepository {
  constructor(private readonly db: CaelianDatabase) {}

  async move(
    profileId: string,
    destination: {
      region: string;
      place: string;
      location: string;
    },
  ): Promise<void> {
    const current = await this.db.worldStates.get(profileId);
    if (!current) throw new Error('世界状态不存在');
    await this.db.worldStates.put({
      ...current,
      ...destination,
      profileId,
      updatedAt: Date.now(),
    });
  }
}
