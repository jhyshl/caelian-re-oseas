import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GIFT_SPECIALTY_ITEMS,
  PHYSICAL_INTERACTION_ACTIONS,
  PHYSICAL_INTERACTIONS_FRONTEND_ENABLED,
  PHYSICAL_REACTION_STAGES,
  TRELAO_DISLIKED_ITEMS,
  TRELAO_LIKED_ITEMS,
  TRELAO_MILD_DISLIKE_FEEDBACK,
  availablePhysicalInteractionIds,
  clampInteractionAffinity,
  giftAffinityDelta,
  interactionItemTags,
  trelaoFeedMeta,
} from '@/social-interaction-rules';

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|vue)$/.test(entry.name) ? [path] : [];
  });
}

describe('互动纯规则', () => {
  it('完整保留旧版特产与特莱奥显式偏好清单', () => {
    expect(GIFT_SPECIALTY_ITEMS.size).toBe(31);
    expect(TRELAO_LIKED_ITEMS.size).toBe(15);
    expect(TRELAO_DISLIKED_ITEMS.size).toBe(26);
    expect(GIFT_SPECIALTY_ITEMS).toContain('风味海胆卷');
    expect(TRELAO_LIKED_ITEMS).toContain('灵感糖丸');
    expect(TRELAO_DISLIKED_ITEMS).toContain('仿制血浆');
  });

  it('按标签给普通礼物加0.5、怪异礼物减0.5，并以0.5精度约束到500', () => {
    expect(giftAffinityDelta([])).toBe(0.5);
    expect(giftAffinityDelta(['specialty'])).toBe(0.5);
    expect(giftAffinityDelta(['weird_or_dirty'])).toBe(-0.5);
    expect(clampInteractionAffinity(-0.5)).toBe(0);
    expect(clampInteractionAffinity(123.5)).toBe(123.5);
    expect(clampInteractionAffinity(500.5)).toBe(500);
  });

  it('让显式讨厌和蔬菜怪异标签覆盖肉类甜点等喜欢标签', () => {
    expect(trelaoFeedMeta('精制面包')).toMatchObject({
      allowed: true,
      result: 'like',
      category: 'specialty',
    });
    expect(trelaoFeedMeta('仿制血浆')).toMatchObject({
      allowed: true,
      result: 'dislike',
      category: 'specialty',
    });
    expect(interactionItemTags('仿制血浆')).toEqual(
      expect.arrayContaining(['specialty', 'weird_or_dirty']),
    );
    expect(trelaoFeedMeta('小型生命药水', true)).toMatchObject({
      allowed: true,
      result: 'dislike',
      category: 'consumable',
    });
    expect(trelaoFeedMeta('没有标签的石头')).toMatchObject({
      allowed: false,
      result: 'dislike',
    });
    expect(TRELAO_MILD_DISLIKE_FEEDBACK.every((line) => !line.includes('喂吐了'))).toBe(
      true,
    );
  });

  it('在五个好感阶段边界逐级解锁肢体动作', () => {
    expect(PHYSICAL_INTERACTIONS_FRONTEND_ENABLED).toBe(false);
    const at100 = availablePhysicalInteractionIds(100);
    const at101 = availablePhysicalInteractionIds(101);
    const at250 = availablePhysicalInteractionIds(250);
    const at251 = availablePhysicalInteractionIds(251);
    const at400 = availablePhysicalInteractionIds(400);
    const at401 = availablePhysicalInteractionIds(401);
    const at499 = availablePhysicalInteractionIds(499);
    const at500 = availablePhysicalInteractionIds(500);

    expect(availablePhysicalInteractionIds(0)).toEqual(['handshake']);
    expect(at100).not.toContain('high_five');
    expect(at101).toContain('high_five');
    expect(at250).not.toContain('hold_hands');
    expect(at251).toContain('hold_hands');
    expect(at400).not.toContain('interlock_fingers');
    expect(at401).toContain('interlock_fingers');
    expect(at499).not.toContain('lip_kiss');
    expect(at500).toContain('lip_kiss');
    expect(PHYSICAL_REACTION_STAGES).toEqual([
      expect.objectContaining({ minimum: 0, maximum: 100 }),
      expect.objectContaining({ minimum: 101, maximum: 250 }),
      expect.objectContaining({ minimum: 251, maximum: 400 }),
      expect.objectContaining({ minimum: 401, maximum: 499 }),
      expect.objectContaining({ minimum: 500, maximum: 500 }),
    ]);
    expect(new Set(PHYSICAL_INTERACTION_ACTIONS.map((action) => action.id)).size).toBe(
      PHYSICAL_INTERACTION_ACTIONS.length,
    );
  });

  it('前端模块与通用UI没有导入未实装的肢体动作表', () => {
    const roots = ['../src/modules', '../src/ui'].map((path) =>
      fileURLToPath(new URL(path, import.meta.url)),
    );
    const physicalSymbols = [
      'PHYSICAL_INTERACTION_ACTIONS',
      'PHYSICAL_REACTION_STAGES',
      'availablePhysicalInteractionIds',
    ];
    const references = roots
      .flatMap(sourceFiles)
      .filter((path) =>
        physicalSymbols.some((symbol) => readFileSync(path, 'utf8').includes(symbol)),
      );

    expect(references).toEqual([]);
  });
});
