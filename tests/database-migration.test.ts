import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import type { InventoryStackRecord } from '@/domain/types';
import { CaelianDatabase, DATABASE_SCHEMA_VERSION } from '@/storage/database';

const databaseNames: string[] = [];

afterEach(async () => {
  await Promise.all(
    databaseNames.splice(0).map((name) => Dexie.delete(name)),
  );
});

describe('数据库迁移', () => {
  it('v5 只回收旧 Alpha 误发的 daily: 背包记录', async () => {
    const name = `caelian-migration-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const legacy = new Dexie(name);
    legacy.version(4).stores({
      inventoryStacks: 'id, profileId, itemId, updatedAt',
    });
    await legacy.open();
    const table = legacy.table<InventoryStackRecord, string>('inventoryStacks');
    await table.bulkAdd([
      {
        id: 'profile:daily:苹果',
        profileId: 'profile',
        itemId: 'daily:苹果',
        name: '苹果',
        quantity: 3,
        updatedAt: 1,
      },
      {
        id: 'profile:legacy_apple',
        profileId: 'profile',
        itemId: 'legacy_apple',
        name: '苹果',
        quantity: 2,
        updatedAt: 1,
      },
    ]);
    legacy.close();

    const current = new CaelianDatabase('alpha', name);
    await current.open();
    expect(DATABASE_SCHEMA_VERSION).toBe(10);
    expect(await current.inventoryStacks.toArray()).toEqual([
      expect.objectContaining({
        itemId: 'legacy_apple',
        quantity: 2,
      }),
    ]);
    expect(current.surveyTokens).toBeDefined();
    expect(current.surveyResponses).toBeDefined();
    expect(current.questTrackerStates).toBeDefined();
    expect(current.questFloorCheckpoints).toBeDefined();
    expect(current.gatheringStates).toBeDefined();
    expect(await current.gatheringStates.count()).toBe(0);
    current.close();
  });

  it('v8 为旧玩家与加点记录补齐吸血字段', async () => {
    const name = `caelian-lifesteal-migration-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const legacy = new Dexie(name);
    legacy.version(7).stores({
      playerStates: 'profileId, updatedAt',
      statAllocations: 'profileId, updatedAt',
    });
    await legacy.open();
    await legacy.table('playerStates').add({
      profileId: 'profile',
      name: '旧玩家',
      updatedAt: 1,
    });
    await legacy.table('statAllocations').add({
      profileId: 'profile',
      actionPointCosts: [],
      updatedAt: 1,
    });
    legacy.close();

    const current = new CaelianDatabase('alpha', name);
    await current.open();
    expect(await current.playerStates.get('profile')).toMatchObject({
      profileId: 'profile',
      lifesteal: 0,
    });
    expect(await current.statAllocations.get('profile')).toMatchObject({
      profileId: 'profile',
      lifesteal: 0,
    });
    current.close();
  });

  it('v10 为每个旧档案补齐特莱奥并夹取异常好感度', async () => {
    const name = `caelian-trelao-migration-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const legacy = new Dexie(name);
    legacy.version(9).stores({
      profiles: 'id, &chatId, updatedAt',
      socialProgress: 'id, profileId, characterId, updatedAt',
    });
    await legacy.open();
    await legacy.table('profiles').bulkAdd([
      { id: 'profile-a', chatId: 'chat-a', createdAt: 1, updatedAt: 1 },
      { id: 'profile-b', chatId: 'chat-b', createdAt: 1, updatedAt: 1 },
    ]);
    await legacy.table('socialProgress').add({
      id: 'profile-a:trelao',
      profileId: 'profile-a',
      characterId: 'trelao',
      affinity: 1_500,
      pendingAffinityDelta: 0,
      mood: '旧状态',
      location: '',
      clothing: '',
      innerThought: '',
      relationshipStage: '错误阶段',
      updatedAt: 1,
    });
    legacy.close();

    const current = new CaelianDatabase('alpha', name);
    await current.open();
    expect(await current.socialProgress.get('profile-a:trelao')).toMatchObject({
      affinity: 1000,
      relationshipStage: '挚友',
    });
    expect(await current.socialProgress.get('profile-b:trelao')).toMatchObject({
      characterId: 'trelao',
      affinity: 0,
      relationshipStage: '警戒',
    });
    current.close();
  });
});
