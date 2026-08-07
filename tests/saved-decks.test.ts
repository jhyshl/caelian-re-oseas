import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteSavedDeckBuild,
  readSavedDeckBuilds,
  saveNamedDeckBuild,
} from '@/saved-decks';

afterEach(() => localStorage.clear());

describe('本地命名构筑预设', () => {
  it('保存、覆盖和删除命名构筑', () => {
    const first = saveNamedDeckBuild({
      id: 'saved_build_1',
      name: '圣盾循环',
      professionId: 'holy_knight',
      professionName: '圣骑士',
      mainClass: 'knight',
      cardIds: ['card_a', 'card_b'],
    });
    expect(readSavedDeckBuilds()).toHaveLength(1);

    saveNamedDeckBuild({
      ...first,
      name: '圣盾循环·改',
      cardIds: ['card_a', 'card_b', 'card_c'],
    });
    expect(readSavedDeckBuilds()[0]).toMatchObject({
      id: 'saved_build_1',
      name: '圣盾循环·改',
      cardIds: ['card_a', 'card_b', 'card_c'],
    });

    expect(deleteSavedDeckBuild(first.id)).toBe(true);
    expect(readSavedDeckBuilds()).toEqual([]);
  });
});
