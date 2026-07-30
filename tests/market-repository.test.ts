import { afterEach, describe, expect, it } from 'vitest';
import { loadCardCatalog } from '@/content/catalogs/cards';
import {
  loadEquipmentDefinitions,
  loadItemCatalog,
  loadMarketItemsByRegion,
} from '@/content/catalogs/inventory';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';
import {
  currentMarketSlotKey,
  MarketRepository,
} from '@/storage/repositories/market-repository';

const databases: CaelianDatabase[] = [];

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

describe('MarketRepository integration', () => {
  it('完整读取旧版物品、装备、区域商品和通用卡牌库', async () => {
    const [items, equipment, regions, cards] = await Promise.all([
      loadItemCatalog(),
      loadEquipmentDefinitions(),
      loadMarketItemsByRegion(),
      loadCardCatalog(),
    ]);
    expect(Object.keys(equipment)).toHaveLength(30);
    expect(Object.keys(regions)).toHaveLength(10);
    expect(Object.values(regions).flat()).toHaveLength(126);
    expect(Object.keys(items).length).toBeGreaterThanOrEqual(264);
    expect(
      Object.keys(cards).filter((id) => id.startsWith('cm_')),
    ).toHaveLength(20);
  });

  it('按旧版刷新时段生成集市，并从真实区域库购买物品', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-alpha-market-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('market-chat');
    const before = await repository.marketState(profile.id);
    const listing = before.listings.find(
      (entry) => entry.kind === 'item' && entry.tab === 'specialty',
    );
    expect(listing).toBeDefined();
    expect(before.refreshKey).toBe(currentMarketSlotKey(new Date()));
    expect(listing?.stock).toBeGreaterThanOrEqual(50);

    await database.playerStates.update(profile.id, { gold: 100_000 });
    expect(
      currentMarketSlotKey(new Date(2026, 6, 30, 12, 30)),
    ).toBe('2026-7-30-12');
    await repository.execute(profile.id, {
      id: 'market-buy-real-item',
      type: 'market.buy',
      payload: {
        listingKey: listing!.key,
        quantity: 3,
      },
    });
    const snapshot = await repository.snapshot(profile.id);
    expect(
      snapshot.inventory.find((stack) => stack.itemId === listing!.itemId),
    ).toMatchObject({
      name: listing!.name,
      quantity: 3,
    });
    const after = await repository.marketState(profile.id);
    expect(
      after.listings.find((entry) => entry.key === listing!.key)?.stock,
    ).toBe(listing!.stock - 3);
  });

  it('购买装备时从旧版装备定义创建星级实例，不修改基础库', async () => {
    const marketDate = new Date(2026, 6, 30, 16, 30);
    const database = new CaelianDatabase(
      'alpha',
      `caelian-alpha-market-equipment-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('market-equipment-chat');
    await database.playerStates.update(profile.id, {
      gold: 100_000,
      level: 30,
    });
    const definitions = await loadEquipmentDefinitions();
    const serializedDefinitions = JSON.stringify(definitions);
    const marketRepository = new MarketRepository(
      database,
      () => marketDate,
    );
    const market = await marketRepository.view(profile.id);
    const listing = market.listings.find(
      (entry) => entry.kind === 'equipment',
    );
    expect(listing).toBeDefined();

    await marketRepository.prepare();
    await marketRepository.buy(profile.id, {
      listingKey: listing!.key,
      quantity: 1,
    });
    const snapshot = await repository.snapshot(profile.id);
    const instance = snapshot.equipment.find(
      (entry) => entry.baseId === listing!.refId,
    );
    expect(instance).toBeDefined();
    expect(instance?.slot).toBe(definitions[listing!.refId!]?.slot);
    expect(instance?.rarity).toBe(definitions[listing!.refId!]?.rarity);
    expect(instance?.stars).toBe(listing?.stars);
    expect(JSON.stringify(await loadEquipmentDefinitions())).toBe(
      serializedDefinitions,
    );
  });
});
