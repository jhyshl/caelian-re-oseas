import { describe, expect, it, vi } from 'vitest';
import {
  entryRegions,
  isLegacyQuestWorldbookEntry,
  normalizeRegion,
  RegionWorldbookSwitcher,
  type RegionWorldbookEntry,
} from '@/worldbook/region-switcher';

function createSwitcher(options: {
  characterName?: string;
  worldbookName?: string;
  entries?: RegionWorldbookEntry[];
}) {
  let entries = options.entries ?? [];
  const api = {
    getCurrentCharacterName: () => options.characterName ?? '凯利安',
    getCharWorldbookNames: () => ({
      primary: options.worldbookName ?? '孔雀开屏你说看不见',
      additional: [],
    }),
    updateWorldbookWith: vi.fn(
      async (
        _name: string,
        updater: (current: RegionWorldbookEntry[]) => RegionWorldbookEntry[],
      ) => {
        entries = updater(entries);
        return entries;
      },
    ),
  };
  return {
    api,
    entries: () => entries,
    switcher: new RegionWorldbookSwitcher(
      () => api,
      async () => options.characterName ?? '凯利安',
    ),
  };
}

describe('地区世界书', () => {
  it('统一地区别名', () => {
    expect(normalizeRegion('索拉姆·圣心大教堂')).toBe('索拉维亚');
    expect(normalizeRegion('学院宿舍楼')).toBe('圣德里安学院');
    expect(normalizeRegion('银月城')).toBe('银月之城');
  });

  it('只按玩家操作开关指定地区条目，不触碰全局、手动和玩家自建条目', async () => {
    const harness = createSwitcher({
      entries: [
        {
          uid: 1,
          name: '全局资料 [AUTO_GLOBAL]',
          enabled: false,
          disable: true,
        },
        {
          uid: 2,
          name: '伊拉亚资料 [AUTO_REGION:伊拉亚城]',
          enabled: false,
          disable: true,
        },
        {
          uid: 3,
          name: '学院资料 [AUTO_REGION:圣德里安学院]',
          enabled: true,
          disable: false,
        },
        {
          uid: 4,
          name: '手动资料 [AUTO_MANUAL]',
          enabled: true,
          disable: false,
        },
        { uid: 5, name: '玩家自建资料', enabled: true },
      ],
    });

    expect(await harness.switcher.inspect()).toMatchObject({
      status: 'current',
      regions: expect.arrayContaining([
        { region: '伊拉亚城', total: 1, enabled: 0, state: 'off' },
        { region: '圣德里安学院', total: 1, enabled: 1, state: 'on' },
      ]),
    });
    const result = await harness.switcher.setRegionEnabled('伊拉亚城', true);

    expect(result).toMatchObject({
      status: 'applied',
      region: '伊拉亚城',
      touched: 1,
      changed: 1,
    });
    expect(harness.entries()).toEqual([
      expect.objectContaining({ uid: 1, enabled: false, disable: true }),
      expect.objectContaining({ uid: 2, enabled: true, disable: false }),
      expect.objectContaining({ uid: 3, enabled: true, disable: false }),
      expect.objectContaining({ uid: 4, enabled: true, disable: false }),
      { uid: 5, name: '玩家自建资料', enabled: true },
    ]);
    expect(
      await harness.switcher.switchRegion('伊拉亚城', '圣德里安学院'),
    ).toMatchObject({
      status: 'applied',
      region: '圣德里安学院',
      touched: 2,
      changed: 1,
    });
    expect(harness.entries()[1]).toMatchObject({ enabled: false, disable: true });
    expect(harness.entries()[2]).toMatchObject({ enabled: true, disable: false });
  });

  it('支持 comment、name 和 extra.comment 上的地区标记', () => {
    expect(
      entryRegions({ comment: '地点 [AUTO_REGION:奈亚索斯城,阿必塞海]' }),
    ).toEqual(['奈亚索斯城', '阿必塞海']);
    expect(
      entryRegions({ extra: { comment: '地点 [AUTO_REGION:炉心城]' } }),
    ).toEqual(['炉心城']);
  });

  it('幂等删除旧任务剧情，但保留地区资料和玩家同 UID 自建条目', async () => {
    const harness = createSwitcher({
      entries: [
        { uid: 85, name: '主线｜总控 [AUTO_MAINQUEST_GLOBAL]' },
        {
          uid: 999,
          name: 'DLC｜银月主线｜阶段0-西西里 [AUTO_MAINQUEST:银月之城|quest|0|西西里]',
        },
        {
          uid: 169,
          name: '原版DLC补全｜DLC.Niyasos＆Abyssian Sea 2.0 (1)｜🧡失败的献祭 [AUTO_REGION:奈亚索斯城,阿必塞海]',
        },
        {
          uid: 45,
          name: 'DLC｜Combat｜奈亚索斯/阿必塞海 [AUTO_REGION:奈亚索斯城,阿必塞海]',
        },
        { uid: 42, name: '玩家自建的第42条资料' },
      ],
    });

    expect(isLegacyQuestWorldbookEntry({ uid: 42, name: '玩家自建' })).toBe(
      false,
    );
    expect(await harness.switcher.cleanupLegacyQuestEntries()).toEqual({
      status: 'applied',
      removed: 3,
    });
    expect(harness.entries().map((entry) => entry.name)).toEqual([
      'DLC｜Combat｜奈亚索斯/阿必塞海 [AUTO_REGION:奈亚索斯城,阿必塞海]',
      '玩家自建的第42条资料',
    ]);
    expect(await harness.switcher.cleanupLegacyQuestEntries()).toEqual({
      status: 'current',
      removed: 0,
    });
  });

  it('角色或绑定世界书不匹配时不修改内容', async () => {
    const wrongCharacter = createSwitcher({
      characterName: '其他角色',
      entries: [{ uid: 85, name: '主线｜总控 [AUTO_MAINQUEST_GLOBAL]' }],
    });
    expect(await wrongCharacter.switcher.cleanupLegacyQuestEntries()).toEqual({
      status: 'wrong-character',
      removed: 0,
    });
    expect(wrongCharacter.api.updateWorldbookWith).not.toHaveBeenCalled();

    const wrongWorldbook = createSwitcher({
      worldbookName: '玩家自己的世界书',
      entries: [{ name: '地点 [AUTO_REGION:伊拉亚城]' }],
    });
    expect(
      await wrongWorldbook.switcher.setRegionEnabled('伊拉亚城', true),
    ).toMatchObject({
      status: 'wrong-worldbook',
    });
    expect(wrongWorldbook.api.updateWorldbookWith).not.toHaveBeenCalled();
  });
});
