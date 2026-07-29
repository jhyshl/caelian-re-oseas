import type {
  BattleItemDefinition,
  EquipmentDefinition,
  RelicDefinition,
} from '@/content/types';
import {
  BLANK_PAGE_RELIC_DEFINITION,
  BLANK_PAGE_RELIC_ID,
} from '@/achievements/catalog';

let itemCache: Record<string, BattleItemDefinition> | undefined;
let relicCache: Record<string, RelicDefinition> | undefined;
let equipmentCache: Record<string, EquipmentDefinition> | undefined;

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
