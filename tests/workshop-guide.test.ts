import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cardLimit,
  cardScore,
  rarityFromScore,
  talentScore,
} from '@/workshop';

const guide = readFileSync(
  path.join(process.cwd(), 'public', 'docs', 'caelian-workshop-ai-guide.md'),
  'utf8',
);

describe('创意工坊 AI 制作手册', () => {
  it('使用简化标题，并把可复制指令放在职业格式之前', () => {
    expect(guide).toMatch(/^# 凯利安创意工坊 AI 制作手册/m);
    expect(guide).not.toContain('奥西斯再临');
    expect(guide.indexOf('## 最先复制给 AI 的制作指令')).toBeLessThan(
      guide.indexOf('## 一、职业包'),
    );
  });

  it('费用上限与创意工坊现有校验器完全一致', () => {
    const documented = [10, 22, 36, 52, 68, 86, 106, 128, 152, 178, 206];
    expect(Array.from({ length: 11 }, (_, cost) => cardLimit(cost))).toEqual(
      documented,
    );
    expect(guide).toContain(`| 上限 | ${documented.join(' | ')} |`);
  });

  it('关键卡牌、稀有度和天赋数值与现有校验器保持同源', () => {
    expect(
      cardScore({
        effects: [
          { type: 'damage', value: 10, lifesteal_ratio: 0.5, target: 'all_enemies' },
          { type: 'draw', value: 2, target: 'self' },
          { type: 'gain_ap', value: 1, target: 'self' },
        ],
      }),
    ).toBe(46.6);
    expect(guide).toContain(
      '| `damage` | `(value + lifesteal_ratio × 12) × M` |',
    );
    expect(guide).toContain('| `draw` | `value × 6` |');
    expect(guide).toContain('| `gain_ap` | `value × 9` |');

    expect([29, 30, 58, 90, 130].map(rarityFromScore)).toEqual([
      'common',
      'uncommon',
      'rare',
      'epic',
      'legendary',
    ]);
    expect(
      talentScore([
        { type: 'battle_start_shield', value: 10 },
        { type: 'extra_draw', value: 1 },
        { type: 'damage_reduction', value: 1 },
      ]),
    ).toBe(22);
    expect(guide).toContain('天赋最多 4 个不同类型词条，总分必须 `≤24`');
  });

  it('说明玩家标签、代码机制格式与沙箱边界', () => {
    expect(guide).toContain('"tags": ["melee", "weapon", "fire"]');
    expect(guide).toContain('"format": "caelian_workshop_script_mechanism"');
    expect(guide).toContain('`before_damage` 可修改 `amount`、`ignoreDefense`、`cancel`');
    expect(guide).toContain('沙箱内没有 `window`、`document`、`fetch`、`localStorage`');
    expect(guide).toContain('## 新职业制作流程（AI 必须按顺序完成）');
  });
});
