import { loadCommonMarketCards } from '@/content/catalogs/cards';
import {
  loadEquipmentDefinitions,
  loadGatherResources,
  loadItemCatalog,
  loadItemPrices,
  loadMarketItemsByRegion,
  loadRelics,
} from '@/content/catalogs/inventory';
import type {
  BattleItemDefinition,
  CardDefinition,
  EquipmentDefinition,
  GatherResourceDefinition,
  MarketSourceItem,
  RelicDefinition,
} from '@/content/types';

export interface MarketMonsterDefinition {
  id: string;
  name: string;
  difficulty?: string;
  regions?: string[];
  region?: string | string[];
  loot?: Array<{
    id?: string;
    name?: string;
    chance?: number;
  }>;
}

export interface MarketCraftRecipe {
  id: string;
  name: string;
  output?: string;
  basePrice?: number;
}

export interface MarketCatalogs {
  marketItems: Record<string, MarketSourceItem[]>;
  equipment: Record<string, EquipmentDefinition>;
  relics: Record<string, RelicDefinition>;
  gatherResources: Record<string, GatherResourceDefinition>;
  gatherByRegion: Record<string, string[]>;
  monsters: Record<string, MarketMonsterDefinition>;
  recipes: MarketCraftRecipe[];
  itemPrices: Record<string, number>;
  commonCards: Record<string, CardDefinition>;
  items: Record<string, BattleItemDefinition>;
}

let cache: MarketCatalogs | undefined;

export async function loadMarketCatalogs(): Promise<MarketCatalogs> {
  if (!cache) {
    const [
      marketItems,
      equipment,
      relics,
      gatherResources,
      items,
      itemPrices,
      commonCards,
      gatherModule,
      monsterModule,
      recipeModule,
    ] = await Promise.all([
      loadMarketItemsByRegion(),
      loadEquipmentDefinitions(),
      loadRelics(),
      loadGatherResources(),
      loadItemCatalog(),
      loadItemPrices(),
      loadCommonMarketCards(),
      import('@/content/generated/world/gather-items-by-region.json'),
      import('@/content/generated/battle/monsters.json'),
      import('@/content/generated/crafting/recipes.json'),
    ]);
    cache = {
      marketItems,
      equipment,
      relics,
      gatherResources,
      items,
      itemPrices,
      commonCards,
      gatherByRegion: gatherModule.default as Record<string, string[]>,
      monsters: monsterModule.default as Record<
        string,
        MarketMonsterDefinition
      >,
      recipes: recipeModule.default as MarketCraftRecipe[],
    };
  }
  return cache;
}
