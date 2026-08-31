import { loadGatherResources } from '@/content/catalogs/inventory';
import type { GatherResourceDefinition } from '@/content/types';

export interface GatheringCatalog {
  resources: Record<string, GatherResourceDefinition>;
  itemsByRegion: Record<string, string[]>;
}

let cache: GatheringCatalog | undefined;

export async function loadGatheringCatalog(): Promise<GatheringCatalog> {
  if (cache) return cache;

  const [resources, regionModule] = await Promise.all([
    loadGatherResources(),
    import('@/content/generated/world/gather-items-by-region.json'),
  ]);
  const source = regionModule.default as Record<string, string[]>;
  const itemsByRegion: Record<string, string[]> = {};

  for (const [regionId, names] of Object.entries(source)) {
    const uniqueNames = [...new Set(names.map((name) => name.trim()))].filter(
      Boolean,
    );
    for (const itemId of uniqueNames) {
      const definition = resources[itemId];
      if (!definition || definition.name !== itemId) {
        throw new Error(`采集数据库缺少物品定义：${regionId} / ${itemId}`);
      }
      if (!definition.regions.includes(regionId)) {
        throw new Error(`采集物地区声明不一致：${regionId} / ${itemId}`);
      }
    }
    itemsByRegion[regionId] = uniqueNames;
  }

  for (const [itemId, definition] of Object.entries(resources)) {
    for (const regionId of definition.regions) {
      if (!itemsByRegion[regionId]?.includes(itemId)) {
        throw new Error(`采集地区映射缺少物品：${regionId} / ${itemId}`);
      }
    }
  }

  cache = { resources, itemsByRegion };
  return cache;
}
