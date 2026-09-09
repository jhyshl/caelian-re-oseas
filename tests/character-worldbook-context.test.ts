import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readCharacterTarget } from '@/tavern/character-target';
import { RegionWorldbookSwitcher, type RegionWorldbookEntry } from '@/worldbook/region-switcher';

const official = '孔雀开屏你说你看不见beta';
const bridge = { id: 'a5b20232-9d44-4570-ac96-9448a1df81fe' };

function harness() {
  const card = {
    name: '凯利安beta', avatar: '凯利安beta_1.png',
    data: { name: '凯利安beta', extensions: { world: official, tavern_helper: { scripts: [bridge] } } },
  };
  const context = { characterId: '0' as string | null, name2: 'current', characters: [card, { ...structuredClone(card), avatar: 'another.png' }], getRequestHeaders: () => ({}) };
  let entries: RegionWorldbookEntry[] = [
    { name: '凯利安_阶段01_陌生人', enabled: true },
    { name: '特莱奥，最好的伙伴！', enabled: true },
    { name: '学院 [AUTO_REGION:圣德里安学院]', enabled: true },
    { name: '城市 [AUTO_REGION:伊拉亚城]', enabled: false },
  ];
  const api = {
    getCurrentCharacterName: vi.fn(() => 'current'),
    getCharWorldbookNames: vi.fn(async () => ({ primary: null as string | null, additional: [] as string[] })),
    getWorldbook: vi.fn(async (name: string) => { expect(name).toBeTruthy(); return structuredClone(entries); }),
    updateWorldbookWith: vi.fn(async (_name: string, update: (value: RegionWorldbookEntry[]) => RegionWorldbookEntry[]) => {
      entries = update(structuredClone(entries));
      return structuredClone(entries);
    }),
  };
  const host = {
    SillyTavern: { getContext: vi.fn(() => context) },
    fetch: vi.fn(async () => ({ ok: true, json: async () => structuredClone(card) })),
  } as unknown as Window;
  return { card, context, api, host, entries: () => entries,
    switcher: new RegionWorldbookSwitcher(() => api, async () => 'current', host) };
}

