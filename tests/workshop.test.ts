import { afterEach, describe, expect, it } from 'vitest';
import {
  WORKSHOP_STORAGE_KEY,
  cardLimit,
  normalizeWorkshopCard,
  normalizeWorkshopPack,
  readWorkshopPacks,
  saveWorkshopPack,
} from '@/workshop';

afterEach(() => {
  localStorage.clear();
});

describe('旧版创意工坊规则', () => {
  it('使用旧版 AP 强度上限并自动判定稀有度', () => {
    expect(cardLimit(0)).toBe(10);
    expect(cardLimit(10)).toBe(206);

    const card = normalizeWorkshopCard(
      {
        name: '传说试作',
        type: 'attack',
        cost: 10,
        description: '测试',
        effects: [{ type: 'damage', value: 130, target: 'enemy' }],
      },
      'custom_class_test',
    );
    expect(card.powerScore).toBe(130);
    expect(card.rarity).toBe('legendary');

    expect(() =>
      normalizeWorkshopCard(
        {
          name: '零费越界',
          type: 'attack',
          cost: 0,
          effects: [{ type: 'damage', value: 11, target: 'enemy' }],
        },
        'custom_class_test',
      ),
    ).toThrow('强度过高');
  });

  it('拒绝同一卡牌的重复同类效果', () => {
    expect(() =>
      normalizeWorkshopCard(
        {
          name: '重复攻击',
          type: 'attack',
          cost: 3,
          effects: [
            { type: 'damage', value: 4, target: 'enemy' },
            { type: 'damage', value: 5, target: 'enemy' },
          ],
        },
        'custom_class_test',
      ),
    ).toThrow('同类效果只能添加一次');
  });

  it('规范化召唤技能权重并要求召唤牌包含召唤物', () => {
    const card = normalizeWorkshopCard(
      {
        name: '双生使魔',
        type: 'summon',
        cost: 5,
        effects: [
          {
            type: 'summon',
            name: '使魔',
            attackable: false,
            duration: 2,
            skills: [
              {
                name: '啄击',
                weight: 1,
                effects: [{ type: 'damage', value: 4, target: 'enemy' }],
              },
              {
                name: '护主',
                weight: 3,
                effects: [{ type: 'shield', value: 3, target: 'self' }],
              },
            ],
          },
        ],
      },
      'custom_class_test',
    );
    const summon = card.effects[0];
    const skills = summon?.skills as Array<{ weight: number }>;
    expect(skills.map((skill) => skill.weight)).toEqual([0.25, 0.75]);

    expect(() =>
      normalizeWorkshopCard(
        {
          name: '空召唤',
          type: 'summon',
          cost: 1,
          effects: [{ type: 'draw', value: 1 }],
        },
        'custom_class_test',
      ),
    ).toThrow('必须创建一个召唤物');
  });

  it('保留旧版职业包格式、存储键和 10–20 张预设牌组约束', () => {
    const cards = Array.from({ length: 10 }, (_, index) => ({
      id: `card_${index}`,
      name: `卡牌${index}`,
      type: 'skill',
      cost: 1,
      effects: [{ type: 'draw', value: 1 }],
    }));
    const value = {
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: '测试职业包',
      classes: [
        {
          id: 'custom_class_test',
          main: 'mage',
          name: '测试职业',
          talent: {
            name: '测试天赋',
            description: '测试说明',
            effects: [{ type: 'extra_draw', value: 1 }],
          },
          cards,
          starterDeck: cards.map((card) => card.id),
        },
      ],
    };
    const normalized = normalizeWorkshopPack(value);
    expect(normalized.format).toBe('caelian_workshop_class_pack');
    expect(normalized.classes[0]?.starterDeck).toHaveLength(10);

    saveWorkshopPack(value);
    expect(localStorage.getItem(WORKSHOP_STORAGE_KEY)).toContain(
      'custom_class_test',
    );
    expect(readWorkshopPacks()[0]?.classes[0]?.name).toBe('测试职业');
  });
});
