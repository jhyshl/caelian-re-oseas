import type {
  BattleItemDefinition,
  EquipmentDefinition,
  GatherResourceDefinition,
  MarketSourceItem,
  RelicDefinition,
} from '@/content/types';
import {
  BLANK_PAGE_RELIC_DEFINITION,
  BLANK_PAGE_RELIC_ID,
} from '@/achievements/catalog';
import { PATCH_RELIC_DEFINITIONS } from '@/achievements/patch-registry';
import { COOKING_ITEMS } from '@/content/cooking';

let itemCache: Record<string, BattleItemDefinition> | undefined;
let allItemCache: Record<string, BattleItemDefinition> | undefined;
let relicCache: Record<string, RelicDefinition> | undefined;
let equipmentCache: Record<string, EquipmentDefinition> | undefined;
let gatherCache: Record<string, GatherResourceDefinition> | undefined;
let priceCache: Record<string, number> | undefined;
let marketCache: Record<string, MarketSourceItem[]> | undefined;

export async function loadBattleItems() {
  if (!itemCache) {
    const module = await import(
      '@/content/generated/inventory/battle-items.json'
    );
    itemCache = module.default as Record<string, BattleItemDefinition>;
  }
  return itemCache;
}

export async function loadRelics() {
  if (!relicCache) {
    const module = await import('@/content/generated/inventory/relics.json');
    relicCache = {
      ...(module.default as Record<string, RelicDefinition>),
      ...PATCH_RELIC_DEFINITIONS,
      [BLANK_PAGE_RELIC_ID]: BLANK_PAGE_RELIC_DEFINITION,
    };
  }
  return relicCache;
}

export async function loadEquipmentDefinitions() {
  if (!equipmentCache) {
    const module = await import(
      '@/content/generated/inventory/equipment-rewards.json'
    );
    equipmentCache = module.default as Record<string, EquipmentDefinition>;
  }
  return equipmentCache;
}

export async function loadGatherResources() {
  if (!gatherCache) {
    const module = await import(
      '@/content/generated/inventory/gather-resources.json'
    );
    gatherCache = module.default as Record<
      string,
      GatherResourceDefinition
    >;
  }
  return gatherCache;
}

export async function loadItemPrices() {
  if (!priceCache) {
    const module = await import(
      '@/content/generated/inventory/item-prices.json'
    );
    priceCache = module.default as Record<string, number>;
  }
  return priceCache;
}

export async function loadMarketItemsByRegion() {
  if (!marketCache) {
    const module = await import(
      '@/content/generated/market/items-by-region.json'
    );
    marketCache = module.default as Record<string, MarketSourceItem[]>;
  }
  return marketCache;
}

/**
 * 前端背包的只读索引。这里仅把旧版各个独立库按名称合并展示，
 * 不会修改或补写任何生成数据。
 */
export async function loadItemCatalog() {
  if (!allItemCache) {
    const [battleItems, gatherResources, prices, markets] =
      await Promise.all([
        loadBattleItems(),
        loadGatherResources(),
        loadItemPrices(),
        loadMarketItemsByRegion(),
      ]);
    const catalog: Record<string, BattleItemDefinition> = {
      ...battleItems,
      ...gatherResources,
      ...COOKING_ITEMS,
    };
    for (const rows of Object.values(markets)) {
      for (const row of rows) {
        if (row.marketKind === 'equipment' || row.marketKind === 'relic') {
          continue;
        }
        catalog[row.name] ??= {
          name: row.name,
          desc: '',
          category: 'market',
          basePrice: row.basePrice,
          rarity: row.rarity,
        };
      }
    }
    for (const [name, basePrice] of Object.entries(prices)) {
      catalog[name] ??= {
        name,
        desc: '',
        category: 'item',
        basePrice,
      };
    }
    allItemCache = catalog;
  }
  return allItemCache;
}

export async function loadDailyGiftItemPool(): Promise<
  Array<{ itemId: string; name: string }>
> {
  const markets = await loadMarketItemsByRegion();
  const unique = new Map<string, { itemId: string; name: string }>();
  for (const rows of Object.values(markets)) {
    for (const row of rows) {
      if (row.marketKind === 'equipment' || row.marketKind === 'relic') {
        continue;
      }
      if (!unique.has(row.name)) {
        unique.set(row.name, { itemId: row.name, name: row.name });
      }
    }
  }
  return [...unique.values()];
}
