import type { BattleItemDefinition } from '@/content/types';
export const HUNTING_TRAPS = [
  {id:'hunt_trap_low', name:'低级捕兽夹', basePrice:500, failMax:60},
  {id:'hunt_trap_mid', name:'中级捕兽夹', basePrice:1000, failMax:40},
  {id:'hunt_trap_high', name:'高级捕兽夹', basePrice:2000, failMax:20},
] as const;
export const TRAP_ITEMS: Record<string, BattleItemDefinition> = Object.fromEntries(HUNTING_TRAPS.map(t => [t.id, {
  name:t.name, desc:'每次打猎消耗1个；0～'+t.failMax+'失败，81～100触发战斗。', category:'material', rarity:'common', basePrice:t.basePrice,
}]));
