import { loadCraftingRecipes, type CraftingRecipeDefinition } from './crafting';
import { loadMonsterCatalog, type MonsterDefinition } from './battle';
import { loadGatherResources, loadItemPrices, loadMarketItemsByRegion } from './inventory';
import { COOKING_MATERIALS } from '@/content/cooking';
import type { MarketSourceItem } from '@/content/types';

export interface CommissionSources {
  recipes: readonly CraftingRecipeDefinition[];
  markets: Record<string, MarketSourceItem[]>;
  gather: Record<string, string[]>;
  monsters: Record<string, MonsterDefinition>;
  prices: Record<string, number>;
}
let cache: Promise<CommissionSources> | undefined;
export function loadCommissionSources(): Promise<CommissionSources> {
  return cache ??= Promise.all([
    loadCraftingRecipes(), loadMarketItemsByRegion(), loadGatherResources(),
    loadMonsterCatalog(), loadItemPrices(), import('@/content/generated/world/gather-items-by-region.json'),
  ]).then(([recipes, markets, resources, monsters, prices, gather]) => ({
    recipes, monsters,
    markets: Object.fromEntries(Object.entries(markets).map(([region, rows]) => [region, [
      ...rows, ...Object.entries(COOKING_MATERIALS).filter(([,item]) => item.marketOnly).map(([id,item]) => ({id,name:id,basePrice:item.basePrice,rarity:item.rarity,stockMin:100,stockMax:100})),
    ]])),
    gather: Object.fromEntries(Object.entries(gather.default).map(([region, names]) => [region, names.filter(name => resources[name] || Object.values(resources).some(item => item.name === name))])),
    prices: {...prices, ...Object.fromEntries(recipes.map(r => [r.output, r.basePrice])), ...Object.fromEntries(Object.entries(COOKING_MATERIALS).map(([id,item]) => [id,item.basePrice]))},
  })).catch(error => { cache=undefined; throw error; });
}
