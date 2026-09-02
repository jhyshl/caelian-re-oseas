import { describe, expect, it } from 'vitest';
import type { EquipmentInstanceRecord } from '@/domain/types';
import {
  equipmentTags,
  filterAndSortEquipment,
} from '@/modules/inventory/equipment-view';

function equipment(
  id: string,
  input: Partial<EquipmentInstanceRecord>,
): EquipmentInstanceRecord {
  return {
    id,
    profileId: 'profile',
    baseId: id,
    name: id,
    slot: 'weapon',
    rarity: 'common',
    stars: 1,
    stats: {},
    description: '',
    updatedAt: 1,
    ...input,
  };
}

describe('装备背包筛选与排序', () => {
  const entries = [
    equipment('rare-ring', {
      name: '苍蓝戒指',
      slot: 'accessory',
      rarity: 'rare',
      stars: 3,
      stats: { mpMax: 8, lifesteal: 2 },
      description: '海潮祝福',
    }),
    equipment('steel-armor', {
      name: '精钢护甲',
      slot: 'armor',
      rarity: 'uncommon',
      stars: 2,
      stats: { defense: 6 },
    }),
    equipment('bronze-sword', {
      name: '青铜剑',
      slot: 'weapon',
      stars: 3,
      stats: { attack: 5 },
    }),
  ];

  it('默认按星级倒序，再按武器、防具、饰品二次排序', () => {
    expect(filterAndSortEquipment(entries, 'all', '').map((entry) => entry.id))
      .toEqual(['bronze-sword', 'rare-ring', 'steel-armor']);
  });

  it('支持部位、标签、词条和多个关键词组合检索', () => {
    expect(filterAndSortEquipment(entries, 'accessory', '').map((entry) => entry.id))
      .toEqual(['rare-ring']);
    expect(filterAndSortEquipment(entries, 'all', '稀有 吸血').map((entry) => entry.id))
      .toEqual(['rare-ring']);
    expect(filterAndSortEquipment(entries, 'all', '防御').map((entry) => entry.id))
      .toEqual(['steel-armor']);
    expect(filterAndSortEquipment(entries, 'all', '海潮 mpMax').map((entry) => entry.id))
      .toEqual(['rare-ring']);
    expect(equipmentTags(entries[0]!)).toEqual(
      expect.arrayContaining(['饰品', '稀有', '3星', '三星', '魔力上限', '吸血']),
    );
  });
});
