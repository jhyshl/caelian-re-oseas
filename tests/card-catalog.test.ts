import { describe, expect, it } from 'vitest';
import {
  loadCardCatalog,
  normalizeBuiltInCardEffect,
} from '@/content/catalogs/cards';
import rawCards from '@/content/generated/cards/cards.json';
import type { CardEffect } from '@/content/types';

const POISON_DOUBLE_CARD_IDS = [
  'wood_poison_bloom',
  'al_catalyst',
  'ap_poison_amplifier',
] as const;

describe('职业卡牌兼容标准化', () => {
  it('补齐炉心过热与献身文本承诺的本回合百分比增幅', async () => {
    const catalog = await loadCardCatalog();

    expect(catalog.bs_core_overheat?.effects).toEqual([
      {
        type: 'apply_buff',
        buff: 'blood_burn',
        value: 20,
        turns: 1,
        target: 'self',
      },
      {
        type: 'apply_buff',
        buff: 'attack_amp_percent',
        value: 35,
        turns: 1,
        target: 'self',
      },
    ]);
    expect(catalog.pr_devotion?.effects).toEqual([
      {
        type: 'apply_buff',
        buff: 'blood_burn',
        value: 10,
        turns: 1,
        target: 'self',
      },
      {
        type: 'apply_buff',
        buff: 'healing_amp_percent',
        value: 35,
        turns: 1,
        target: 'self',
      },
    ]);
  });

  it('用真实陷阱效果替换占位抽牌，并保留震荡地雷的虚弱', async () => {
    const catalog = await loadCardCatalog();

    expect(rawCards.sk_deep_ambush.effects).toEqual([
      { type: 'draw', value: 1 },
    ]);
    expect(catalog.sk_deep_ambush?.effects).toEqual([
      { type: 'trap', value: 12, target: 'enemy' },
    ]);
    expect(catalog.vh_trap?.effects).toEqual([
      { type: 'trap', value: 12, target: 'enemy' },
    ]);
    expect(catalog.mc_shock_mine?.effects).toEqual([
      { type: 'trap', value: 10, target: 'enemy' },
      {
        type: 'apply_debuff',
        debuff: 'weak',
        value: 1,
        turns: 1,
        target: 'enemy',
      },
    ]);
  });

  it('冰浪只会冻结出牌前已经湿润的目标', async () => {
    const catalog = await loadCardCatalog();

    expect(catalog.wm_ice_wave?.effects).toEqual([
      { type: 'damage', value: 10, target: 'enemy' },
      {
        type: 'conditional_group',
        conditions: [
          { type: 'enemy_has_specific_debuff', debuff: 'wet' },
        ],
        then_effects: [
          {
            type: 'apply_debuff',
            debuff: 'freeze',
            value: 1,
            turns: 1,
            target: 'enemy',
          },
        ],
      },
      {
        type: 'apply_debuff',
        debuff: 'wet',
        value: 2,
        turns: 1,
        target: 'enemy',
      },
    ]);
  });

  it('绿息会按文本给全体我方施加再生', async () => {
    const catalog = await loadCardCatalog();

    expect(catalog.wood_green_breath?.effects).toEqual([
      {
        type: 'apply_buff',
        buff: 'regen',
        value: 3,
        turns: 3,
        target: 'all_allies',
      },
    ]);
  });

  it.each([
    ['hk_sun_banner', '日辉旗帜'],
    ['dk_young_dragon', '幼龙参战'],
    ['su_guardian_puppet', '守护傀儡'],
  ])('%s 明确说明护盾作用于召唤物自身', async (cardId) => {
    const catalog = await loadCardCatalog();
    const card = catalog[cardId];
    const summon = card?.effects.find((effect) => effect.type === 'summon');
    const skills = Array.isArray(summon?.skills)
      ? (summon.skills as Array<Record<string, unknown>>)
      : [];

    expect(card?.description).toContain('自身获得 5 护盾');
    expect(card?.brief).toContain('自身获得 5 护盾');
    expect(card?.description).not.toContain('我方护盾');
    expect(
      skills.some((skill) => skill.name === '自身获得 5 护盾'),
    ).toBe(true);
  });

  it.each(POISON_DOUBLE_CARD_IDS)(
    '%s 在卡牌目录中固定为中毒翻倍而不是中毒 +2',
    async (cardId) => {
      const catalog = await loadCardCatalog();
      const poisonEffect = catalog[cardId]?.effects?.find(
        (effect) => effect.debuff === 'poison',
      );

      expect(poisonEffect).toMatchObject({
        type: 'double_debuff',
        debuff: 'poison',
        target: 'enemy',
      });
      expect(poisonEffect).not.toHaveProperty('value');
      expect(poisonEffect).not.toHaveProperty('turns');
      expect(poisonEffect).not.toHaveProperty('chance');
    },
  );

  it('执行边界会忽略旧卡实例中的数值并保留其他卡的原效果', () => {
    const staleLegacyEffect = {
      type: 'apply_debuff',
      debuff: 'poison',
      value: 99,
      turns: 8,
      chance: 0.25,
      target: 'enemy',
    } as CardEffect;

    expect(
      normalizeBuiltInCardEffect('ap_poison_amplifier', staleLegacyEffect),
    ).toEqual({
      type: 'double_debuff',
      debuff: 'poison',
      target: 'enemy',
    });
    expect(normalizeBuiltInCardEffect('other_card', staleLegacyEffect)).toBe(
      staleLegacyEffect,
    );
  });
});
