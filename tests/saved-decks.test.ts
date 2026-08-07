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

  it('可以显式绑定牌组面板所在窗口的存储', () => {
    const hostStorage = new Map<string, string>();
    const hostWindow = {
      localStorage: {
        getItem: (key: string) => hostStorage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          hostStorage.set(key, value);
        },
      } as unknown as Storage,
    } as Pick<Window, 'localStorage'>;

    const saved = saveNamedDeckBuild(
      {
        id: 'saved_build_host',
        name: '宿主窗口构筑',
        professionId: 'holy_knight',
        professionName: '圣骑士',
        mainClass: 'knight',
        cardIds: ['card_a'],
      },
      hostWindow,
    );

    expect(readSavedDeckBuilds()).toEqual([]);
    expect(readSavedDeckBuilds(hostWindow)).toEqual([saved]);
    expect(deleteSavedDeckBuild(saved.id, hostWindow)).toBe(true);
    expect(readSavedDeckBuilds(hostWindow)).toEqual([]);
  });
});
