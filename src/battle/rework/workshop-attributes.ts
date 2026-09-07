import {
  baseAttributes,
  COMBAT_PANEL_CAPS,
  COMBAT_STAT_GAINS,
  POINTS_PER_LEVEL,
  type CombatAllocatableStat,
  type CombatAttributes,
} from '@/battle/rework/attributes';

export const WORKSHOP_TEST_LEVEL = 100;
export const WORKSHOP_TEST_ATTRIBUTE_BUDGET = (WORKSHOP_TEST_LEVEL - 1) * POINTS_PER_LEVEL;
export type WorkshopTestAttributeInput = Partial<CombatAttributes> & {
  /** Old test requests remain readable; these obsolete allocations have no effect. */
  mpMax?: number;
  lifesteal?: number;
};
const keys = Object.keys(COMBAT_STAT_GAINS) as CombatAllocatableStat[];
const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(0, Math.floor(value)) : 0;

/** AP starts at 5; the first five purchases cost 2, later purchases cost 3. */
export function workshopAttributePointCost(input: WorkshopTestAttributeInput): number {
  const ap = count(input.actionPointsPerTurn);
  return keys.reduce((sum, key) => sum + (key === 'actionPointsPerTurn' ? 0
    : count(input[key]) * (key === 'drawPerTurn' ? 5 : 1)), 0)
    + Math.min(ap, 5) * 2 + Math.max(0, ap - 5) * 3;
}

/** The test actor has the same growth, panel caps and point budget as a real level-100 actor. */
export function buildWorkshopTestAttributes(input: WorkshopTestAttributeInput, subclass = 'none') {
  const attributes = baseAttributes(subclass, WORKSHOP_TEST_LEVEL);
  for (const key of keys) {
    const invested = input[key] ?? 0;
    if (!Number.isInteger(invested) || invested < 0) {
      throw new Error('属性投入必须为非负整数');
    }
    const cap = COMBAT_PANEL_CAPS[key];
    if (cap !== undefined && invested > Math.ceil((cap - attributes[key]) / COMBAT_STAT_GAINS[key])) {
      throw new Error('属性投入超过面板上限：暴击率 100%、暴击伤害 250%、效果命中/抵抗 80%、每回合抽牌 5 张');
    }
    attributes[key] = Math.min(cap ?? Infinity, attributes[key] + invested * COMBAT_STAT_GAINS[key]);
  }
  const spent = workshopAttributePointCost(input);
  if (spent > WORKSHOP_TEST_ATTRIBUTE_BUDGET) {
    throw new Error('满级测试角色最多可分配 ' + WORKSHOP_TEST_ATTRIBUTE_BUDGET + ' 点属性');
  }
  return { attributes, spent, remaining: WORKSHOP_TEST_ATTRIBUTE_BUDGET - spent };
}
