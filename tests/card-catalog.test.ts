import { describe, expect, it } from 'vitest';
import { loadCardCatalog, normalizeBuiltInCardEffect } from '@/content/catalogs/cards';
import { describeReworkEffects, reworkCard } from '@/battle/rework/catalog';
import reworkCatalog from '@/battle/rework/catalog.json';
import type { CardEffect } from '@/content/types';

const poisonCards = [
  ['wood_poison_bloom', 0.35, 2],
  ['al_catalyst', 0.45, 1],
  ['ap_poison_amplifier', 0.65, 1],
] as const;

describe('职业卡牌重置目录', () => {
  it('全部 546 张正式卡覆盖旧目录，沿用稳定 ID，MP 清零并提供三级升星说明', async () => {
    const cards = await loadCardCatalog();
    expect(reworkCatalog.cards).toHaveLength(546);
    for (const approved of reworkCatalog.cards) {
      const card = cards[approved.id];
      expect(card, approved.id).toBeDefined();
      expect(card).toMatchObject({ id: approved.id, name: approved.name, cost: approved.ap, mpCost: 0, maxStars: 3, rework: true });
      expect(card!.effects).toHaveLength(approved.effects.length);
      expect(card!.description).toContain('卡牌最多3星');
      expect(card!.description).not.toContain('undefined');
      expect(card!.effects.map((effect) => effect.type)).toEqual(approved.effects.map((effect) => effect.kind));
    }
  });

  it('炉心过热与献身使用不可致死的百分比生命代价和本回合独立增幅', async () => {
    const cards = await loadCardCatalog();
    expect(cards.bs_core_overheat).toMatchObject({ cost: 1, mpCost: 0, effects: [
      expect.objectContaining({ type: 'utility', action: 'self_cost', maxHp: 0.08 }),
      expect.objectContaining({ type: 'buff', status: '直接增伤', value: 0.3, turns: 1, target: 'self' }),
      expect.objectContaining({ type: 'resource', resource: '炉温', value: 1 }),
    ] });
    expect(cards.pr_devotion).toMatchObject({ cost: 0, effects: [
      expect.objectContaining({ type: 'utility', action: 'self_cost', maxHp: 0.05 }),
      expect.objectContaining({ type: 'buff', status: '治疗量增加', value: 0.2, turns: 1, target: 'self' }),
    ] });
  });

  it.each([
    ['sk_deep_ambush', 1, 25, 0.75, 'weak', 80],
    ['vh_trap', 2, 45, 1.3, 'hard_control', 60],
    ['mc_shock_mine', 1, 20, 0.6, 'weak', 80],
  ] as const)('%s 保留敌人攻击前触发陷阱及其基础命中减益', async (id, ap, flat, atk, status, chance) => {
    const card = (await loadCardCatalog())[id]!;
    expect(card.cost).toBe(ap);
    expect(card.effects[0]).toMatchObject({ type: 'damage', flat, atk, crit: false, target: 'enemy', trigger: expect.stringMatching(/^目标下.*攻击.*前$/) });
    expect(card.effects[1]).toMatchObject({ type: 'debuff', canonicalStatus: status, baseChance: chance, turns: 1 });
    expect(card.effects[1]!.condition).toMatch(/陷阱触发|地雷触发/);
  });

  it('冰浪先检查既有湿润再施加新湿润，冻结以 60% 基础命中结算', async () => {
    const card = (await loadCardCatalog()).wm_ice_wave!;
    expect(card.cost).toBe(2);
    expect(card.effects).toMatchObject([
      { type: 'damage', flat: 50, atk: 1.45, crit: true },
      { type: 'conditional', condition: '结算前目标已湿润', effects: [
        { type: 'debuff', canonicalStatus: 'freeze', turns: 1, baseChance: 60 },
      ] },
      { type: 'debuff', canonicalStatus: 'wet', turns: 2, baseChance: 100 },
    ]);
  });

  it('绿息为全体我方再生两次，保留群体总量上限和治疗不可暴击', async () => {
    const card = (await loadCardCatalog()).wood_green_breath!;
    expect(card).toMatchObject({ cost: 2, effects: [
      expect.objectContaining({ type: 'heal', flat: 10, atk: 0.25, target: 'all_allies', crit: false, overTime: 2 }),
      expect.objectContaining({ type: 'utility', action: '群体再生总量上限', flatPerTick: 30, atkPerTick: 0.75 }),
    ] });
    expect(card.description).toContain('群体');
    expect(card.description).toContain('不暴击');
  });

  it.each([
    ['hk_sun_banner', '日辉旗帜', 'ally'],
    ['dk_young_dragon', '幼龙', 'self'],
    ['su_guardian_puppet', '守护傀儡', 'self'],
  ] as const)('%s 公开召唤技能、正确护盾目标和全队槽位约束', async (id, name, shieldTarget) => {
    const card = (await loadCardCatalog())[id]!;
    const summon = card.effects.find((effect) => effect.type === 'summon')!;
    const skills = summon.skills as Array<{ name: string; effects: CardEffect[] }>;
    expect(summon.name).toBe(name);
    expect(skills.length).toBeGreaterThanOrEqual(2);
    const shields = skills.flatMap((skill) => skill.effects).filter((effect) => effect.type === 'shield');
    expect(shields.length).toBeGreaterThan(0);
    expect(shields.every((effect) => effect.target === shieldTarget)).toBe(true);
    expect(card.description).toContain('逐项效果');
    expect(card.description).toContain('护盾');
    expect(summon.turns).toBe(3);
    expect(summon.teamLimit ?? summon.slotsForWholeTeam).toBe(2);
    expect(summon.maxActionsPerTurn ?? summon.actionsPerTurn).toBe(1);
  });

  it.each(poisonCards)('%s 按攻击力新增受限 DOT，废除旧无限中毒翻倍', async (id, atk, stacks) => {
    const card = (await loadCardCatalog())[id]!;
    const poison = card.effects.find((effect) => effect.type === 'dot' && effect.canonicalStatus === 'poison')!;
    expect(poison).toMatchObject({ atk, turns: 2, baseChance: 100, crit: false, maxStacks: 3 });
    expect(poison.stacks ?? 1).toBe(stacks);
    expect(poison.applicationCapPerSourceTurn ?? poison.sourceApplicationsPerTurn).toBe(2);
    expect(card.effects.some((effect) => effect.type === 'double_debuff')).toBe(false);
    if (id !== 'wood_poison_bloom') expect(poison.condition).toBe('目标已有中毒');
  });

  it('三星放大固定值及攻击/防御倍率，生命比例、命中率和持续时间保持原规则', () => {
    const devotion = reworkCard('pr_devotion')!;
    const knife = reworkCard('mg_card_knife')!;
    expect(describeReworkEffects(devotion.effects, 3)).toContain('5%');
    const rendered = describeReworkEffects(knife.effects, 3);
    expect(rendered).toContain('21.6');
    expect(rendered).toContain('60%攻击力');
    expect(rendered).toContain('抽1张');
    const poison = describeReworkEffects(reworkCard('ap_poison_amplifier')!.effects, 3);
    expect(poison).toContain('78%施加时攻击力');
    expect(poison).toContain('基础命中100%');
    expect(poison).toContain('两次行动阶段结束');
  });

  it('遗留兼容函数仍处理旧 poison 实例且不改其他卡，但正式目录使用重置 DSL', async () => {
    const legacy: CardEffect = { type: 'apply_debuff', debuff: 'poison', value: 99, turns: 8, chance: 0.25, target: 'enemy' };
    expect(normalizeBuiltInCardEffect('ap_poison_amplifier', legacy)).toEqual({ type: 'double_debuff', debuff: 'poison', target: 'enemy' });
    expect(normalizeBuiltInCardEffect('other_card', legacy)).toBe(legacy);
    expect((await loadCardCatalog()).ap_poison_amplifier!.effects[0]).toMatchObject({ type: 'dot', atk: 0.65, crit: false });
  });
});
