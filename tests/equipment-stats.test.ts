import { describe, expect, it } from 'vitest';
import {
  aggregateEquipmentStats,
  equipmentInstanceDescription,
  equipmentStarMultiplier,
  formatEquipmentStats,
  normalizeEquipmentStats,
  scaleEquipmentStatsByStars,
  upgradeEquipmentStats,
} from '@/equipment-stats';

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
        draw: 2,
      }),
    ).toEqual({
      hpMax: 20,
      mpMax: 8,
      attack: 3,
      defense: 2,
      speed: 1,
      lifesteal: 7,
      actionPointsPerTurn: 1,
      drawPerTurn: 2,
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

  it('新生成装备按 1/2/4 倍，而旧实例升星严格按当前值翻倍', () => {
    expect([1, 2, 3].map(equipmentStarMultiplier)).toEqual([1, 2, 4]);
    expect(scaleEquipmentStatsByStars({ hp_max: 20, attack: 3 }, 2)).toEqual({
      hp_max: 40,
      attack: 6,
    });
    expect(scaleEquipmentStatsByStars({ hp_max: 20, attack: 3 }, 3)).toEqual({
      hp_max: 80,
      attack: 12,
    });
    expect(upgradeEquipmentStats({ hp_max: 29, attack: 4 })).toEqual({
      hp_max: 58,
      attack: 8,
    });
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
