import { describe, expect, it } from 'vitest';
import { DECK_BUILD_FORMAT, normalizeDeckBuild } from '@/card-square';

function build(cardIds: string[]) {
  return {
    format: DECK_BUILD_FORMAT,
    version: 1,
    name: '官方职业构筑',
    professionId: 'holy_knight',
    professionName: '圣骑士',
    mainClass: 'knight',
    cardIds,
    exportedAt: new Date().toISOString(),
  };
}

describe('卡牌广场官方职业构筑规则', () => {
  it('接受 10–20 张且不限制同名卡牌数量', () => {
    expect(
      normalizeDeckBuild(build(Array.from({ length: 10 }, () => 'same_card')))
        .cardIds,
    ).toHaveLength(10);
    expect(
      normalizeDeckBuild(build(Array.from({ length: 20 }, () => 'same_card')))
        .cardIds,
    ).toHaveLength(20);
  });

  it('拒绝少于 10 张或多于 20 张', () => {
    expect(() =>
      normalizeDeckBuild(build(Array.from({ length: 9 }, () => 'same_card'))),
    ).toThrow();
    expect(() =>
      normalizeDeckBuild(build(Array.from({ length: 21 }, () => 'same_card'))),
    ).toThrow();
  });
});
