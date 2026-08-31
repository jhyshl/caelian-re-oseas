import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { InventoryRepository } from '@/storage/repositories/inventory-repository';
import { GameRepository } from '@/storage/repository';

const databases: CaelianDatabase[] = [];

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

describe('InventoryRepository', () => {
  it('准备完整物品目录后可以使用真实采集消耗品并扣减背包数量', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-inventory-gather-consumable-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:inventory-gather-consumable');
    const inventory = new InventoryRepository(database);
    await inventory.prepare();

    await database.playerStates.update(profile.id, {
      created: true,
      mp: 4,
    });
    await database.inventoryStacks.put({
      id: `${profile.id}:学院薄荷`,
      profileId: profile.id,
      itemId: '学院薄荷',
      name: '学院薄荷',
      quantity: 2,
      updatedAt: Date.now(),
    });

    await inventory.useConsumable(profile.id, '学院薄荷');

    expect(await database.playerStates.get(profile.id)).toMatchObject({
      mp: 7,
    });
    expect(
      await database.inventoryStacks.get(`${profile.id}:学院薄荷`),
    ).toMatchObject({
      itemId: '学院薄荷',
      quantity: 1,
    });
  });

  it('换装和卸装只截断超出新有效上限的当前值，不给低血角色补血', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-inventory-loadout-cap-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:inventory-loadout-cap');
    const inventory = new InventoryRepository(database);
    const strongId = `${profile.id}:strong-maxima`;
    const weakId = `${profile.id}:weak-maxima`;
    await database.equipmentInstances.bulkAdd([
      {
        id: strongId,
        profileId: profile.id,
        baseId: 'strong-maxima',
        name: '强上限装备',
        slot: 'accessory',
        rarity: 'common',
        stars: 1,
        stats: { hp_max: 20, mp_max: 10 },
        description: '',
        updatedAt: Date.now(),
      },
      {
        id: weakId,
        profileId: profile.id,
        baseId: 'weak-maxima',
        name: '弱上限装备',
        slot: 'accessory',
        rarity: 'common',
        stars: 1,
        stats: { hp_max: 5, mp_max: 5 },
        description: '',
        updatedAt: Date.now(),
      },
    ]);
    await database.equipmentLoadouts.update(profile.id, {
      accessoryId: strongId,
    });
    await database.playerStates.update(profile.id, { hp: 100, mp: 40 });

    await inventory.equip(profile.id, weakId);
    expect(await database.playerStates.get(profile.id)).toMatchObject({
      hp: 85,
      mp: 35,
    });

    await inventory.unequip(profile.id, 'accessory');
    expect(await database.playerStates.get(profile.id)).toMatchObject({
      hp: 80,
      mp: 30,
    });

    await database.playerStates.update(profile.id, { hp: 7, mp: 3 });
    await inventory.equip(profile.id, strongId);
    await inventory.unequip(profile.id, 'accessory');
    expect(await database.playerStates.get(profile.id)).toMatchObject({
      hp: 7,
      mp: 3,
    });
  });

  it('恢复药剂使用装备后上限，但不会把装备加成重复加到当前值', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-inventory-equipment-cap-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:inventory-equipment-cap');
    const inventory = new InventoryRepository(database);
    await inventory.prepare();

    await database.playerStates.update(profile.id, {
      created: true,
      hp: 30,
      mp: 5,
    });
    await database.equipmentInstances.put({
      id: 'equipment-cap-test',
      profileId: profile.id,
      baseId: 'equipment-cap-test',
      name: '上限测试装备',
      slot: 'armor',
      rarity: 'common',
      stars: 1,
      stats: { hp_max: 20, mp: 10 },
      description: '',
      updatedAt: Date.now(),
    });
    await database.equipmentLoadouts.update(profile.id, {
      armorId: 'equipment-cap-test',
    });
    await database.inventoryStacks.bulkPut([
      {
        id: `${profile.id}:小血瓶`,
        profileId: profile.id,
        itemId: '小血瓶',
        name: '小血瓶',
        quantity: 2,
        updatedAt: Date.now(),
      },
      {
        id: `${profile.id}:小魔药瓶`,
        profileId: profile.id,
        itemId: '小魔药瓶',
        name: '小魔药瓶',
        quantity: 1,
        updatedAt: Date.now(),
      },
    ]);

    await inventory.useConsumable(profile.id, '小血瓶');
    expect(await database.playerStates.get(profile.id)).toMatchObject({
      hp: 55,
      hpMax: 80,
    });

    await database.playerStates.update(profile.id, { hp: 80, mp: 30 });
    await expect(
      inventory.useConsumable(profile.id, '小血瓶'),
    ).resolves.toBeUndefined();
    await expect(
      inventory.useConsumable(profile.id, '小魔药瓶'),
    ).resolves.toBeUndefined();
    expect(await database.playerStates.get(profile.id)).toMatchObject({
      hp: 100,
      hpMax: 80,
      mp: 40,
      mpMax: 30,
    });
  });
});
