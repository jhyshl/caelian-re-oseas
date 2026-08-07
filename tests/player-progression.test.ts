import { describe, expect, it } from 'vitest';
import {
  grantPlayerExperience,
  STAT_POINTS_PER_LEVEL,
} from '@/player/progression';

describe('玩家等级成长', () => {
  it('每提升一级获得 8 点属性点，多级提升会逐级累计', () => {
    const player = {
      level: 1,
      experience: 90,
      experienceToNext: 100,
      statPoints: 3,
      pendingLevelRewards: [],
    };

    const levelsGained = grantPlayerExperience(player, 170);

    expect(STAT_POINTS_PER_LEVEL).toBe(8);
    expect(levelsGained).toBe(2);
    expect(player).toEqual({
      level: 3,
      experience: 10,
      experienceToNext: 200,
      statPoints: 19,
      pendingLevelRewards: [
        {
          id: 'level-2',
          level: 2,
          equipmentIds: [],
          relicIds: [],
          equipmentClaimed: false,
          relicClaimed: false,
        },
        {
          id: 'level-3',
          level: 3,
          equipmentIds: [],
          relicIds: [],
          equipmentClaimed: false,
          relicClaimed: false,
        },
      ],
    });
  });
});
