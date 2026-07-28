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
  player: {
    profileId: 'profile:test',
    created: true,
    name: '凯利安',
    classMain: 'mage',
    subclass: 'alchemist',
    level: 7,
    experience: 32,
    experienceToNext: 300,
    hp: 75,
    hpMax: 80,
    mp: 25,
    mpMax: 30,
    attack: 8,
    defense: 5,
    speed: 5,
    actionPointsPerTurn: 5,
    drawPerTurn: 5,
    statPoints: 0,
    gold: 500,
    reclassCount: 0,
    updatedAt: 1,
  },
  statAllocations: {
    profileId: 'profile:test',
    hpMax: 0,
    mpMax: 0,
    attack: 0,
    defense: 0,
    speed: 0,
    actionPointsPerTurn: 0,
    actionPointCosts: [],
    updatedAt: 1,
  },
  world: {
    profileId: 'profile:test',
    region: '伊拉亚城',
    place: '集市',
    location: '伊拉亚城-集市',
    gameDate: '新圣约历1385-09-01',
    gameTime: '08:00',
    weather: '晴朗',
    mainStage: 1,
    mainStep: 2,
    updatedAt: 1,
  },
  regionAccess: [],
  guild: {
    profileId: 'profile:test',
    rank: 'copper',
    experience: 20,
    completedTaskCount: 1,
    updatedAt: 1,
  },
  quests: [
    {
      id: 'quest:1',
      profileId: 'profile:test',
      kind: 'main',
      title: '新的旅途',
      region: '伊拉亚城',
      objective: '前往协会',
      status: 'active',
      currentStage: 1,
      totalStages: 3,
      rewardExperience: 100,
      rewardGold: 50,
      rewardGuildExperience: 10,
      updatedAt: 1,
    },
  ],
  questHistory: [],
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
  equipment: [],
  loadout: {
    profileId: 'profile:test',
    weaponId: null,
    armorId: null,
    accessoryId: null,
    updatedAt: 1,
  },
  cards: [],
  decks: [],
  relics: [],
  passives: [],
  battle: null,
  achievements: [],
  settings: {
    id: 'profile:test',
    profileId: 'profile:test',
    preserveAdventureSave: false,
    battleDifficulty: 'normal',
    updatedAt: 1,
  },
};

describe('createAiProjection', () => {
  it('只投影 AI 所需摘要，不包含本地背包和卡牌明细', () => {
    const projection = createAiProjection(snapshot, 'alpha', 4);
    const serialized = JSON.stringify(projection);

    expect(projection.schemaVersion).toBe(2);
    expect(projection.player.name).toBe('凯利安');
    expect(projection.world.location).toBe('伊拉亚城-集市');
    expect(projection.guild.activeQuests).toHaveLength(1);
    expect(serialized).not.toContain('secret-item');
    expect(serialized).not.toContain('不应进入 MVU');
    expect(serialized).not.toContain('inventory');
    expect(serialized).not.toContain('cards');
  });
});
