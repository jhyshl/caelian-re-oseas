import type {
  CardDefinition,
  EquipmentDefinition,
  RelicDefinition,
} from '@/content/types';
import { formatEquipmentStats } from '@/equipment-stats';
import { scaleReworkEquipment } from '@/battle/rework/equipment';

const rarityNames: Record<string, string> = {
  common: '普通',
  uncommon: '优秀',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
  level: '升级限定',
};

const cardTypeNames: Record<string, string> = {
  attack: '攻击',
  defense: '防御',
  skill: '技能',
  spell: '法术',
  power: '能力',
  summon: '召唤',
};



export function rewardRarityName(rarity: string | undefined): string {
  if (!rarity) return '未知稀有度';
  return rarityNames[rarity] ?? rarity;
}

export function cardRewardMeta(card: CardDefinition | undefined): string {
  if (!card) return '卡牌资料缺失';
  const costs = [`${card.cost} AP`];
  if ((card.mpCost ?? 0) > 0) costs.push(`${card.mpCost} MP`);
  return [
    rewardRarityName(card.rarity),
    cardTypeNames[card.type] ?? card.type,
    costs.join(' / '),
  ].join(' · ');
}

export function cardRewardEffect(card: CardDefinition | undefined): string {
  return card?.description || card?.brief || '暂无效果说明';
}

export function equipmentRewardMeta(
  equipment: EquipmentDefinition | undefined,
  stars: number,
): string {
  if (!equipment) return '装备资料缺失';
  const slot = {
    weapon: '武器',
    armor: '防具',
    accessory: '饰品',
  }[equipment.slot];
  return `${rewardRarityName(equipment.rarity)} · ${slot} · ${stars}★`;
}

export function equipmentRewardEffect(
  equipment: EquipmentDefinition | undefined,
  stars: number,
  level=1,
): string {
  if (!equipment) return '暂无效果说明';
  return formatEquipmentStats(scaleReworkEquipment(equipment.stats,stars,level,equipment.rarity)) || equipment.description;
}

export function relicRewardEffect(relic: RelicDefinition | undefined): string {
  return relic?.description || '暂无效果说明';
}
