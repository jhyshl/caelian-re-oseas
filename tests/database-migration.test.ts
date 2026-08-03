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
    expect(DATABASE_SCHEMA_VERSION).toBe(6);
    expect(await current.inventoryStacks.toArray()).toEqual([
      expect.objectContaining({
        itemId: 'legacy_apple',
        quantity: 2,
      }),
    ]);
    expect(current.surveyTokens).toBeDefined();
    expect(current.surveyResponses).toBeDefined();
    current.close();
  });
});
