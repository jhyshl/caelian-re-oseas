import type { CaelianDatabase } from '@/storage/database';

export class WorldRepository {
  constructor(private readonly db: CaelianDatabase) {}

  async move(
    _profileId: string,
    _destination: {
      region: string;
      place: string;
      location: string;
    },
  ): Promise<void> {
    void _profileId;
    void _destination;
    void this.db;
    throw new Error(
      '世界状态只能由 AI 在 MVU narrative.world 中更新；脚本不会自行移动。',
    );
  }
}
