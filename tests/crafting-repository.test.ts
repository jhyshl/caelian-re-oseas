import { afterEach, describe, expect, it } from 'vitest';
import type { EquipmentInstanceRecord } from '@/domain/types';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';

const databases: CaelianDatabase[] = [];

function setup() {
  const database = new CaelianDatabase(
    'alpha',
    `caelian-crafting-${crypto.randomUUID()}`,
  );
  databases.push(database);
  return {
    database,
    repository: new GameRepository(database, new EventBus()),
  };
}

async function addIronSword(
  database: CaelianDatabase,
  profileId: string,
  id: string,
  stars: 1 | 2,
) {
  const stats = stars === 1 ? { attack: 3 } : { attack: 4 };
  const record: EquipmentInstanceRecord = {
    id,
    profileId,
    baseId: 'eq_iron_sword',
    name: '铁剑',
    slot: 'weapon',
    rarity: 'common',
    stars,
    stats,
    description: '攻击+3',
    updatedAt: Date.now(),
  };
  await database.equipmentInstances.add(record);
}

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

describe('CraftingRepository integration', () => {
  it('按库存批量合成，并用命令 ID 保证幂等', async () => {
    const { repository } = setup();
    const profile = await repository.ensureProfile('craft-items');
    for (const [itemId, delta] of [
      ['城郊药草', 10],
      ['治愈苔', 5],
      ['空玻璃瓶', 5],
    ] as const) {
      await repository.execute(profile.id, {
        id: `grant:${itemId}`,
        type: 'inventory.adjust',
        payload: { itemId, name: itemId, delta },
      });
    }
    const command = {
      id: 'craft-five-small-hp',
      type: 'craft.item',
      payload: { recipeId: 'craft_consumable_01', count: 5 },
    };

    await expect(repository.execute(profile.id, command)).resolves.toMatchObject({
      status: 'applied',
    });
    await expect(repository.execute(profile.id, command)).resolves.toMatchObject({
      status: 'duplicate',
    });

    const inventory = (await repository.snapshot(profile.id)).inventory;
    expect(inventory).toEqual([
      expect.objectContaining({ itemId: '小血瓶', quantity: 5 }),
    ]);
  });

  it('材料不足时整笔事务回滚，不留下产物或命令记录', async () => {
    const { database, repository } = setup();
    const profile = await repository.ensureProfile('craft-rollback');
    await repository.execute(profile.id, {
      id: 'grant-herb-only',
      type: 'inventory.adjust',
      payload: { itemId: '城郊药草', name: '城郊药草', delta: 2 },
    });
    const before = (await repository.snapshot(profile.id)).inventory;

    await expect(
      repository.execute(profile.id, {
        id: 'craft-with-missing-materials',
        type: 'craft.item',
        payload: { recipeId: 'craft_consumable_01', count: 1 },
      }),
    ).rejects.toThrow('材料不足');

    expect((await repository.snapshot(profile.id)).inventory).toEqual(before);
    expect(
      await database.commandInbox.get('craft-with-missing-materials'),
    ).toBeUndefined();
  });

  it('装备可从一星升到二星和三星，并严格使用旧版倍率', async () => {
    const { database, repository } = setup();
    const profile = await repository.ensureProfile('craft-equipment');
    await Promise.all(
      ['one-a', 'one-b', 'one-c'].map((id) =>
        addIronSword(database, profile.id, id, 1),
      ),
    );

    await repository.execute(profile.id, {
      id: 'merge-to-two',
      type: 'craft.equipment',
      payload: { baseId: 'eq_iron_sword', stars: 1 },
    });
    let equipment = (await repository.snapshot(profile.id)).equipment;
    expect(equipment).toEqual([
      expect.objectContaining({
        stars: 2,
        stats: { attack: 4 },
        description: '攻击+4',
      }),
    ]);

    await Promise.all(
      ['two-b', 'two-c'].map((id) =>
        addIronSword(database, profile.id, id, 2),
      ),
    );
    await repository.execute(profile.id, {
      id: 'merge-to-three',
      type: 'craft.equipment',
      payload: { baseId: 'eq_iron_sword', stars: 2 },
    });
    equipment = (await repository.snapshot(profile.id)).equipment;
    expect(equipment).toEqual([
      expect.objectContaining({
        stars: 3,
        stats: { attack: 6 },
        description: '攻击+6',
      }),
    ]);
    expect(
      (await repository.snapshot(profile.id)).achievements.find(
        (entry) => entry.achievementId === 'ach_craft_3star_equipment',
      ),
    ).toMatchObject({ unlocked: true });
  });

  it('优先保留已装备实例；必须消耗时由升星产物继承装备槽', async () => {
    const { database, repository } = setup();
    const profile = await repository.ensureProfile('craft-equipped');
    await Promise.all(
      ['loose-a', 'loose-b', 'loose-c', 'equipped'].map((id) =>
        addIronSword(database, profile.id, id, 1),
      ),
    );
    await database.equipmentLoadouts.update(profile.id, { weaponId: 'equipped' });

    await repository.execute(profile.id, {
      id: 'merge-preserve-equipped',
      type: 'craft.equipment',
      payload: { baseId: 'eq_iron_sword', stars: 1 },
    });
    let snapshot = await repository.snapshot(profile.id);
    expect(snapshot.loadout.weaponId).toBe('equipped');
    expect(snapshot.equipment.some((entry) => entry.id === 'equipped')).toBe(true);

    await Promise.all(
      ['loose-d', 'loose-e'].map((id) =>
        addIronSword(database, profile.id, id, 1),
      ),
    );
    await repository.execute(profile.id, {
      id: 'merge-inherit-equipped',
      type: 'craft.equipment',
      payload: { baseId: 'eq_iron_sword', stars: 1 },
    });
    snapshot = await repository.snapshot(profile.id);
    expect(snapshot.loadout.weaponId).not.toBe('equipped');
    expect(
      snapshot.equipment.find((entry) => entry.id === snapshot.loadout.weaponId),
    ).toMatchObject({ baseId: 'eq_iron_sword', stars: 2 });
  });

  it('批量数量计入首次与累计一百次物品合成成就', async () => {
    const { repository } = setup();
    const profile = await repository.ensureProfile('craft-achievements');
    for (const [itemId, delta] of [
      ['城郊药草', 200],
      ['治愈苔', 100],
      ['空玻璃瓶', 100],
    ] as const) {
      await repository.execute(profile.id, {
        id: `grant-achievement:${itemId}`,
        type: 'inventory.adjust',
        payload: { itemId, name: itemId, delta },
      });
    }
    await repository.execute(profile.id, {
      id: 'craft-one-hundred',
      type: 'craft.item',
      payload: { recipeId: 'craft_consumable_01', count: 100 },
    });
    const unlocked = new Set(
      (await repository.snapshot(profile.id)).achievements
        .filter((entry) => entry.unlocked)
        .map((entry) => entry.achievementId),
    );
    expect(unlocked.has('ach_craft_item_once')).toBe(true);
    expect(unlocked.has('ach_craft_item_100')).toBe(true);
  });
});
