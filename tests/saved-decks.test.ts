import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteSavedDeckBuild,
  readSavedDeckBuilds,
  saveNamedDeckBuild,
} from '@/saved-decks';

afterEach(() => localStorage.clear());

describe('本地命名构筑预设', () => {
  it('保存、覆盖和删除命名构筑', () => {
    const firstCards = Array.from({ length: 10 }, (_, index) => `card_${index}`);
    const updatedCards = [...firstCards, 'card_10'];
    const first = saveNamedDeckBuild({
      id: 'saved_build_1',
      name: '圣盾循环',
      professionId: 'holy_knight',
      professionName: '圣骑士',
      mainClass: 'knight',
      cardIds: firstCards,
    });
    expect(readSavedDeckBuilds()).toHaveLength(1);

    saveNamedDeckBuild({
      ...first,
      name: '圣盾循环·改',
      cardIds: updatedCards,
    });
    expect(readSavedDeckBuilds()[0]).toMatchObject({
      id: 'saved_build_1',
      name: '圣盾循环·改',
      cardIds: updatedCards,
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
        cardIds: Array.from({ length: 10 }, () => 'card_a'),
      },
      hostWindow,
    );

    expect(readSavedDeckBuilds()).toEqual([]);
    expect(readSavedDeckBuilds(hostWindow)).toEqual([saved]);
    expect(deleteSavedDeckBuild(saved.id, hostWindow)).toBe(true);
    expect(readSavedDeckBuilds(hostWindow)).toEqual([]);
  });

  it('本地存储不可用时明确报错，不会伪装成保存成功', () => {
    const unavailable = {} as Pick<Window, 'localStorage'>;
    Object.defineProperty(unavailable, 'localStorage', {
      get: () => {
        throw new Error('storage blocked');
      },
    });

    expect(() =>
      saveNamedDeckBuild(
        {
          id: 'saved_build_blocked',
          name: '无法保存的构筑',
          professionId: 'holy_knight',
          professionName: '圣骑士',
          mainClass: 'knight',
          cardIds: Array.from({ length: 10 }, () => 'card_a'),
        },
        unavailable,
      ),
    ).toThrow('当前酒馆窗口无法使用本地存储');
  });

  it('只接受 10–20 张构筑，并允许任意数量的同名卡牌', () => {
    expect(() =>
      saveNamedDeckBuild({
        id: 'saved_build_too_short',
        name: '不足十张',
        professionId: 'holy_knight',
        professionName: '圣骑士',
        mainClass: 'knight',
        cardIds: Array.from({ length: 9 }, () => 'same_card'),
      }),
    ).toThrow();

    expect(
      saveNamedDeckBuild({
        id: 'saved_build_duplicates',
        name: '同名构筑',
        professionId: 'holy_knight',
        professionName: '圣骑士',
        mainClass: 'knight',
        cardIds: Array.from({ length: 20 }, () => 'same_card'),
      }).cardIds,
    ).toHaveLength(20);
  });
});
