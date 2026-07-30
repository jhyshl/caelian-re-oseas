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
    world: {
      region: '圣德里安学院',
      place: '中央广场',
      location: '圣德里安学院-中央广场',
      gameDate: '新圣约历1385-09-01',
      gameTime: '08:00',
      weather: '晴朗',
      mainStage: 0,
      mainStep: 0,
    },
    storyFlags: {},
  },
};

afterEach(() => {
  delete window.Mvu;
  delete window.SillyTavern;
  delete window.eventOn;
  delete window.tavern_events;
  delete window.getCharAvatarPath;
  vi.useRealTimers();
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
      caelian: {
        _meta: projection._meta,
        state: projection.state,
      },
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

  it('回写只读投影时保留 AI 已写入的 narrative', async () => {
    const replaceMvuData = vi.fn();
    const aiNarrative = {
      companion: {
        affinity: 28,
        mood: '安心',
        location: '中央广场',
        clothing: '学院制服',
        innerThought: '他今天似乎很高兴。',
      },
      world: {
        region: '伊拉亚城',
        place: '中央广场',
        location: '伊拉亚城-中央广场',
        gameDate: '新圣约历1385-09-02',
        gameTime: '10:30',
        weather: '多云',
        mainStage: 1,
        mainStep: 2,
      },
      storyFlags: { 已经出发: true },
    };
    window.Mvu = {
      getMvuData: () => ({
        stat_data: {
          caelian: {
            ...projection,
            _meta: { ...projection._meta, revision: 0 },
            narrative: aiNarrative,
          },
        },
      }),
      replaceMvuData,
    };
    const adapter = new TavernAdapter(window);

    await adapter.writeProjection(projection);

    const next = replaceMvuData.mock.calls[0]?.[0] as {
      stat_data: { caelian: AiProjection };
    };
    expect(next.stat_data.caelian.narrative).toEqual(aiNarrative);
  });

  it('新版 narrative 缺少字段时保持变量管理器原样，不由脚本补写', async () => {
    const replaceMvuData = vi.fn();
    window.Mvu = {
      getMvuData: () => ({
        stat_data: {
          caelian: {
            narrative: {
              companion: {
                ...projection.narrative.companion,
                affinity: 25,
              },
              storyFlags: { 玩家保留标记: true },
            },
          },
        },
      }),
      replaceMvuData,
    };
    const adapter = new TavernAdapter(window);

    await adapter.writeProjection(projection);

    const next = replaceMvuData.mock.calls[0]?.[0] as {
      stat_data: { caelian: AiProjection };
    };
    expect(next.stat_data.caelian.narrative).toEqual({
      companion: {
        ...projection.narrative.companion,
        affinity: 25,
      },
      storyFlags: { 玩家保留标记: true },
    });
  });

  it('在 MVU 更新完成后防抖触发重新读取事件', async () => {
    vi.useFakeTimers();
    const handlers = new Map<
      unknown,
      (...args: unknown[]) => void
    >();
    const stop = vi.fn();
    window.eventOn = vi.fn((event, handler) => {
      handlers.set(event, handler);
      return { stop };
    });
    window.tavern_events = {};
    window.Mvu = {
      events: { VARIABLE_UPDATE_ENDED: 'mvu-ended' },
      getMvuData: () => ({}),
      replaceMvuData: vi.fn(),
    };
    const listener = vi.fn();
    const adapter = new TavernAdapter(window);
    adapter.subscribe(listener);

    const first = {
      stat_data: {
        caelian: {
          narrative: {
            companion: { affinity: 12 },
          },
        },
      },
    };
    const latest = {
      stat_data: {
        caelian: {
          narrative: {
            companion: { affinity: 37 },
          },
        },
      },
    };
    const before = {
      stat_data: {
        caelian: {
          narrative: {
            companion: { affinity: 10 },
          },
        },
      },
    };
    handlers.get('mvu-ended')?.(first, before);
    handlers.get('mvu-ended')?.(latest, first);
    await vi.advanceTimersByTimeAsync(179);
    expect(listener).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      'MVU_VARIABLE_UPDATE_ENDED',
      {
        mvuData: latest,
        previousMvuData: first,
      },
    );

    adapter.unsubscribeAll();
    expect(stop).toHaveBeenCalledTimes(1);
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

  it('缓存官方缩略图地址，并只在头像事件后重新解析', async () => {
    const handlers = new Map<unknown, (...args: unknown[]) => void>();
    window.eventOn = vi.fn((event, handler) => {
      handlers.set(event, handler);
      return undefined;
    });
    window.tavern_events = {
      PERSONA_CHANGED: 'persona-changed',
      CHARACTER_EDITED: 'character-edited',
    };
    const personaBlock = document.createElement('div');
    personaBlock.id = 'user_avatar_block';
    const selectedPersona = document.createElement('div');
    selectedPersona.className = 'avatar-container selected';
    selectedPersona.dataset.avatarId = 'first.png';
    personaBlock.appendChild(selectedPersona);
    document.body.appendChild(personaBlock);
    const getContext = vi.fn(() => ({
      characterId: '0',
      characters: [{ name: '凯利安', avatar: 'caelian.png' }],
      getThumbnailUrl: (type: 'avatar' | 'persona', file: string) =>
        `/thumbnail?type=${type}&file=${encodeURIComponent(file)}`,
    }));
    window.SillyTavern = { getContext };
    const adapter = new TavernAdapter(window);
    adapter.subscribe(vi.fn());

    const first = await adapter.avatarUrls();
    const cached = await adapter.avatarUrls();
    expect(cached).toEqual(first);
    expect(getContext).toHaveBeenCalledTimes(1);

    handlers.get('persona-changed')?.('second.png');
    const changed = await adapter.avatarUrls();
    expect(changed.user).toContain('file=second.png');
    expect(changed.character).toBe(first.character);
    expect(getContext).toHaveBeenCalledTimes(2);
  });

  it('普通 iframe 不会因为父窗口可访问就被误判为酒馆宿主', () => {
    const standalone = {
      parent: window,
    } as unknown as Window;

    expect(resolveTavernHost(standalone)).toBe(standalone);
  });

  it('识别玩家已导入的补丁授权，并在补丁事件后立即通知 Alpha', () => {
    localStorage.setItem('caelian_special_patch_old_player_v1', '1');
    localStorage.setItem(
      'caelian_launch_reward_old_timer_v1_letter_opened',
      '1',
    );
    const hostState = window as unknown as Record<string, unknown>;
    hostState.__CAELIAN_SPECIAL_PATCH_REPO_REWARD__ = true;
    const adapter = new TavernAdapter(window);

    expect(adapter.achievementPatchSignals()).toEqual([
      { id: 'old-player', opened: false },
      { id: 'repo-reward', opened: false },
      { id: 'old-timer', opened: true },
    ]);

    const listener = vi.fn();
    adapter.subscribe(listener);
    window.dispatchEvent(
      new CustomEvent('caelian-special-achievement-patch'),
    );
    expect(listener).toHaveBeenCalledWith('ACHIEVEMENT_PATCH_CHANGED');
    adapter.unsubscribeAll();
    listener.mockClear();
    window.dispatchEvent(
      new CustomEvent('caelian-special-achievement-patch'),
    );
    expect(listener).not.toHaveBeenCalled();

    localStorage.removeItem('caelian_special_patch_old_player_v1');
    localStorage.removeItem(
      'caelian_launch_reward_old_timer_v1_letter_opened',
    );
    delete hostState.__CAELIAN_SPECIAL_PATCH_REPO_REWARD__;
  });
});
