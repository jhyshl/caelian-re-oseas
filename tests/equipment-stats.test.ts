import { describe, expect, it } from 'vitest';
import {
  aggregateEquipmentStats,
  equipmentInstanceDescription,
  formatEquipmentStats,
  normalizeEquipmentStats,
} from '@/equipment-stats';

import { scaleReworkEquipment, reworkEquipmentStarMultiplier, upgradeReworkEquipment } from '@/battle/rework/equipment';

describe('装备属性计算', () => {
  it('统一读取内容库 snake_case、运行时 camelCase 与旧版中文键', () => {
    expect(
      normalizeEquipmentStats({
        hp_max: 20,
        mpMax: 8,
        attack: 3,
        '防御': 2,
        speed: 1,
        life_steal: 7,
        ap_per_turn: 1,
        draw: 2, crit: 3, critDamage: 6, ehr: 4, '效果抵抗': 8,
      }),
    ).toEqual({
      hpMax: 20,
      mpMax: 8,
      attack: 3,
      defense: 2,
      speed: 1,
      lifesteal: 7,
      actionPointsPerTurn: 1,
      drawPerTurn: 2, critRate: 3, critDamage: 6, effectHit: 4, effectResist: 8,
    });
  });

  it('只聚合已传入的装备并累加不同别名', () => {
    expect(
      aggregateEquipmentStats([
        { stats: { hp_max: 20, attack: 3, lifesteal: 12 } },
        {
          stats: {
            hpMax: 10,
            '攻击': 2,
            draw_per_turn: 1,
            '吸血': 8,
            lifesteal_percent: 5,
          },
        },
      ]),
    ).toMatchObject({
      hpMax: 30,
      attack: 5,
      lifesteal: 25,
      drawPerTurn: 1,
    });
  });

  it('重置装备的三星使用1/1.1/1.2，旧星级输入不重复放大且AP保持离散', () => {
    expect([1, 2, 3].map(reworkEquipmentStarMultiplier)).toEqual([1, 1.1, 1.2]);
    const source = { hp_max: 20, attack: 3, ap_per_turn: 1 };
    const one = scaleReworkEquipment(source, 1, 20, 'rare');
    const three = scaleReworkEquipment(source, 3, 20, 'rare');
    expect(three.hpMax).toBeCloseTo(one.hpMax! * 1.2, 1);
    expect(three.attack).toBeCloseTo(one.attack! * 1.2, 1);
    expect(three.actionPointsPerTurn).toBe(1);
    expect(scaleReworkEquipment({ hp_max: 80, attack: 12, ap_per_turn: 4 }, 3, 20, 'rare')).toEqual(three);
    const instance = {
      id: 'test', profileId: 'test', baseId: 'test', name: '测试装备',
      slot: 'armor' as const, rarity: 'rare', stars: 1, stats: one,
      description: '', updatedAt: 1, equipmentRulesVersion: 1, itemLevel: 20,
      legacyStats: source, equipmentSourceStats: source,
    };
    const twice = upgradeReworkEquipment(upgradeReworkEquipment(instance));
    expect(twice.stats).toEqual(three);
    expect(twice.legacyStats).toEqual(source);
    expect(() => upgradeReworkEquipment(twice)).toThrow('最高星级');
  });
  it('背包文字使用实例已经缩放的实际属性', () => {
    expect(formatEquipmentStats({ attack: 6, hp_max: 40, lifesteal: 12 })).toBe(
      '攻击 +6，生命上限 +40，吸血 +12%',
    );
    expect(
      equipmentInstanceDescription({
        stats: { attack: 6, hp_max: 40, lifesteal: 12 },
        description: '攻击+3，生命上限+20，吸血+6%',
      }),
    ).toBe('攻击 +6，生命上限 +40，吸血 +12%');
  });

  it('替换旧属性文字时保留非属性装备效果', () => {
    expect(
      equipmentInstanceDescription({
        stats: { attack: 12, speed: 4 },
        description: '攻击+3；命中后使目标攻击-1，速度+1',
      }),
    ).toBe('攻击 +12，速度 +4，命中后使目标攻击-1');
  });
});
