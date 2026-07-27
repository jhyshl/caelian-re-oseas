import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '@/domain/types';
import { createAiProjection } from '@/mvu/projection';

const snapshot: GameSnapshot = {
  profile: {
    id: 'profile:test',
    chatId: 'test',
    createdAt: 1,
    updatedAt: 1,
  },
  character: {
    profileId: 'profile:test',
    name: '凯利安',
    className: '法师',
    subclass: '炼金术士',
    level: 7,
    updatedAt: 1,
  },
  world: {
    profileId: 'profile:test',
    region: '伊拉亚城',
    location: '集市',
    gameDate: '春月 3 日',
    storyFlags: ['met_guild'],
    updatedAt: 1,
  },
  quests: [
    {
      id: 'quest:1',
      profileId: 'profile:test',
      kind: 'main',
      title: '新的旅途',
      objective: '前往协会',
      status: 'active',
      updatedAt: 1,
    },
  ],
  inventory: [
    {
      id: 'profile:test:secret-item',
      profileId: 'profile:test',
      itemId: 'secret-item',
      name: '不应进入 MVU 的完整物品',
      quantity: 99,
      updatedAt: 1,
    },
  ],
};

describe('createAiProjection', () => {
  it('只投影 AI 所需摘要，不包含本地背包明细', () => {
    const projection = createAiProjection(snapshot, 'alpha', 4);
    const serialized = JSON.stringify(projection);

    expect(projection.player.name).toBe('凯利安');
    expect(projection.world.location).toBe('集市');
    expect(projection.guild.activeQuests).toHaveLength(1);
    expect(serialized).not.toContain('secret-item');
    expect(serialized).not.toContain('不应进入 MVU');
    expect(serialized).not.toContain('inventory');
  });
});