describe('实际角色记录与世界书绑定', () => {
  it.each(['11dc566b-8d62-4892-912d-b9f5b25df1b0', 'fd9cf9c7-fabe-47f8-beb4-63d17839f379', 'f56df46e-b198-4d84-9e94-269079a31e17', '4cd6194c-ed4f-418c-a3e2-216351c95efe'])('支持实际导出器的桥接标识 %s', async (id) => {
    expect(readFileSync('scripts/export-tavern-helper.mjs', 'utf8')).toContain(id);
    const h = harness();
    h.card.name = h.card.data.name = 'beta';
    h.card.avatar = '作者自定义文件名.png';
    h.card.data.extensions.tavern_helper.scripts = [{ id }];
    expect(await h.switcher.inspect()).toMatchObject({ status: 'current' });
  });

  it('忽略过时的 current 显示名和空助手绑定，按当前角色真实绑定切换', async () => {
    const h = harness();
    expect(await h.switcher.switchRegion('学院', '伊拉亚城')).toMatchObject({ status: 'applied', changed: 2 });
    expect(h.api.updateWorldbookWith.mock.calls[0]?.[0]).toBe(official);
    expect(h.api.getCurrentCharacterName).not.toHaveBeenCalled();
    expect((await readCharacterTarget(h.host)).avatar).toBe('凯利安beta_1.png');
  });

  it.each(['current', '我的小孔雀', 'beta'])('真实卡名 %s 含官方桥接标识仍可用', async (name) => {
    const h = harness();
    h.card.name = name;
    h.card.data.name = name;
    h.card.avatar = '作者发给玩家的测试版本_2.png';
    expect(await h.switcher.inspect()).toMatchObject({ status: 'current' });
    expect(await readCharacterTarget(h.host)).toMatchObject({ avatar: '作者发给玩家的测试版本_2.png', isCaelian: true });
  });

  it('没有凯利安标识的 current 卡不能只靠世界书名获得写入资格', async () => {
    const h = harness();
    h.card.name = h.card.data.name = 'current';
    h.card.data.extensions.tavern_helper.scripts = [];
    expect(await h.switcher.setRegionEnabled('伊拉亚城', true)).toMatchObject({ status: 'wrong-character' });
    expect(h.api.updateWorldbookWith).not.toHaveBeenCalled();
  });

  it.each([null, ''])('空 characterId %s 不得选中第零张卡', async (id) => {
    const h = harness();
    h.context.characterId = id;
    await expect(readCharacterTarget(h.host)).rejects.toThrow('尚未准备好');
    expect(h.host.fetch).not.toHaveBeenCalled();
  });

  it('首次读取角色尚未就绪时短暂重试恢复', async () => {
    const h = harness();
    vi.mocked(h.host.SillyTavern!.getContext!).mockReturnValueOnce({ ...h.context, characterId: undefined });
    expect(await h.switcher.inspect()).toMatchObject({ status: 'current' });
  });

  it('世界书首次读取失败会重新读取实际头像的持久化绑定', async () => {
    const h = harness();
    h.api.getWorldbook.mockRejectedValueOnce(new Error('loading'));
    expect(await h.switcher.inspect()).toMatchObject({ status: 'current' });
    expect(h.host.fetch).toHaveBeenCalledWith('/api/characters/get', expect.objectContaining({ body: JSON.stringify({ avatar_url: '凯利安beta_1.png' }) }));
  });

  it('一次操作失败不缓存失败，下次操作无需刷新酒馆', async () => {
    const h = harness();
    const read = h.api.getWorldbook.getMockImplementation()!;
    h.api.getWorldbook.mockRejectedValue(new Error('temporary'));
    expect(await h.switcher.inspect()).toMatchObject({ status: 'unavailable' });
    h.api.getWorldbook.mockImplementation(read);
    expect(await h.switcher.setRegionEnabled('伊拉亚城', true)).toMatchObject({ status: 'applied' });
  });

  it('支持唯一的附加世界书和异步绑定接口', async () => {
    const h = harness();
    h.card.data.extensions.world = '';
    h.api.getCharWorldbookNames.mockResolvedValue({ primary: null, additional: [official] });
    expect(await h.switcher.inspect()).toMatchObject({ status: 'current' });
  });

  it('重命名的绑定世界书通过真实内容识别', async () => {
    const h = harness();
    h.card.data.extensions.world = '我的世界书副本';
    expect(await h.switcher.setRegionEnabled('伊拉亚城', true)).toMatchObject({ status: 'applied' });
    expect(h.api.updateWorldbookWith.mock.calls[0]?.[0]).toBe('我的世界书副本');
  });

  it('只含地区标签的无关世界书不被误写', async () => {
    const h = harness();
    h.card.data.extensions.world = '其他世界';
    h.api.getWorldbook.mockResolvedValue([{ name: '[AUTO_REGION:伊拉亚城]', enabled: false }]);
    expect(await h.switcher.setRegionEnabled('伊拉亚城', true)).toMatchObject({ status: 'wrong-worldbook', message: expect.stringContaining('已绑定') });
    expect(h.api.updateWorldbookWith).not.toHaveBeenCalled();
  });

  it('多本附加候选不任意挑选一本写入', async () => {
    const h = harness();
    h.card.data.extensions.world = '';
    h.api.getCharWorldbookNames.mockResolvedValue({ primary: null, additional: [official, '另一本'] });
    expect(await h.switcher.setRegionEnabled('伊拉亚城', true)).toMatchObject({ status: 'wrong-worldbook', message: expect.stringContaining('多本') });
    expect(h.api.updateWorldbookWith).not.toHaveBeenCalled();
  });

  it.each(['character', 'binding'])('读取中 %s 改变，不能重试到新目标后写入', async (change) => {
    const h = harness();
    h.api.getWorldbook.mockImplementationOnce(async () => {
      if (change === 'character') h.context.characterId = '1';
      else h.card.data.extensions.world = '另一本';
      return structuredClone(h.entries());
    });
    expect(await h.switcher.setRegionEnabled('伊拉亚城', true)).toMatchObject({ status: 'unavailable' });
    expect(h.api.updateWorldbookWith).not.toHaveBeenCalled();
  });

  it('排队中的点击不会跟随切换后的角色', async () => {
    const h = harness();
    const pending = h.switcher.setRegionEnabled('伊拉亚城', true);
    h.context.characterId = '1';
    expect(await pending).toMatchObject({ status: 'unavailable' });
    expect(h.api.updateWorldbookWith).not.toHaveBeenCalled();
  });

  it('助手等待后才调用更新回调时再次检查角色', async () => {
    const h = harness();
    h.api.updateWorldbookWith.mockImplementationOnce(async (_name, update) => {
      h.context.characterId = '1';
      return update(structuredClone(h.entries()));
    });
    expect(await h.switcher.setRegionEnabled('伊拉亚城', true)).toMatchObject({ status: 'failed' });
    expect(h.entries()[3]?.enabled).toBe(false);
  });
});
