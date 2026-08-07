import type { CaelianDatabase } from '@/storage/database';
import { canonicalWorldLocation } from '@/worldbook/location-state';

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
    const location = canonicalWorldLocation(current, destination);
    await this.db.worldStates.put({
      ...current,
      ...location,
      updatedAt: Date.now(),
    });
  }
}
