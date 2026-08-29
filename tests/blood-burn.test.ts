import { describe, expect, it } from 'vitest';
import {
  bloodBurnAction,
  bloodBurnCardUnavailableReason,
  cardHealsPlayerBeforeBloodBurn,
} from '@/battle/blood-burn';
import type { CardDefinition } from '@/content/types';
import type { BattlePlayerState } from '@/domain/types';

function card(effects: CardDefinition['effects']): CardDefinition {
  return {
    name: '测试牌',
    type: 'skill',
    cost: 0,
    rarity: 'common',
    description: '',
    effects,
  };
}

function player(hp: number, stacks = 1): BattlePlayerState {
  return {
    name: '测试玩家',
    hp,
    hpMax: 100,
    mp: 0,
    mpMax: 0,
    shield: 0,
    attack: 0,
    defense: 0,
    speed: 0,
    ap: 0,
    apMax: 0,
    initialDraw: 0,
    drawPerTurn: 0,
    handLimit: 0,
    drawPile: [],
    discardPile: [],
    hand: [],
    buffs: { blood_burn: { value: 20, turns: 2, stacks } },
    debuffs: {},
    summons: [],
    chants: [],
  };
}

describe('烧血出牌规则', () => {
  it('按最大生命值和层数计算必须完整支付的烧血', () => {
    expect(bloodBurnAction(player(10, 3))).toEqual({
      amountPerStack: 2,
      stacks: 3,
      total: 6,
    });
  });

  it('普通牌必须在完整结算后仍能保留 1HP', () => {
    const attack = card([{ type: 'damage', value: 1, target: 'enemy' }]);
    expect(bloodBurnCardUnavailableReason(player(6, 3), attack, 'player')).toContain(
      '至少保留 1HP',
    );
    expect(bloodBurnCardUnavailableReason(player(7, 3), attack, 'player')).toBe('');
  });

  it('递归识别治疗玩家和群体治疗效果', () => {
    const conditionalHeal = card([
      {
        type: 'conditional_group',
        then_effects: [{ type: 'heal', value: 5, target: 'self' }],
      },
    ]);
    const groupHeal = card([{ type: 'heal', value: 5, target: 'all_allies' }]);
    expect(cardHealsPlayerBeforeBloodBurn(conditionalHeal, 'player')).toBe(true);
    expect(cardHealsPlayerBeforeBloodBurn(groupHeal, 'caelian')).toBe(true);
  });

  it('单体治疗改为凯利安目标时不算治疗玩家', () => {
    const singleHeal = card([{ type: 'heal', value: 5, target: 'self' }]);
    expect(cardHealsPlayerBeforeBloodBurn(singleHeal, 'caelian')).toBe(false);
    expect(
      bloodBurnCardUnavailableReason(player(2), singleHeal, 'caelian'),
    ).toContain('至少保留 1HP');
  });
});
