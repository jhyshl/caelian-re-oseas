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
    expect(next.stat_data.caelian.narrative).toEqual({
      ...aiNarrative,
      world: {
        region: '伊拉亚城',
        place: '中央广场',
        location: '伊拉亚城-中央广场',
        gameDate: '新圣约历1385-09-02',
        gameTime: '10:30',
        weather: '多云',
      },
    });
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

  it('不再绑定变量更新事件，由页面打开时主动读取变量管理器', () => {
    const handlers = new Map<unknown, (...args: unknown[]) => void>();
    window.eventOn = vi.fn((event, handler) => {
      handlers.set(event, handler);
      return { stop: () => handlers.delete(event) };
    });
    window.tavern_events = {};
    let current: Record<string, unknown> = {
      stat_data: {
        caelian: {
          narrative: {
            companion: { affinity: 18, mood: '平静' },
          },
        },
      },
    };
    window.Mvu = {
      events: { VARIABLE_UPDATE_ENDED: 'mvu-ended' },
      getMvuData: () => current,
      replaceMvuData: vi.fn(),
    };
    const listener = vi.fn();
    const adapter = new TavernAdapter(window);
    adapter.subscribe(listener);

    expect(handlers.has('mvu-ended')).toBe(false);
    current = {
      stat_data: {
        caelian: {
          narrative: {
            companion: { affinity: 64, mood: '页面打开时读取' },
          },
        },
      },
    };
    expect(adapter.readMvuData()).toEqual(current);
    expect(listener).not.toHaveBeenCalled();
    adapter.unsubscribeAll();
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
      userOriginal: new URL(
        '/User Avatars/user%20persona.png',
        document.baseURI,
      ).href,
      characterOriginal: new URL(
        '/characters/caelian.png',
        document.baseURI,
      ).href,
    });
  });

  it('从聊天记录恢复当前 Persona 的完整原图而不是缩略图', async () => {
    window.SillyTavern = {
      getContext: () => ({
        name1: '当前玩家',
        chat: [
          {
            is_user: true,
            force_avatar: 'User Avatars/current persona.png',
          },
        ],
        powerUserSettings: {
          default_persona: 'different-default.png',
        },
        getThumbnailUrl: (type, file) =>
          `/thumbnail?type=${type}&file=${encodeURIComponent(file)}`,
      }),
    };

    const adapter = new TavernAdapter(window);

    await expect(adapter.avatarUrls()).resolves.toMatchObject({
      user: new URL(
        '/thumbnail?type=persona&file=current%20persona.png',
        document.baseURI,
      ).href,
      userOriginal: new URL(
        '/User Avatars/current%20persona.png',
        document.baseURI,
      ).href,
    });
  });

  it('可从酒馆消息缩略图地址反查玩家 Persona 原图', async () => {
    const message = document.createElement('div');
    message.className = 'mes';
    message.setAttribute('is_user', 'true');
    message.innerHTML =
      '<div class="avatar"><img src="/thumbnail?type=persona&amp;file=full-player.png"></div>';
    document.body.appendChild(message);
    window.SillyTavern = {
      getContext: () => ({
        powerUserSettings: { default_persona: 'default.png' },
        getThumbnailUrl: (type, file) =>
          `/thumbnail?type=${type}&file=${encodeURIComponent(file)}`,
      }),
    };

    const adapter = new TavernAdapter(window);

    await expect(adapter.avatarUrls()).resolves.toMatchObject({
      userOriginal: new URL(
        '/User Avatars/full-player.png',
        document.baseURI,
      ).href,
    });
    message.remove();
  });

  it('强制刷新玩家头像时不会继续复用旧 Persona ID', async () => {
    let persona = 'first.png';
    window.SillyTavern = {
      getContext: () => ({
        chatMetadata: { persona },
        getThumbnailUrl: (type, file) =>
          `/thumbnail?type=${type}&file=${encodeURIComponent(file)}`,
      }),
    };
    const adapter = new TavernAdapter(window);

    await expect(adapter.avatarUrls()).resolves.toMatchObject({
      userOriginal: new URL(
        '/User Avatars/first.png',
        document.baseURI,
      ).href,
    });

    persona = 'second.png';
    await expect(
      adapter.avatarUrls({ refresh: 'user' }),
    ).resolves.toMatchObject({
      userOriginal: new URL(
        '/User Avatars/second.png',
        document.baseURI,
      ).href,
    });
  });

  it('优先从酒馆助手脚本运行窗口读取当前角色头像', async () => {
    window.SillyTavern = {
      getContext: () => ({
        characterId: '0',
        name2: '凯利安',
        characters: [],
      }),
    };
    const runtime = {
      parent: window,
      getCharAvatarPath: vi.fn(() => '/characters/caelian-helper.png'),
    } as unknown as Window;
    const adapter = new TavernAdapter(runtime);

    await expect(adapter.avatarUrls()).resolves.toMatchObject({
      character: new URL(
        '/characters/caelian-helper.png',
        document.baseURI,
      ).href,
      characterOriginal: new URL(
        '/characters/caelian-helper.png',
        document.baseURI,
      ).href,
    });
    expect(runtime.getCharAvatarPath).toHaveBeenCalledWith('current');
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
    let characterAvatar = 'caelian.png';
    const getContext = vi.fn(() => ({
      characterId: '0',
      characters: [{ name: '凯利安', avatar: characterAvatar }],
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

    characterAvatar = 'caelian-new.png';
    const refreshed = await adapter.avatarUrls({ refresh: 'character' });
    expect(refreshed.user).toBe(changed.user);
    expect(refreshed.character).toContain('file=caelian-new.png');
    expect(getContext).toHaveBeenCalledTimes(3);
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

    expect(
      adapter.achievementPatchSignals(new Date(2026, 7, 20, 12, 0, 0)),
    ).toEqual([
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
    listener.mockClear();
    window.dispatchEvent(new CustomEvent('caelian-special-reward-patch'));
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

  it('仅在限定日期自动生成同行的记忆领取信号', () => {
    const adapter = new TavernAdapter(window);

    expect(
      adapter.achievementPatchSignals(new Date(2026, 7, 19, 12, 0, 0)),
    ).toContainEqual({ id: 'memory-together', opened: true });
    expect(
      adapter.achievementPatchSignals(new Date(2026, 7, 20, 12, 0, 0)),
    ).not.toContainEqual(expect.objectContaining({ id: 'memory-together' }));
  });

  it('识别抓虫中信件的导入、开启与历史领取标记', () => {
    const hostState = window as unknown as Record<string, unknown>;
    hostState.__CAELIAN_BUG_FEEDBACK_REWARD_V1__ = true;
    const adapter = new TavernAdapter(window);

    expect(
      adapter.achievementPatchSignals(new Date(2026, 7, 29, 12, 0, 0)),
    ).toContainEqual({ id: 'bug-feedback-reward', opened: false });

    localStorage.setItem(
      'caelian_bug_feedback_reward_v1_letter_opened',
      '1',
    );
    expect(
      adapter.achievementPatchSignals(new Date(2026, 7, 29, 12, 0, 0)),
    ).toContainEqual({ id: 'bug-feedback-reward', opened: true });

    localStorage.removeItem(
      'caelian_bug_feedback_reward_v1_letter_opened',
    );
    delete hostState.__CAELIAN_BUG_FEEDBACK_REWARD_V1__;
  });

  it('读取奖励脚本在运行时注册的成就定义', () => {
    const hostState = window as unknown as Record<string, unknown>;
    hostState.ADVENTURER_ACHIEVEMENT_DEFS = {
      ach_bug_hunting: {
        id: 'ach_bug_hunting',
        name: '抓虫中……',
        star: 5,
      },
    };
    localStorage.setItem(
      'caelian_global_achievements_v1',
      JSON.stringify({ unlocked: { ach_bug_hunting: { unlocked: true } } }),
    );

    expect(new TavernAdapter(window).legacyAchievementPayload()).toMatchObject({
      definitions: {
        ach_bug_hunting: { name: '抓虫中……', star: 5 },
      },
      unlocked: { ach_bug_hunting: { unlocked: true } },
    });

    delete hostState.ADVENTURER_ACHIEVEMENT_DEFS;
  });

  it('为楼层生成内容指纹和包含前文的因果指纹', async () => {
    const chat = [
      { mes: '我前往森林。', is_user: true },
      { mes: '你在林间发现了足迹。', is_user: false },
    ];
    window.SillyTavern = { getContext: () => ({ chat }) };
    const adapter = new TavernAdapter(window);

    const original = await adapter.chatFloors();
    chat[0] = { mes: '我返回旅店。', is_user: true };
    const edited = await adapter.chatFloors();

    expect(original).toHaveLength(2);
    expect(original?.[1]?.fingerprint).toBe(edited?.[1]?.fingerprint);
    expect(original?.[1]?.lineageHash).not.toBe(edited?.[1]?.lineageHash);
  });

  it('读取最近对话并用官方扩展提示接口注入当前任务节点', async () => {
    const setExtensionPrompt = vi.fn();
    window.SillyTavern = {
      getContext: () => ({
        chat: [
          { mes: '系统消息', is_system: true },
          { mes: '我去帮芙萝拉。', is_user: true },
          { mes: '芙萝拉点了点头。', is_user: false },
        ],
        setExtensionPrompt,
      }),
    };
    const adapter = new TavernAdapter(window);

    await expect(adapter.chatConversation()).resolves.toEqual([
      { role: 'user', content: '我去帮芙萝拉。' },
      { role: 'assistant', content: '芙萝拉点了点头。' },
    ]);
    await expect(
      adapter.setQuestContext('只提供当前节点'),
    ).resolves.toBe(true);
    await adapter.setQuestContext('只提供当前节点');

    expect(setExtensionPrompt).toHaveBeenCalledOnce();
    expect(setExtensionPrompt).toHaveBeenCalledWith(
      'caelian.quest.current-node',
      '只提供当前节点',
      1,
      1,
      false,
      0,
    );
  });

  it('把酒馆删除楼层事件和楼层序号传给内核', () => {
    const handlers = new Map<unknown, (...args: unknown[]) => void>();
    window.eventOn = vi.fn((event, handler) => {
      handlers.set(event, handler);
      return { stop: () => handlers.delete(event) };
    });
    window.tavern_events = { MESSAGE_DELETED: 'message-deleted' };
    const listener = vi.fn();
    const adapter = new TavernAdapter(window);
    adapter.subscribe(listener);

    handlers.get('message-deleted')?.(7);

    expect(listener).toHaveBeenCalledWith('MESSAGE_DELETED', {
      messageId: 7,
    });
    adapter.unsubscribeAll();
  });

  it('兼容角色楼层渲染和生成结束事件作为 AI 回复完成信号', () => {
    const handlers = new Map<unknown, (...args: unknown[]) => void>();
    window.eventOn = vi.fn((event, handler) => {
      handlers.set(event, handler);
      return { stop: () => handlers.delete(event) };
    });
    window.tavern_events = {
      CHARACTER_MESSAGE_RENDERED: 'character-message-rendered',
      GENERATION_ENDED: 'generation-ended',
    };
    const listener = vi.fn();
    const adapter = new TavernAdapter(window);
    adapter.subscribe(listener);

    handlers.get('character-message-rendered')?.(8);
    handlers.get('generation-ended')?.(9);

    expect(listener).toHaveBeenNthCalledWith(
      1,
      'CHARACTER_MESSAGE_RENDERED',
      { messageId: 8 },
    );
    expect(listener).toHaveBeenNthCalledWith(
      2,
      'GENERATION_ENDED',
      undefined,
    );
    adapter.unsubscribeAll();
  });
});
