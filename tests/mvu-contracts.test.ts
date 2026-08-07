import { describe, expect, it } from 'vitest';
import {
  createMvuNarrative,
  extractMvuNarrativePatch,
  hasLegacyMvuState,
  normalizeNarrativePatch,
  relationshipStage,
} from '@/mvu/contracts';

describe('MVU v3 contracts', () => {
  it('只从旧 MVU 迁移叙事字段，不读取背包、装备和战斗数据', () => {
    const legacy = {
      stat_data: {
        世界: {
          剧情标记: {
            初次相遇: true,
            已错过事件: false,
          },
        },
        凯利安: {
          好感度: 32.6,
          情绪: '  警惕  ',
          当前位置: '伊拉亚城',
          衣着: '学院制服',
          内心想法: '暂时继续观察。',
        },
        玩家: {
          背包: { 禁止迁移的药水: 99 },
          装备: { 武器: '禁止迁移的剑' },
        },
        战斗: { 敌人: ['禁止迁移的敌人'] },
      },
    };

    expect(hasLegacyMvuState(legacy)).toBe(true);
    expect(extractMvuNarrativePatch(legacy)).toEqual({
      companion: {
        affinity: 33,
        mood: '警惕',
        location: '伊拉亚城',
        clothing: '学院制服',
        innerThought: '暂时继续观察。',
      },
      storyFlags: {
        初次相遇: true,
        已错过事件: false,
      },
    });
    expect(JSON.stringify(extractMvuNarrativePatch(legacy))).not.toContain(
      '禁止迁移',
    );
  });

  it('约束 AI 可写文本和好感度，避免异常 MVU 污染本地存档', () => {
    const normalized = normalizeNarrativePatch({
      companion: {
        affinity: 999,
        mood: ` ${'坏'.repeat(100)} `,
        innerThought: ` ${'想'.repeat(600)} `,
      },
      storyFlags: {
        [`${'标'.repeat(90)}`]: true,
      },
      world: {
        region: ` ${'城'.repeat(140)} `,
        place: '',
      },
    });

    expect(normalized.companion?.affinity).toBe(100);
    expect(normalized.companion?.mood).toHaveLength(80);
    expect(normalized.companion?.innerThought).toHaveLength(500);
    expect(Object.keys(normalized.storyFlags ?? {})[0]).toHaveLength(80);
    expect(normalized.world?.region).toHaveLength(120);
    expect(normalized.world?.place).toBe('');
  });

  it('关系阶段只由本地好感度推导', () => {
    expect([0, 20, 21, 50, 51, 80, 81, 99, 100].map(relationshipStage)).toEqual(
      [
        '陌生人',
        '陌生人',
        '熟人',
        '熟人',
        '暧昧对象',
        '暧昧对象',
        '恋人',
        '恋人',
        '伴侣',
      ],
    );
  });

  it('投影只携带为真的剧情标记', () => {
    const narrative = createMvuNarrative(
      {
        id: 'profile:test:caelian',
        profileId: 'profile:test',
        characterId: 'caelian',
        affinity: 10,
        mood: '平静',
        location: '圣德里安学院',
        clothing: '学院制服',
        innerThought: '',
        relationshipStage: '陌生人',
        updatedAt: 1,
      },
      [
        {
          id: 'profile:test:a',
          profileId: 'profile:test',
          key: 'a',
          value: true,
          updatedAt: 1,
        },
        {
          id: 'profile:test:b',
          profileId: 'profile:test',
          key: 'b',
          value: false,
          updatedAt: 1,
        },
      ],
      {
        profileId: 'profile:test',
        region: '伊拉亚城',
        place: '中央广场',
        location: '伊拉亚城-中央广场',
        gameDate: '新圣约历1385-09-02',
        gameTime: '10:30',
        weather: '多云',
        mainStage: 1,
        mainStep: 2,
        updatedAt: 1,
      },
    );

    expect(narrative.storyFlags).toEqual({ a: true });
    expect(narrative.world).toMatchObject({
      location: '伊拉亚城-中央广场',
      gameTime: '10:30',
    });
  });

  it('从 v3 narrative 读取由 AI 更新的世界状态', () => {
    expect(
      extractMvuNarrativePatch({
        stat_data: {
          caelian: {
            narrative: {
              world: {
                region: '艾瑟拉森林',
                place: '月露湖',
                location: '艾瑟拉森林-月露湖',
                gameDate: '新圣约历1385-09-04',
                gameTime: '21:15',
                weather: '小雨',
                mainStage: 2,
                mainStep: 3,
              },
            },
          },
        },
      }),
    ).toEqual({
      world: {
        region: '艾瑟拉森林',
        place: '月露湖',
        location: '艾瑟拉森林-月露湖',
        gameDate: '新圣约历1385-09-04',
        gameTime: '21:15',
        weather: '小雨',
      },
    });
  });
});
