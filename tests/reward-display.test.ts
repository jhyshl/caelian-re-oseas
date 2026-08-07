import { describe, expect, it } from 'vitest';
import {
  cardRewardEffect,
  cardRewardMeta,
  equipmentRewardEffect,
  equipmentRewardMeta,
  relicRewardEffect,
} from '@/rewards/reward-display';

describe('奖励效果展示', () => {
  it('显示卡牌消耗和具体描述', () => {
    const card = {
      name: '测试斩击',
      type: 'attack',
      cost: 2,
      mpCost: 3,
      rarity: 'rare',
      description: '造成 12 点伤害。',
      effects: [],
    };
    expect(cardRewardMeta(card)).toBe('稀有 · 攻击 · 2 AP / 3 MP');
    expect(cardRewardEffect(card)).toBe('造成 12 点伤害。');
  });

  it('按实际二星倍率显示升级装备属性', () => {
    const equipment = {
      id: 'test-sword',
      name: '测试剑',
      slot: 'weapon' as const,
      rarity: 'uncommon',
      stats: { attack: 3, speed: 1 },
      description: '攻击+3，速度+1',
    };
    expect(equipmentRewardMeta(equipment, 2)).toBe('优秀 · 武器 · 2★');
    expect(equipmentRewardEffect(equipment, 2)).toBe('攻击 +4，速度 +1');
  });

  it('直接展示藏品的完整效果说明', () => {
    expect(
      relicRewardEffect({
        name: '月露小瓶',
        description: '每个玩家回合开始时回复2HP。',
        effect: { type: 'turn_start_heal', value: 2 },
      }),
    ).toBe('每个玩家回合开始时回复2HP。');
  });
});
