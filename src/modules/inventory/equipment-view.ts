import type {
  EquipmentInstanceRecord,
  EquipmentSlot,
} from '@/domain/types';
import { formatEquipmentStats } from '@/equipment-stats';

export type EquipmentCategory = 'all' | EquipmentSlot;

const SLOT_LABELS: Record<EquipmentSlot, string> = {
  weapon: '武器',
  armor: '防具',
  accessory: '饰品',
};

const SLOT_ORDER: Record<EquipmentSlot, number> = {
  weapon: 0,
  armor: 1,
  accessory: 2,
};

const RARITY_LABELS: Record<string, string> = {
  common: '普通',
  uncommon: '优秀',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
};

const STAR_LABELS = ['零星', '一星', '二星', '三星'] as const;

const STAT_LABELS: Record<string, string> = {
  hp: '生命上限',
  hpMax: '生命上限',
  hp_max: '生命上限',
  mp: '魔力上限',
  mpMax: '魔力上限',
  mp_max: '魔力上限',
  attack: '攻击',
  defense: '防御',
  speed: '速度',
  lifesteal: '吸血',
  life_steal: '吸血',
  lifeSteal: '吸血',
  actionPointsPerTurn: '行动点',
  ap_per_turn: '行动点',
  drawPerTurn: '抽牌',
  draw_per_turn: '抽牌',
};

export function equipmentSlotLabel(slot: EquipmentSlot): string {
  return SLOT_LABELS[slot];
}

export function equipmentTags(
  equipment: EquipmentInstanceRecord,
): string[] {
  const tags = [
    equipmentSlotLabel(equipment.slot),
    RARITY_LABELS[equipment.rarity] ?? equipment.rarity,
    `${equipment.stars}星`,
    STAR_LABELS[equipment.stars] ?? `${equipment.stars}星`,
    ...Object.entries(equipment.stats)
      .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) !== 0)
      .map(([key]) => STAT_LABELS[key] ?? key),
  ];
  return [...new Set(tags.filter(Boolean))];
}

export function filterAndSortEquipment(
  equipment: readonly EquipmentInstanceRecord[],
  category: EquipmentCategory,
  query: string,
): EquipmentInstanceRecord[] {
  const terms = query
    .trim()
    .toLocaleLowerCase('zh-CN')
    .split(/\s+/)
    .filter(Boolean);

  return equipment
    .filter((entry) => category === 'all' || entry.slot === category)
    .filter((entry) => {
      if (terms.length === 0) return true;
      const searchable = [
        entry.name,
        entry.baseId,
        entry.rarity,
        entry.description,
        formatEquipmentStats(entry.stats),
        ...Object.keys(entry.stats),
        ...equipmentTags(entry),
      ]
        .join(' ')
        .toLocaleLowerCase('zh-CN');
      return terms.every((term) => searchable.includes(term));
    })
    .sort(
      (left, right) =>
        right.stars - left.stars ||
        SLOT_ORDER[left.slot] - SLOT_ORDER[right.slot] ||
        left.name.localeCompare(right.name, 'zh-CN') ||
        left.id.localeCompare(right.id),
    );
}
