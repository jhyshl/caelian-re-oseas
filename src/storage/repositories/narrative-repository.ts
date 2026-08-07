import type { MvuNarrativePatch } from '@/mvu/contracts';
import { relationshipStage } from '@/mvu/contracts';
import type { CaelianDatabase } from '@/storage/database';
import { defaultSocialProgress } from '@/storage/defaults';
import { canonicalWorldLocation } from '@/worldbook/location-state';

export class NarrativeRepository {
  constructor(private readonly db: CaelianDatabase) {}

  async update(
    profileId: string,
    patch: MvuNarrativePatch,
  ): Promise<void> {
    const now = Date.now();
    if (patch.companion) {
      const id = `${profileId}:caelian`;
      const current =
        (await this.db.socialProgress.get(id)) ??
        defaultSocialProgress(profileId, now);
      const affinity = patch.companion.affinity ?? current.affinity;
      await this.db.socialProgress.put({
        ...current,
        ...patch.companion,
        affinity,
        relationshipStage: relationshipStage(affinity),
        updatedAt: now,
      });
    }

    if (patch.world) {
      const current = await this.db.worldStates.get(profileId);
      if (!current) throw new Error('世界状态不存在');
      const location = canonicalWorldLocation(current, patch.world);
      await this.db.worldStates.put({
        ...current,
        ...patch.world,
        ...location,
        profileId,
        updatedAt: now,
      });
    }

    if (patch.storyFlags) {
      await this.db.storyFlags.bulkPut(
        Object.entries(patch.storyFlags).map(([key, value]) => ({
          id: `${profileId}:${encodeURIComponent(key)}`,
          profileId,
          key,
          value,
          updatedAt: now,
        })),
      );
    }
  }
}
