import { afterEach, describe, expect, it } from 'vitest';
import { loadCardCatalog } from '@/content/catalogs/cards';
import { loadMarketCatalogs } from '@/content/catalogs/market';
import {
  loadEquipmentDefinitions,
  loadItemCatalog,
  loadMarketItemsByRegion,
} from '@/content/catalogs/inventory';
import { scaleEquipmentStatsByStars } from '@/equipment-stats';
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
    expect(instance?.stats).toEqual(
      scaleEquipmentStatsByStars(
        definitions[listing!.refId!]!.stats,
        listing!.stars!,
      ),
    );
    expect(JSON.stringify(await loadEquipmentDefinitions())).toBe(
      serializedDefinitions,
    );
  });

  it('商人出售掉落、采集和合成物时获得 50% 加成', async () => {
    const marketDate = new Date(2026, 7, 26, 12, 30);
    const database = new CaelianDatabase(
      'alpha',
      `caelian-alpha-market-merchant-talent-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('market-merchant-talent');
    await database.playerStates.update(profile.id, {
      classMain: 'martial',
      subclass: 'warrior',
      gold: 0,
    });
    const marketRepository = new MarketRepository(
      database,
      () => marketDate,
    );
    const catalogs = await loadMarketCatalogs();
    const initialView = await marketRepository.view(profile.id);
    const localKeys = new Set(
      initialView.listings
        .filter((listing) => listing.kind === 'item')
        .flatMap((listing) => [listing.itemId, listing.name]),
    );
    const pickNonLocal = (
      rows: Array<{ itemId: string; name: string }>,
    ) =>
      rows.find(
        (row) =>
          row.itemId &&
          row.name &&
          !localKeys.has(row.itemId) &&
          !localKeys.has(row.name),
      );
    const gather = pickNonLocal(
      Object.entries(catalogs.gatherResources).map(([itemId, item]) => ({
        itemId,
        name: item.name,
      })),
    );
    const loot = pickNonLocal(
      Object.values(catalogs.monsters).flatMap((monster) =>
        (monster.loot ?? []).map((item) => ({
          itemId: item.id || item.name || '',
          name: item.name || item.id || '',
        })),
      ),
    );
    const crafted = pickNonLocal(
      catalogs.recipes.map((recipe) => ({
        itemId: recipe.output || recipe.name,
        name: recipe.output || recipe.name,
      })),
    );
    expect(gather).toBeDefined();
    expect(loot).toBeDefined();
    expect(crafted).toBeDefined();
    const eligibleItems = [gather!, loot!, crafted!];
    for (const item of eligibleItems) {
      await database.inventoryStacks.put({
        id: `${profile.id}:${item.itemId}`,
        profileId: profile.id,
        itemId: item.itemId,
        name: item.name,
        quantity: 2,
        updatedAt: Date.now(),
      });
    }

    const normalView = await marketRepository.view(profile.id);
    await database.playerStates.update(profile.id, { subclass: 'merchant' });
    const merchantView = await marketRepository.view(profile.id);
    for (const item of eligibleItems) {
      const normalPrice = normalView.sellItems.find(
        (entry) => entry.itemId === item.itemId,
      )?.price;
      const merchantPrice = merchantView.sellItems.find(
        (entry) => entry.itemId === item.itemId,
      )?.price;
      expect(normalPrice).toBeDefined();
      expect(merchantPrice).toBe(Math.round(normalPrice! * 1.5));
    }

    const sold = eligibleItems[0]!;
    const soldPrice = merchantView.sellItems.find(
      (entry) => entry.itemId === sold.itemId,
    )!.price;
    await marketRepository.sellItem(profile.id, {
      itemId: sold.itemId,
      quantity: 2,
    });
    expect((await database.playerStates.get(profile.id))?.gold).toBe(
      soldPrice * 2,
    );
  });

  it('商人出售当前本地集市正在售卖的同名商品时不享受加成', async () => {
    const marketDate = new Date(2026, 7, 26, 12, 30);
    const database = new CaelianDatabase(
      'alpha',
      `caelian-alpha-market-merchant-local-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('market-merchant-local');
    await database.playerStates.update(profile.id, {
      classMain: 'martial',
      subclass: 'warrior',
      gold: 0,
    });
    const marketRepository = new MarketRepository(
      database,
      () => marketDate,
    );
    const catalogs = await loadMarketCatalogs();
    const view = await marketRepository.view(profile.id);
    const eligible = new Set<string>();
    for (const [itemId, item] of Object.entries(catalogs.gatherResources)) {
      eligible.add(itemId);
      eligible.add(item.name);
    }
    for (const monster of Object.values(catalogs.monsters)) {
      for (const item of monster.loot ?? []) {
        if (item.id) eligible.add(item.id);
        if (item.name) eligible.add(item.name);
      }
    }
    for (const recipe of catalogs.recipes) {
      if (recipe.output) eligible.add(recipe.output);
      eligible.add(recipe.name);
    }
    const localListing = view.listings.find(
      (listing) =>
        listing.kind === 'item' &&
        (eligible.has(listing.itemId) || eligible.has(listing.name)),
    );
    expect(localListing).toBeDefined();
    await database.inventoryStacks.put({
      id: `${profile.id}:${localListing!.itemId}`,
      profileId: profile.id,
      itemId: localListing!.itemId,
      name: localListing!.name,
      quantity: 1,
      updatedAt: Date.now(),
    });
    const normalPrice = (
      await marketRepository.view(profile.id)
    ).sellItems.find((item) => item.itemId === localListing!.itemId)!.price;
    await database.playerStates.update(profile.id, { subclass: 'merchant' });
    const merchantPrice = (
      await marketRepository.view(profile.id)
    ).sellItems.find((item) => item.itemId === localListing!.itemId)!.price;
    expect(merchantPrice).toBe(normalPrice);

    await marketRepository.sellItem(profile.id, {
      itemId: localListing!.itemId,
      quantity: 1,
    });
    expect((await database.playerStates.get(profile.id))?.gold).toBe(
      normalPrice,
    );
  });
});
