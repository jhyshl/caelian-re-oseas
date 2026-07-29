import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiProjection } from '@/domain/types';
import { resolveTavernHost, TavernAdapter } from '@/tavern/adapter';

const projection: AiProjection = {
  _meta: {
    schemaVersion: 3,
    owner: 'caelian-alpha',
    channel: 'alpha',
    revision: 1,
  },
  state: {
    player: {
      name: '测试者',
      profession: '炼金术士',
      level: 1,
      hp: 80,
      hpMax: 80,
      mp: 30,
      mpMax: 30,
      gold: 500,
    },
    world: {
      region: '圣德里安学院',
      location: '中央广场',
      gameDate: '',
      gameTime: '',
      weather: '',
      mainStage: 0,
      mainStep: 0,
      accessibleRegions: [],
    },
    guild: { rank: 'copper', activeQuests: [] },
    battle: {
      active: false,
      status: 'none',
      phase: 'none',
      source: '',
      relatedQuestId: '',
      turn: 0,
      enemies: [],
      result: null,
    },
    companion: { relationshipStage: '陌生人' },
  },
  narrative: {
    companion: {
      affinity: 0,
      mood: '平静',
      location: '圣德里安学院',
      clothing: '白色暗纹衬衫',
      innerThought: '',
    },
    storyFlags: {},
  },
};

afterEach(() => {
  delete window.Mvu;
  delete window.SillyTavern;
  document.querySelector('#user_avatar_block')?.remove();
});

describe('TavernAdapter', () => {
  it('只替换 stat_data.caelian，并保留其他 MVU 数据', async () => {
    const replaceMvuData = vi.fn();
    window.Mvu = {
      getMvuData: () => ({
        stat_data: {
          existing_system: { keep: true },
        },
        unrelated: 'preserved',
      }),
      replaceMvuData,
    };
    const adapter = new TavernAdapter(window);

    await expect(adapter.writeProjection(projection)).resolves.toBe(true);
    expect(replaceMvuData).toHaveBeenCalledTimes(1);
    const next = replaceMvuData.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(next.unrelated).toBe('preserved');
    expect(next.stat_data).toEqual({
      existing_system: { keep: true },
      caelian: projection,
    });

    delete window.Mvu;
  });

  it('移除旧欧西亚斯顶层变量，但保留其他插件数据', async () => {
    const replaceMvuData = vi.fn();
    const current = {
      stat_data: {
        世界: { 天气: '晴朗' },
        地区剧情: {},
        凯利安: { 好感度: 10 },
        玩家: { 背包: { 药水: 3 } },
        协会: {},
        战斗: {},
        pixel_pet: { keep: true },
      },
    };
    window.Mvu = {
      getMvuData: () => current,
      replaceMvuData,
    };
    const adapter = new TavernAdapter(window);

    expect(adapter.readMvuData()).toEqual(current);
    await expect(adapter.writeProjection(projection)).resolves.toBe(true);
    const next = replaceMvuData.mock.calls[0]?.[0] as {
      stat_data: Record<string, unknown>;
    };
    expect(next.stat_data).toEqual({
      pixel_pet: { keep: true },
      caelian: projection,
    });

    delete window.Mvu;
  });

  it('投影未变化时跳过 MVU 回写', async () => {
    const replaceMvuData = vi.fn();
    window.Mvu = {
      getMvuData: () => ({ stat_data: { caelian: projection } }),
      replaceMvuData,
    };
    const adapter = new TavernAdapter(window);

    await expect(adapter.writeProjection(projection)).resolves.toBe(false);
    expect(replaceMvuData).not.toHaveBeenCalled();

    delete window.Mvu;
  });

  it('把行动文字写入酒馆输入框并派发输入事件', () => {
    const textarea = document.createElement('textarea');
    textarea.id = 'send_textarea';
    const input = vi.fn();
    textarea.addEventListener('input', input);
    document.body.appendChild(textarea);

    const adapter = new TavernAdapter(window);
    expect(adapter.setUserInput('前往伊拉亚城')).toBe(true);
    expect(textarea.value).toBe('前往伊拉亚城');
    expect(input).toHaveBeenCalledTimes(1);

    textarea.remove();
  });

  it('读取当前 User Persona 与角色卡头像', async () => {
    const personaBlock = document.createElement('div');
    personaBlock.id = 'user_avatar_block';
    const selectedPersona = document.createElement('div');
    selectedPersona.className = 'avatar-container selected';
    selectedPersona.dataset.avatarId = 'user persona.png';
    personaBlock.appendChild(selectedPersona);
    document.body.appendChild(personaBlock);

    window.SillyTavern = {
      getContext: () => ({
        characterId: '0',
        name2: '凯利安',
        characters: [{ name: '凯利安', avatar: 'caelian.png' }],
        getThumbnailUrl: (type, file) =>
          `/thumbnail?type=${type}&file=${encodeURIComponent(file)}`,
      }),
    };

    const adapter = new TavernAdapter(window);

    await expect(adapter.avatarUrls()).resolves.toEqual({
      user: new URL(
        '/thumbnail?type=persona&file=user%20persona.png',
        document.baseURI,
      ).href,
      character: new URL(
        '/thumbnail?type=avatar&file=caelian.png',
        document.baseURI,
      ).href,
    });
  });

  it('普通 iframe 不会因为父窗口可访问就被误判为酒馆宿主', () => {
    const standalone = {
      parent: window,
    } as unknown as Window;

    expect(resolveTavernHost(standalone)).toBe(standalone);
  });
});
