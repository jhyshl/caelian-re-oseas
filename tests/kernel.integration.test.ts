import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import questCatalogJson from '../public/managed-content/quests/alpha.json';
import { createKernel } from '@/kernel/create-kernel';
import { QuestCatalog } from '@/quests/catalog';
import { initialQuestProgress } from '@/quests/state-machine';
import { CaelianDatabase } from '@/storage/database';
import { avatarPreferenceKey } from '@/ui/avatar-preferences';
import { SAVED_DECKS_STORAGE_KEY } from '@/saved-decks';

const databaseNames: string[] = [];
const defaultFetch = window.fetch;
const academyQuest = QuestCatalog.parse(questCatalogJson).get(
  'main_academy_anniversary_preparation',
);
if (!academyQuest) throw new Error('学院主线测试定义未加载');

beforeEach(() => {
  window.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
});

afterEach(async () => {
  window.fetch = defaultFetch;
  delete window.__CaelianRuntime;
  delete window.Mvu;
  delete window.SillyTavern;
  delete window.eventOn;
  delete window.tavern_events;
  delete (window as unknown as Record<string, unknown>).TavernHelper;
  localStorage.removeItem('caelian_launcher_order_v1');
  localStorage.removeItem('caelian_quest_judge_preferences_v1');
  sessionStorage.removeItem('caelian_quest_judge_api_key_session_v1');
  localStorage.removeItem(avatarPreferenceKey('caelian'));
  localStorage.removeItem(avatarPreferenceKey('player'));
  localStorage.removeItem(SAVED_DECKS_STORAGE_KEY);
  document
    .querySelectorAll('[data-caelian-panel]')
    .forEach((element) => element.remove());
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)));
});

describe('CaelianKernel integration', () => {
  it('首次领取同行的记忆后弹出旧信纸风格信件，重启不重复弹出', async () => {
    const databaseName = `caelian-alpha-memory-letter-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    const createMemoryKernel = () =>
      createKernel({
        channel: 'alpha',
        version: '0.2.0-alpha.memory-test',
        buildId: 'memory-letter-test-build',
        databaseName,
        sourceWindow: window,
        now: () => new Date(2026, 7, 19, 12, 0, 0),
      });
    const firstKernel = createMemoryKernel();

    await firstKernel.initialize();
    for (const panel of ['release-notes', 'achievement-letter'] as const) {
      if (firstKernel.api.listOpenPanels().includes(panel)) {
        await firstKernel.api.closePanel(panel);
      }
    }
    await firstKernel.api.execute({
      id: 'memory-letter-create-player',
      type: 'player.create',
      payload: {
        name: '同行者',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });

    const letter = document.querySelector(
      '[data-caelian-panel="memory-together-letter"]',
    );
    expect(letter).not.toBeNull();
    expect(letter?.textContent).toContain('给同行者：');
    expect(letter?.textContent).toContain('往后的路还很长，别擅自掉队。');
    expect(letter?.querySelector('.signature')?.textContent).toBe('caelian');
    expect(letter?.textContent).toContain('金币520');
    await firstKernel.api.shutdown();

    const repeatedKernel = createMemoryKernel();
    await repeatedKernel.initialize();
    expect(
      document.querySelector('[data-caelian-panel="memory-together-letter"]'),
    ).toBeNull();
    await repeatedKernel.api.shutdown();
  });

  it('从独立入口挂载完整合成台并读取全部 50 条配方', async () => {
    const databaseName = `caelian-alpha-crafting-panel-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(new Response(null, { status: 404 }));
    const kernel = createKernel({
      channel: 'alpha',
      version: '0.2.0-alpha.test',
      buildId: 'crafting-panel-test-build',
      databaseName,
      sourceWindow: window,
    });

    await kernel.initialize();
    await kernel.api.navigatePanel('crafting');
    await expect
      .poll(() => document.querySelectorAll('.recipe-list > button').length)
      .toBe(50);
    expect(document.body.textContent).toContain('合成台');
    expect(document.body.textContent).toContain('装备升星');
    expect(document.body.textContent).toContain('材料和产物会在同一事务内写入');

    await kernel.api.shutdown();
    fetchMock.mockRestore();
  });

  it('清理旧剧情，但只在玩家手动操作时切换地区世界书', async () => {
    const databaseName = `caelian-alpha-region-book-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    const handlers = new Map<unknown, (...args: unknown[]) => void>();
    window.eventOn = vi.fn((event, handler) => {
      handlers.set(event, handler);
      return { stop: () => handlers.delete(event) };
    });
    window.tavern_events = {
      USER_MESSAGE_RENDERED: 'user-message-rendered',
    };
    const chat: Array<{ mes: string; is_user: boolean }> = [];
    window.SillyTavern = {
      getContext: () => ({
        chatId: 'region-book-chat',
        name1: '测试冒险者',
        name2: '凯利安',
        chat,
      }),
    };
    let worldbook = [
      {
        uid: 85,
        name: '主线｜总控 [AUTO_MAINQUEST_GLOBAL]',
        enabled: true,
        disable: false,
      },
      {
        uid: 43,
        name: '全局设定 [AUTO_GLOBAL]',
        enabled: false,
        disable: true,
      },
      {
        uid: 79,
        name: '伊拉亚资料 [AUTO_REGION:伊拉亚城]',
        enabled: false,
        disable: true,
      },
      {
        uid: 78,
        name: '学院资料 [AUTO_REGION:圣德里安学院]',
        enabled: true,
        disable: false,
      },
      { uid: 500, name: '玩家自建资料', enabled: true },
    ];
    const helper = {
      getCurrentCharacterName: () => '凯利安',
      getCharWorldbookNames: () => ({
        primary: '孔雀开屏你说看不见',
        additional: [],
      }),
      updateWorldbookWith: vi.fn(
        async (
          _name: string,
          updater: (entries: typeof worldbook) => typeof worldbook,
        ) => {
          worldbook = updater(worldbook);
          return worldbook;
        },
      ),
    };
    (window as unknown as Record<string, unknown>).TavernHelper = helper;
    const kernel = createKernel({
      channel: 'alpha',
      version: '0.2.0-alpha.test',
      buildId: 'region-book-test-build',
      databaseName,
      sourceWindow: window,
    });

    await kernel.initialize();

    expect(worldbook.map((entry) => entry.uid)).toEqual([43, 79, 78, 500]);
    expect(worldbook.find((entry) => entry.uid === 79)).toMatchObject({
      enabled: false,
      disable: true,
    });
    expect(worldbook.find((entry) => entry.uid === 78)).toMatchObject({
      enabled: true,
      disable: false,
    });

    chat.push({ mes: '从伊拉亚城前往圣德里安学院', is_user: true });
    handlers.get('user-message-rendered')?.(0);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(worldbook.find((entry) => entry.uid === 78)?.enabled).toBe(true);
    expect(worldbook.find((entry) => entry.uid === 79)?.enabled).toBe(false);

    expect(
      await kernel.api.setRegionWorldbook('伊拉亚城', true),
    ).toMatchObject({ status: 'applied', touched: 1 });
    expect(worldbook.find((entry) => entry.uid === 79)).toMatchObject({
      enabled: true,
      disable: false,
    });
    expect(
      await kernel.api.switchRegionWorldbook(
        '伊拉亚城',
        '圣德里安学院',
      ),
    ).toMatchObject({ status: 'applied', touched: 2 });
    expect(worldbook.find((entry) => entry.uid === 79)).toMatchObject({
      enabled: false,
      disable: true,
    });
    expect(worldbook.find((entry) => entry.uid === 78)?.enabled).toBe(true);
    expect(await kernel.api.getRegionWorldbookStatus()).toMatchObject({
      status: 'current',
      regions: expect.arrayContaining([
        expect.objectContaining({ region: '伊拉亚城', state: 'off' }),
        expect.objectContaining({ region: '圣德里安学院', state: 'on' }),
      ]),
    });
    expect(worldbook.find((entry) => entry.uid === 500)).toEqual({
      uid: 500,
      name: '玩家自建资料',
      enabled: true,
    });

    await kernel.api.shutdown();
  });

  it('运行中发现新问卷时弹出提示，并可直接打开独立问卷面板', async () => {
    const databaseName = `caelian-alpha-survey-notice-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    const catalog = {
      schemaVersion: 1,
      channel: 'alpha',
      revision: 'test.1',
      surveys: [
        {
          id: 'test-runtime-survey',
          revision: 1,
          kind: 'single',
          title: '运行时新问卷',
          description: '不刷新酒馆也应收到提醒。',
          active: true,
          questions: [
            {
              id: 'opinion',
              type: 'short-text',
              title: '你的意见',
              required: true,
            },
          ],
        },
      ],
    };
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockImplementation(async (input) => {
        if (String(input).includes('/managed-content/surveys/alpha.json')) {
          return new Response(JSON.stringify(catalog), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(null, { status: 404 });
      });
    const kernel = createKernel({
      channel: 'alpha',
      version: '0.2.0-alpha.test',
      buildId: 'survey-notice-test-build',
      databaseName,
      sourceWindow: window,
    });

    await kernel.initialize();
    if (kernel.api.listOpenPanels().includes('achievement-letter')) {
      await kernel.api.closePanel('achievement-letter');
    }
    await expect
      .poll(
        () =>
          document.querySelector<HTMLElement>('.confirm-dialog h2')
            ?.textContent,
      )
      .toContain('新的意见征集');
    expect(document.body.textContent).toContain('运行时新问卷');

    document
      .querySelector<HTMLButtonElement>('.confirm-actions .confirm')
      ?.click();
    await expect
      .poll(() => document.querySelector('[data-caelian-panel="surveys"]'))
      .not.toBeNull();
    await expect
      .poll(() => document.querySelector('.survey-content')?.textContent)
      .toContain('你的意见');

    await kernel.api.shutdown();
    fetchMock.mockRestore();
  });

  it('双击悬浮入口直接打开独立的凯利安状态栏', async () => {
    const databaseName = `caelian-alpha-affinity-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    const kernel = createKernel({
      channel: 'alpha',
      version: '0.2.0-alpha.test',
      buildId: 'affinity-test-build',
      databaseName,
      sourceWindow: window,
    });

    await kernel.initialize();
    const orb = document.querySelector<HTMLButtonElement>('.caelian-shell-host .orb');
    expect(orb).not.toBeNull();

    const activate = () => {
      orb?.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: 100,
        }),
      );
      orb?.dispatchEvent(
        new MouseEvent('pointerup', {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: 100,
        }),
      );
    };

    activate();
    activate();

    await expect
      .poll(() =>
        document.querySelector('[data-caelian-panel="affinity"]'),
      )
      .not.toBeNull();
    expect(
      document.querySelector('[data-caelian-panel="character"]'),
    ).toBeNull();
    expect(document.body.textContent).toContain('凯利安状态栏');

    await kernel.api.shutdown();
  });

  it('悬浮面板允许玩家调整入口顺序并保存在浏览器本地', async () => {
    const databaseName = `caelian-alpha-launcher-order-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    const kernel = createKernel({
      channel: 'alpha',
      version: '0.2.0-alpha.test',
      buildId: 'launcher-order-test-build',
      databaseName,
      sourceWindow: window,
    });

    await kernel.initialize();
    document
      .querySelector<HTMLButtonElement>('.caelian-shell-host .orb')
      ?.click();
    await expect
      .poll(() =>
        document.querySelector<HTMLButtonElement>(
          '.caelian-shell-host .order-trigger',
        ),
      )
      .not.toBeNull();
    document
      .querySelector<HTMLButtonElement>('.caelian-shell-host .order-trigger')
      ?.click();

    await expect
      .poll(() =>
        document.querySelector<HTMLElement>('.order-dialog'),
      )
      .not.toBeNull();
    const orderButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '.order-pick-grid > button',
      ),
    );
    const affinityButton = orderButtons.find(
      (button) => button.textContent?.includes('凯利安'),
    );
    const characterButton = orderButtons.find(
      (button) => button.textContent?.includes('角色'),
    );
    affinityButton?.click();
    characterButton?.click();

    await expect
      .poll(() => affinityButton?.querySelector('i')?.textContent)
      .toContain('1');
    expect(characterButton?.querySelector('i')?.textContent).toContain('2');
    document
      .querySelector<HTMLButtonElement>(
        '.order-dialog-actions .primary',
      )
      ?.click();

    expect(
      JSON.parse(
        localStorage.getItem('caelian_launcher_order_v1') ?? '[]',
      ),
    ).toEqual([
      'affinity',
      'character',
      'deck',
      'card-square',
      'inventory',
      'crafting',
      'guild',
      'mailbox',
      'market',
      'map',
      'worldbook',
      'battle',
      'achievements',
      'settings',
      'feedback',
      'surveys',
      'release-notes',
    ]);

    await kernel.api.shutdown();
  });

  it('初始化本地档案，并按需挂载和卸载独立 Vue 面板', async () => {
    const databaseName = `caelian-alpha-kernel-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    const kernel = createKernel({
      channel: 'alpha',
      version: '0.1.0-alpha.test',
      buildId: 'test-build',
      databaseName,
      sourceWindow: window,
    });

    await kernel.initialize();
    expect(kernel.api.getRuntimeInfo()).toMatchObject({
      status: 'ready',
      databaseName,
    });
    expect(
      document.querySelector('[data-caelian-panel="shell"]'),
    ).not.toBeNull();

    await kernel.api.openPanel('inventory');
    expect(
      document.querySelector('[data-caelian-panel="inventory"]'),
    ).not.toBeNull();

    await kernel.api.closePanel('inventory');
    expect(
      document.querySelector('[data-caelian-panel="inventory"]'),
    ).toBeNull();

    await kernel.api.openPanel('feedback');
    const feedbackHost = document.querySelector(
      '[data-caelian-panel="feedback"]',
    );
    expect(feedbackHost).not.toBeNull();
    feedbackHost?.remove();
    await kernel.api.openPanel('feedback');
    expect(
      document.querySelector('[data-caelian-panel="feedback"]'),
    ).not.toBeNull();
    await kernel.api.closePanel('feedback');

    await kernel.api.shutdown();
    expect(document.querySelector('[data-caelian-panel]')).toBeNull();
  });

  it('玩家面板和凯利安状态栏显示酒馆当前头像', async () => {
    const databaseName = `caelian-alpha-avatars-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    let persona = 'stale-player.png';
    window.SillyTavern = {
      getContext: () => ({
        chatId: 'avatar-test-chat',
        characterId: '0',
        name1: '测试玩家',
        name2: '凯利安',
        characters: [{ name: '凯利安', avatar: 'caelian.png' }],
        chatMetadata: { persona },
        getThumbnailUrl: (type, file) => `/avatars/${type}/${file}`,
      }),
    };
    const kernel = createKernel({
      channel: 'alpha',
      version: '0.2.0-alpha.test',
      buildId: 'avatar-test-build',
      databaseName,
      sourceWindow: window,
    });

    await kernel.initialize();
    await kernel.api.getAvatarUrls();
    persona = 'player.png';
    await kernel.api.openPanel('character');
    await kernel.api.openPanel('affinity');

    await expect
      .poll(
        () =>
          document.querySelector<HTMLImageElement>(
            '[data-caelian-panel="character"] .avatar img',
          )?.src,
      )
      .toBe(
        new URL('/User Avatars/player.png', document.baseURI).href,
      );
    await expect
      .poll(
        () =>
          document.querySelector<HTMLImageElement>(
            '[data-caelian-panel="affinity"] .crest img',
          )?.src,
      )
      .toBe(new URL('/characters/caelian.png', document.baseURI).href);

    const crest = document.querySelector<HTMLElement>(
      '[data-caelian-panel="affinity"] .crest',
    );
    expect(crest).not.toBeNull();
    expect(crest?.classList.contains('adjustable-avatar-host')).toBe(true);
    expect(crest?.querySelector('.adjustable-avatar')).not.toBeNull();
    crest
      ?.querySelector<HTMLButtonElement>('.adjustable-avatar')
      ?.click();
    await expect
      .poll(() => document.querySelector('.avatar-editor'))
      .not.toBeNull();
    expect(
      document.querySelector<HTMLImageElement>(
        '.avatar-source-preview img',
      )?.src,
    ).toBe(new URL('/characters/caelian.png', document.baseURI).href);
    const sourcePreview = document.querySelector<HTMLImageElement>(
      '.avatar-source-preview img',
    );
    expect(sourcePreview?.style.getPropertyValue('object-fit')).toBe(
      'contain',
    );
    const thumbnail = crest?.querySelector<HTMLImageElement>('img');
    const editorInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        '.avatar-editor input[type="range"]',
      ),
    );
    expect(editorInputs).toHaveLength(3);
    const cropPreview = document.querySelector<HTMLElement>(
      '.avatar-preview',
    );
    expect(cropPreview).not.toBeNull();
    if (cropPreview) {
      vi.spyOn(cropPreview, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 200,
        bottom: 200,
        width: 200,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      cropPreview.setPointerCapture = vi.fn();
      cropPreview.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          clientX: 100,
          clientY: 100,
        }),
      );
      cropPreview.dispatchEvent(
        new MouseEvent('pointermove', {
          bubbles: true,
          clientX: 60,
          clientY: 140,
        }),
      );
      cropPreview.dispatchEvent(
        new MouseEvent('pointerup', { bubbles: true }),
      );
    }
    await expect
      .poll(() => ({
        zoom: document
          .querySelector<HTMLImageElement>('.avatar-preview img')
          ?.style.getPropertyValue('--ca-avatar-zoom'),
        position: document
          .querySelector<HTMLImageElement>('.avatar-preview img')
          ?.style.getPropertyValue('--ca-avatar-position'),
      }))
      .toEqual({ zoom: '1', position: '70% 30%' });
    if (editorInputs[1]) {
      editorInputs[1].value = '18';
      editorInputs[1].dispatchEvent(
        new Event('input', { bubbles: true }),
      );
    }
    await expect
      .poll(() => ({
        zoom: document
          .querySelector<HTMLImageElement>('.avatar-preview img')
          ?.style.getPropertyValue('--ca-avatar-zoom'),
        position: document
          .querySelector<HTMLImageElement>('.avatar-preview img')
          ?.style.getPropertyValue('--ca-avatar-position'),
      }))
      .toEqual({ zoom: '1', position: '18% 30%' });
    if (editorInputs[0]) {
      editorInputs[0].value = '1.8';
      editorInputs[0].dispatchEvent(
        new Event('input', { bubbles: true }),
      );
    }
    if (editorInputs[1]) {
      editorInputs[1].value = '24';
      editorInputs[1].dispatchEvent(
        new Event('input', { bubbles: true }),
      );
    }
    if (editorInputs[2]) {
      editorInputs[2].value = '76';
      editorInputs[2].dispatchEvent(
        new Event('input', { bubbles: true }),
      );
    }
    await expect
      .poll(() => ({
        zoom: thumbnail?.style.getPropertyValue('--ca-avatar-zoom'),
        position: thumbnail?.style.getPropertyValue(
          '--ca-avatar-position',
        ),
        previewZoom: document
          .querySelector<HTMLImageElement>('.avatar-preview img')
          ?.style.getPropertyValue('--ca-avatar-zoom'),
      }))
      .toEqual({
        zoom: '1.8',
        position: '24% 76%',
        previewZoom: '1.8',
      });
    document
      .querySelector<HTMLButtonElement>('.avatar-editor footer .primary')
      ?.click();
    await expect
      .poll(() => document.querySelector('.avatar-editor'))
      .toBeNull();
    expect(
      JSON.parse(
        localStorage.getItem(avatarPreferenceKey('caelian')) ?? '{}',
      ),
    ).toEqual({ zoom: 1.8, x: 24, y: 76 });
    expect(
      thumbnail?.style.getPropertyValue('--ca-avatar-position'),
    ).toBe('24% 76%');

    await kernel.api.execute({
      id: 'create-saved-deck-test-adventurer',
      type: 'player.create',
      payload: {
        name: '测试冒险者',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    await kernel.api.openPanel('deck');
    await expect
      .poll(() =>
        Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            '[data-caelian-panel="deck"] button',
          ),
        ).find((button) => button.textContent?.trim() === '创意工坊'),
      )
      .not.toBeUndefined();
    const presetSelect = document.querySelector<HTMLSelectElement>(
      '[data-caelian-panel="deck"] .preset-select select',
    );
    expect(presetSelect?.selectedOptions[0]?.textContent?.trim()).toBe('无');
    const presetNameInput = document.querySelector<HTMLInputElement>(
      '[data-caelian-panel="deck"] .preset-save input',
    );
    if (!presetNameInput) throw new Error('没有找到构筑预设名称输入框');
    presetNameInput.value = '测试构筑预设';
    presetNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-caelian-panel="deck"] button',
      ),
    )
      .find((button) => button.textContent?.trim() === '保存当前构筑')
      ?.click();
    await expect
      .poll(() =>
        document
          .querySelector('[data-caelian-panel="deck"] .preset-notice')
          ?.textContent?.trim(),
      )
      .toContain('已保存构筑');
    await expect
      .poll(() =>
        Array.from(presetSelect?.options ?? []).some((option) =>
          option.textContent?.trim().startsWith('测试构筑预设 · '),
        ),
      )
      .toBe(true);
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-caelian-panel="deck"] button',
      ),
    )
      .find((button) => button.textContent?.trim() === '创意工坊')
      ?.click();
    await expect
      .poll(() => document.querySelector('.workshop-dialog'))
      .not.toBeNull();

    await kernel.api.shutdown();
  });

  it('凯利安头像首次读取为空时会自动重试', async () => {
    const databaseName = `caelian-alpha-avatar-retry-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    let avatarReady = false;
    window.SillyTavern = {
      getContext: () => ({
        chatId: 'avatar-retry-chat',
        characterId: '0',
        name1: '测试玩家',
        name2: '凯利安',
        characters: avatarReady
          ? [{ name: '凯利安', avatar: 'caelian-late.png' }]
          : [],
        getThumbnailUrl: (type, file) => `/avatars/${type}/${file}`,
      }),
    };
    const kernel = createKernel({
      channel: 'alpha',
      version: '0.2.0-alpha.test',
      buildId: 'avatar-retry-test-build',
      databaseName,
      sourceWindow: window,
    });

    await kernel.initialize();
    await kernel.api.openPanel('affinity');
    expect(
      document.querySelector(
        '[data-caelian-panel="affinity"] .crest img',
      ),
    ).toBeNull();

    avatarReady = true;
    await expect
      .poll(
        () =>
          document.querySelector<HTMLImageElement>(
            '[data-caelian-panel="affinity"] .crest img',
          )?.src,
        { timeout: 2_000 },
      )
      .toBe(
        new URL('/characters/caelian-late.png', document.baseURI).href,
      );

    await kernel.api.shutdown();
  });

  it('把旧 MVU 叙事字段迁入本地数据库并回写最小 v3 投影', async () => {
    const databaseName = `caelian-alpha-mvu-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    let mvuData: Record<string, unknown> = {
      stat_data: {
        世界: {
          剧情标记: {
            初次相遇: true,
          },
        },
        凯利安: {
          好感度: 42,
          情绪: '期待',
          当前位置: '伊拉亚城',
          衣着: '学院制服',
          内心想法: '这名冒险者或许值得继续观察。',
        },
        玩家: {
          背包: { 不应进入新投影的药水: 99 },
        },
        协会: {},
        战斗: {},
        pet_system: { keep: true },
      },
    };
    window.Mvu = {
      getMvuData: () => mvuData,
      replaceMvuData: (next) => {
        mvuData = next;
      },
    };
    const kernel = createKernel({
      channel: 'alpha',
      version: '0.2.0-alpha.test',
      buildId: 'mvu-test-build',
      databaseName,
      sourceWindow: window,
    });

    await kernel.initialize();
    const state = await kernel.api.query('state');
    expect(state.social).toMatchObject({
      affinity: 42,
      mood: '期待',
      location: '伊拉亚城',
      clothing: '学院制服',
      innerThought: '这名冒险者或许值得继续观察。',
      relationshipStage: '熟人',
    });
    expect(state.storyFlags).toEqual([
      expect.objectContaining({ key: '初次相遇', value: true }),
    ]);

    const statData = mvuData.stat_data as Record<string, unknown>;
    expect(statData.pet_system).toEqual({ keep: true });
    expect(statData).not.toHaveProperty('世界');
    expect(statData).not.toHaveProperty('凯利安');
    expect(statData).not.toHaveProperty('玩家');
    expect(statData.caelian).toMatchObject({
      _meta: {
        schemaVersion: 3,
        owner: 'caelian-alpha',
      },
      narrative: {
        companion: {
          affinity: 42,
        },
        storyFlags: {
          初次相遇: true,
        },
      },
    });
    expect(JSON.stringify(statData.caelian)).not.toContain(
      '不应进入新投影的药水',
    );

    const inspectionDb = new CaelianDatabase('alpha', databaseName);
    const archived = await inspectionDb.legacySnapshots.toArray();
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({
      profileId: state.profile.id,
      source: 'mvu-before-v3',
    });
    inspectionDb.close();

    await kernel.api.shutdown();
  });

  it('每次打开凯利安状态页时主动读取变量管理器', async () => {
    const databaseName = `caelian-alpha-mvu-on-open-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    let persistedMvuData: Record<string, unknown> = {
      stat_data: {
        caelian: {
          narrative: {
            companion: {
              affinity: 10,
              mood: '平静',
              location: '圣德里安学院',
              clothing: '学院制服',
              innerThought: '先继续观察。',
            },
            world: {
              region: '伊拉亚城',
              place: '宿舍楼',
              location: '圣德里安学院-宿舍楼',
              gameDate: '新圣约历1385-09-01',
              gameTime: '08:00',
              weather: '晴朗',
              mainStage: 0,
              mainStep: 0,
            },
            storyFlags: {},
          },
        },
      },
    };
    const replaceMvuData = vi.fn((next: Record<string, unknown>) => {
      persistedMvuData = next;
    });
    window.Mvu = {
      getMvuData: () => persistedMvuData,
      replaceMvuData,
    };
    const kernel = createKernel({
      channel: 'alpha',
      version: '0.2.0-alpha.test',
      buildId: 'mvu-on-open-test-build',
      databaseName,
      sourceWindow: window,
    });

    await kernel.initialize();
    await kernel.api.openPanel('affinity');
    await expect
      .poll(
        () =>
          document.querySelector(
            '[data-caelian-panel="affinity"]',
          )?.textContent,
      )
      .toContain('先继续观察。');
    const writesBeforeManagerEdit = replaceMvuData.mock.calls.length;
    persistedMvuData = structuredClone(persistedMvuData);
    const directlyEditedCaelian = (
      (persistedMvuData.stat_data as Record<string, unknown>)
        .caelian as Record<string, unknown>
    );
    directlyEditedCaelian.narrative = {
      companion: {
        affinity: 64,
        mood: '变量管理器已保存',
        location: '学院钟楼',
        clothing: '白色暗纹衬衫',
        innerThought: '重新打开状态页后应当显示这一段。',
      },
      world: {
        region: '伊拉亚城',
        place: '学院钟楼',
        location: '圣德里安学院-学院钟楼',
        gameDate: '新圣约历1385-09-03',
        gameTime: '16:20',
        weather: '晚霞',
        mainStage: 1,
        mainStep: 3,
      },
      storyFlags: { 已经出发: true },
    };

    expect(
      document.querySelector(
        '[data-caelian-panel="affinity"]',
      )?.textContent,
    ).not.toContain('重新打开状态页后应当显示这一段。');

    await kernel.api.closePanel('affinity');
    await kernel.api.openPanel('affinity');
    await expect
      .poll(
        () =>
          document.querySelector(
            '[data-caelian-panel="affinity"]',
          )?.textContent,
      )
      .toContain('重新打开状态页后应当显示这一段。');
    const directlyEditedState = await kernel.api.query('state');
    expect(directlyEditedState.social).toMatchObject({
      affinity: 64,
      mood: '变量管理器已保存',
      location: '学院钟楼',
      clothing: '白色暗纹衬衫',
      innerThought: '重新打开状态页后应当显示这一段。',
    });
    expect(directlyEditedState.world).toMatchObject({
      place: '学院钟楼',
      location: '圣德里安学院 · 学院钟楼',
      gameDate: '新圣约历1385-09-03',
      gameTime: '16:20',
      weather: '晚霞',
      mainStage: 0,
      mainStep: 0,
    });
    expect(replaceMvuData).toHaveBeenCalledTimes(
      writesBeforeManagerEdit,
    );

    await kernel.api.shutdown();
  });

  it('已读旧版本后，新版本仍自动打开一次更新公告', async () => {
    const databaseName = `caelian-alpha-release-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    const createReleaseKernel = (version: string) =>
      createKernel({
        channel: 'alpha',
        version,
        buildId: 'release-test-build',
        databaseName,
        sourceWindow: window,
      });

    const firstKernel = createReleaseKernel('0.2.0-alpha.6');
    await firstKernel.initialize();
    expect(
      document.querySelector('[data-caelian-panel="release-notes"]'),
    ).not.toBeNull();
    await firstKernel.api.shutdown();

    const upgradedKernel = createReleaseKernel('0.2.0-alpha.7');
    await upgradedKernel.initialize();
    expect(
      document.querySelector('[data-caelian-panel="release-notes"]'),
    ).not.toBeNull();
    await upgradedKernel.api.shutdown();

    const repeatedKernel = createReleaseKernel('0.2.0-alpha.7');
    await repeatedKernel.initialize();
    expect(
      document.querySelector('[data-caelian-panel="release-notes"]'),
    ).toBeNull();
    expect(repeatedKernel.api.listOpenPanels()).toEqual([
      'shell',
      'achievement-letter',
    ]);
    await repeatedKernel.api.shutdown();
  });

  it('Beta 使用独立运行通道并只展示 Beta 公告', async () => {
    const databaseName = `caelian-beta-release-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    const kernel = createKernel({
      channel: 'beta',
      version: '1.1.0-beta.1',
      buildId: 'beta-release-test-build',
      databaseName,
      sourceWindow: window,
    });

    await kernel.initialize();
    expect(kernel.api.channel).toBe('beta');
    expect(kernel.api.getRuntimeInfo()).toMatchObject({
      channel: 'beta',
      version: '1.1.0-beta.1',
      databaseName,
    });
    const announcement = document.querySelector(
      '[data-caelian-panel="release-notes"]',
    );
    expect(announcement?.textContent).toContain('Beta 1.1');
    expect(announcement?.textContent).toContain('完整合成台');
    expect(announcement?.textContent).not.toContain('Alpha 30');
    await kernel.api.shutdown();
  });

  it('只有剧情触发的战斗会在结算后写入聊天框', async () => {
    const databaseName = `caelian-alpha-story-battle-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    const textarea = document.createElement('textarea');
    textarea.id = 'send_textarea';
    document.body.appendChild(textarea);
    const kernel = createKernel({
      channel: 'alpha',
      version: '0.2.0-alpha.test',
      buildId: 'story-battle-source-test-build',
      databaseName,
      sourceWindow: window,
    });
    const database = new CaelianDatabase('alpha', databaseName);

    const endBattleInStorage = async (battleId: string) => {
      const session = await database.battleSessions.get(battleId);
      if (!session) throw new Error('测试战斗不存在');
      session.state.status = 'surrendered';
      session.state.phase = 'ended';
      session.phase = 'ended';
      await database.battleSessions.put(session);
    };

    try {
      await kernel.initialize();
      await kernel.api.execute({
        id: 'create-story-battle-source-adventurer',
        type: 'player.create',
        payload: {
          name: '测试冒险者',
          classMain: 'knight',
          subclass: 'holy_knight',
        },
      });
      await database.open();

      await kernel.api.execute({
        id: 'start-local-battle-source-test',
        type: 'battle.start',
        payload: { monsterId: 'mon_slime', source: '玩家本地遭遇' },
      });
      let battle = (await kernel.api.query('state')).battle;
      expect(battle?.storyTriggered).toBe(false);
      await endBattleInStorage(battle!.id);
      await kernel.api.execute({
        id: 'finish-local-battle-source-test',
        type: 'battle.finish',
        payload: { battleId: battle!.id },
      });
      expect(textarea.value).toBe('');

      await kernel.api.execute({
        id: 'start-story-battle-source-test',
        type: 'battle.start',
        payload: {
          monsterId: 'mon_slime',
          source: '剧情中的史莱姆伏击',
          storyTriggered: true,
        },
      });
      battle = (await kernel.api.query('state')).battle;
      expect(battle?.storyTriggered).toBe(true);
      await endBattleInStorage(battle!.id);
      await kernel.api.execute({
        id: 'finish-story-battle-source-test',
        type: 'battle.finish',
        payload: { battleId: battle!.id },
      });
      expect(textarea.value).toContain('<BattleResult>');
      expect(textarea.value).toContain('source: 剧情中的史莱姆伏击');
    } finally {
      database.close();
      textarea.remove();
      await kernel.api.shutdown();
    }
  });

  it('战斗状态栏显示职业资源，主动弃牌后本回合禁用按钮', async () => {
    const databaseName = `caelian-alpha-profession-status-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    const kernel = createKernel({
      channel: 'alpha',
      version: '0.2.0-alpha.test',
      buildId: 'profession-status-test-build',
      databaseName,
      sourceWindow: window,
    });

    await kernel.initialize();
    await kernel.api.execute({
      id: 'create-profession-status-adventurer',
      type: 'player.create',
      payload: {
        name: '回声测试员',
        classMain: 'mage',
        subclass: 'dark_mage',
      },
    });
    await kernel.api.execute({
      id: 'start-profession-status-battle',
      type: 'battle.start',
      payload: { monsterId: 'mon_slime', count: 1 },
    });
    const persistedDatabase = new CaelianDatabase('alpha', databaseName);
    await persistedDatabase.open();
    try {
      const activeBattle = (await kernel.api.query('state')).battle;
      const session = await persistedDatabase.battleSessions.get(activeBattle!.id);
      if (!session) throw new Error('职业资源测试战斗不存在');
      session.state.player.classResources = {
        abyss_echo: 2,
        future_flux: 7,
      };
      await persistedDatabase.battleSessions.put(session);
    } finally {
      persistedDatabase.close();
    }
    await kernel.api.navigatePanel('battle');

    await expect
      .poll(
        () =>
          document.querySelector<HTMLElement>('.profession-status')
            ?.textContent,
      )
      .toContain('深渊回声 · 2');
    const professionStatuses = [
      ...document.querySelectorAll<HTMLElement>('.profession-status'),
    ].map((entry) => entry.textContent ?? '');
    expect(professionStatuses).toContainEqual(expect.stringContaining('future flux · 7'));
    expect(
      professionStatuses.filter((entry) => entry.includes('深渊回声')),
    ).toHaveLength(1);

    await persistedDatabase.open();
    try {
      const activeBattle = (await kernel.api.query('state')).battle;
      const session = await persistedDatabase.battleSessions.get(activeBattle!.id);
      if (!session) throw new Error('职业资源测试战斗不存在');
      session.state.player.subclass = 'holy_knight';
      session.state.player.classResources = {
        holy_sigil: 1,
        abyss_echo: 2,
        hunter_prepare: 3,
        future_flux: 7,
      };
      await persistedDatabase.battleSessions.put(session);
    } finally {
      persistedDatabase.close();
    }
    await kernel.api.navigatePanel('character');
    await kernel.api.navigatePanel('battle');
    await expect
      .poll(() =>
        [...document.querySelectorAll<HTMLElement>('.profession-status')].map(
          (entry) => entry.textContent ?? '',
        ),
      )
      .toContainEqual(expect.stringContaining('圣印 · 1'));
    const switchedStatuses = [
      ...document.querySelectorAll<HTMLElement>('.profession-status'),
    ].map((entry) => entry.textContent ?? '');
    expect(switchedStatuses).toContainEqual(
      expect.stringContaining('future flux · 7'),
    );
    expect(switchedStatuses.some((entry) => entry.includes('深渊回声'))).toBe(
      false,
    );
    expect(
      switchedStatuses.some(
        (entry) =>
          entry.includes('猎杀准备') || entry.includes('hunter prepare'),
      ),
    ).toBe(false);

    const discardButton = document.querySelector<HTMLButtonElement>(
      '.hand-actions .discard',
    );
    expect(discardButton?.disabled).toBe(false);
    discardButton?.click();
    await expect
      .poll(
        () =>
          document.querySelector<HTMLButtonElement>('.hand-actions .discard')
            ?.textContent,
      )
      .toContain('本回合已弃牌');
    expect(
      document.querySelector<HTMLButtonElement>('.hand-actions .discard')
        ?.disabled,
    ).toBe(true);

    await kernel.api.shutdown();
  });

  it('学院魔像战只由任务按钮启动并在关闭终局面板后推进结算', async () => {
    const databaseName = `caelian-alpha-academy-golem-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    const handlers = new Map<unknown, (...args: unknown[]) => void>();
    window.eventOn = vi.fn((event, handler) => {
      handlers.set(event, handler);
      return { stop: () => handlers.delete(event) };
    });
    window.tavern_events = {
      MESSAGE_RECEIVED: 'message-received',
      CHARACTER_MESSAGE_RENDERED: 'character-message-rendered',
      GENERATION_ENDED: 'generation-ended',
    };
    const chat = [
      { mes: '广场上的教学魔像出现异动。', is_user: true },
      {
        mes: '<BattleStart boss_academy_arcane_golem|1|周年庆预演事故>',
        is_user: false,
      },
    ];
    window.SillyTavern = {
      getContext: () => ({
        chatId: 'academy-golem-test-chat',
        name1: '测试冒险者',
        chat,
        setExtensionPrompt: vi.fn(),
      }),
    };
    const kernel = createKernel({
      channel: 'alpha',
      version: '0.2.0-alpha.test',
      buildId: 'academy-golem-test-build',
      databaseName,
      sourceWindow: window,
    });
    const database = new CaelianDatabase('alpha', databaseName);

    try {
      await kernel.initialize();
      await kernel.api.execute({
        id: 'create-academy-golem-adventurer',
        type: 'player.create',
        payload: {
          name: '测试冒险者',
          classMain: 'knight',
          subclass: 'holy_knight',
        },
      });
      await kernel.api.execute({
        id: 'move-to-academy-golem-test',
        type: 'narrative.update',
        payload: {
          world: {
            region: '圣德里安学院',
            place: '无为广场',
            location: '圣德里安学院-无为广场',
          },
        },
      });
      await kernel.api.acceptManagedQuest(academyQuest.id);
      await database.open();
      const tracker = await database.questTrackerStates
        .where('profileId')
        .equals(kernel.api.getRuntimeInfo().profileId!)
        .first();
      if (!tracker) throw new Error('学院主线追踪记录不存在');
      const setQuestNode = async (nodeId: string) => {
        const node = academyQuest.nodes.find((entry) => entry.id === nodeId);
        if (!node) throw new Error(`学院主线节点不存在：${nodeId}`);
        const current = {
          ...initialQuestProgress(academyQuest),
          status: node.status,
          trackerState: node.status === 'active' ? ('tracking' as const) : ('ended' as const),
          currentStage: node.stage,
          currentNodeId: node.id,
          currentStageId: node.stageId,
          currentSceneId: node.sceneId,
          currentBeatId: node.id,
          objective: node.objective,
          summary: '',
          completionConfirmed: node.status === 'ready',
        };
        await database.questTrackerStates.update(tracker.id, { current });
        await database.questRecords.update(tracker.questId, {
          status: node.status,
          currentStage: node.stage,
          objective: node.objective,
          updatedAt: Date.now(),
        });
      };

      await setQuestNode('academy-preboss-deck');
      handlers.get('message-received')?.(1);
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      expect((await kernel.api.query('state')).battle).toBeNull();

      await setQuestNode('academy-defeat-golem');
      await kernel.api.navigatePanel('guild');
      expect(kernel.api.listOpenPanels()).toContain('guild');
      await kernel.api.performTrackedQuestAction();
      const started = (await kernel.api.query('state')).battle;
      expect(started).toMatchObject({
        relatedQuestId: tracker.questId,
        state: {
          status: 'ongoing',
          enemies: [
            expect.objectContaining({
              definitionId: 'boss_academy_arcane_golem',
            }),
          ],
        },
      });
      expect(kernel.api.listOpenPanels()).toContain('battle');
      expect(kernel.api.listOpenPanels()).not.toContain('guild');

      await kernel.api.closePanel('battle');
      expect((await kernel.api.query('state')).battle?.id).toBe(started?.id);
      await kernel.api.navigatePanel('guild');
      await kernel.api.performTrackedQuestAction();
      expect((await kernel.api.query('state')).battle?.id).toBe(started?.id);
      expect(kernel.api.listOpenPanels()).toContain('battle');
      expect(kernel.api.listOpenPanels()).not.toContain('guild');

      const session = await database.battleSessions.get(started!.id);
      if (!session) throw new Error('学院魔像战斗记录不存在');
      session.state.status = 'victory';
      session.state.phase = 'ended';
      session.phase = 'ended';
      await database.battleSessions.put(session);
      await kernel.api.closePanel('battle');

      await expect
        .poll(async () => (await kernel.api.query('state')).battle)
        .toBeNull();
      await expect
        .poll(
          async () =>
            (await kernel.api.getTrackedQuest())?.tracker.current.currentNodeId,
        )
        .toBe('academy-anniversary-settlement');
      const completed = await kernel.api.getTrackedQuest();
      expect(completed).toMatchObject({
        quest: { status: 'ready' },
        tracker: {
          current: { status: 'ready', completionConfirmed: true },
        },
      });
      expect(
        await database.specialCollectibles
          .where('profileId')
          .equals(tracker.profileId)
          .count(),
      ).toBe(1);
      expect(
        (await kernel.api.query('state')).achievements.find(
          (entry) => entry.achievementId === 'ach_main_academy_anniversary',
        ),
      ).toMatchObject({ unlocked: true });
    } finally {
      database.close();
      await kernel.api.shutdown();
    }
  });

  it('设置面板可拉取模型并由玩家选择判定模型', async () => {
    const databaseName = `caelian-alpha-judge-settings-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    const fetchMock = vi.spyOn(window, 'fetch').mockImplementation(
      async (input) =>
        String(input) === 'https://judge.example/v1/models'
          ? new Response(
              JSON.stringify({
                data: [{ id: 'judge-small' }, { id: 'judge-large' }],
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            )
          : new Response(null, { status: 404 }),
    );
    const kernel = createKernel({
      channel: 'alpha',
      version: '0.2.0-alpha.test',
      buildId: 'judge-settings-test-build',
      databaseName,
      sourceWindow: window,
    });
    const setInput = (input: HTMLInputElement, value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    await kernel.initialize();
    await kernel.api.openPanel('settings');
    await expect
      .poll(() =>
        document.querySelector<HTMLInputElement>(
          '[data-caelian-panel="settings"] input[placeholder*="chat/completions"]',
        ),
      )
      .not.toBeNull();
    const panel = document.querySelector<HTMLElement>(
      '[data-caelian-panel="settings"]',
    );
    const endpoint = panel?.querySelector<HTMLInputElement>(
      'input[placeholder*="chat/completions"]',
    );
    const apiKey = panel?.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    expect(endpoint).not.toBeNull();
    expect(apiKey).not.toBeNull();
    setInput(endpoint!, 'https://judge.example/v1/chat/completions');
    setInput(apiKey!, 'settings-session-secret');
    Array.from(panel?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => button.textContent?.trim() === '拉取模型')
      ?.click();

    await expect
      .poll(
        () =>
          panel?.querySelectorAll<HTMLOptionElement>(
            'select[aria-label="拉取到的模型列表"] option:not([value=""])',
          ).length,
      )
      .toBe(2);
    const model = panel?.querySelector<HTMLInputElement>(
      'input[placeholder="也可以手动填写模型名称"]',
    );
    expect(model).not.toBeNull();
    setInput(model!, 'judge-large');
    Array.from(panel?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find(
        (button) =>
          button.textContent?.trim() === '应用副 API 配置',
      )
      ?.click();

    await expect
      .poll(() => kernel.api.getQuestJudgeStatus())
      .toMatchObject({
        configured: true,
        endpoint: 'https://judge.example/v1/chat/completions',
        model: 'judge-large',
        apiKeyPresent: true,
      });
    expect(
      localStorage.getItem('caelian_quest_judge_preferences_v1'),
    ).toContain('settings-session-secret');
    expect(
      sessionStorage.getItem('caelian_quest_judge_api_key_session_v1'),
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://judge.example/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );

    await kernel.api.shutdown();
    fetchMock.mockRestore();
  });

  it('从内置目录接取地区任务并控制任务追踪提示', async () => {
    const databaseName = `caelian-alpha-quest-runtime-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    const setExtensionPrompt = vi.fn();
    window.SillyTavern = {
      getContext: () => ({
        chatId: 'quest-runtime-chat',
        name1: '测试冒险者',
        chat: [],
        setExtensionPrompt,
      }),
    };
    const textarea = document.createElement('textarea');
    textarea.id = 'send_textarea';
    document.body.appendChild(textarea);
    const kernel = createKernel({
      channel: 'alpha',
      version: '0.2.0-alpha.test',
      buildId: 'quest-runtime-test-build',
      databaseName,
      sourceWindow: window,
    });

    await kernel.initialize();
    await kernel.api.execute({
      id: 'create-quest-test-adventurer',
      type: 'player.create',
      payload: {
        name: '测试冒险者',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    await expect(kernel.api.listAvailableQuests()).resolves.toEqual([
      expect.objectContaining({
        id: 'side_flora_says',
        name: '芙萝拉说',
        region: '伊拉亚城',
      }),
    ]);

    await kernel.api.openPanel('guild');
    const guildPanel = document.querySelector<HTMLElement>(
      '[data-caelian-panel="guild"]',
    );
    await expect
      .poll(() => guildPanel?.textContent)
      .toContain('委托告示板');
    Array.from(guildPanel?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => button.textContent?.trim() === '委托告示板')
      ?.click();
    await expect
      .poll(() => guildPanel?.textContent)
      .toContain('当前地区剧情任务');
    expect(guildPanel?.textContent).toContain('芙萝拉说');
    await kernel.api.execute({
      id: 'move-to-academy-board-test',
      type: 'narrative.update',
      payload: {
        world: {
          region: '圣德里安学院',
          place: '任务大厅',
          location: '圣德里安学院-任务大厅',
        },
      },
    });
    await expect
      .poll(() => guildPanel?.textContent)
      .toContain('圣德里安周年庆筹备日');
    await kernel.api.execute({
      id: 'return-to-ilaya-board-test',
      type: 'narrative.update',
      payload: {
        world: {
          region: '伊拉亚城',
          place: '冒险者协会总部',
          location: '伊拉亚城-冒险者协会总部',
        },
      },
    });
    await expect
      .poll(() => guildPanel?.textContent)
      .toContain('芙萝拉说');
    Array.from(guildPanel?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => button.textContent?.trim() === '接取剧情任务')
      ?.click();
    await expect
      .poll(async () => kernel.api.getTrackedQuest())
      .not.toBeNull();
    const accepted = await kernel.api.getTrackedQuest();
    expect(accepted).toMatchObject({
      quest: { definitionId: 'side_flora_says', status: 'active' },
      tracker: {
        selected: true,
        current: { trackerState: 'armed' },
      },
    });
    expect(textarea.value).toContain('前往中央商业区');
    await expect
      .poll(() => document.body.textContent)
      .toContain('剧情推进器尚未启用');
    await expect
      .poll(() => guildPanel?.textContent)
      .toContain('取消追踪');
    expect(setExtensionPrompt.mock.calls.at(-1)?.[1]).toContain(
      '[凯利安任务导航｜芙萝拉说]',
    );

    await kernel.api.pauseTrackedQuest();
    expect(setExtensionPrompt.mock.calls.at(-1)?.[1]).toBe('');
    await kernel.api.resumeTrackedQuest();
    expect(setExtensionPrompt.mock.calls.at(-1)?.[1]).toContain(
      '[凯利安任务导航｜芙萝拉说]',
    );

    kernel.api.configureQuestJudge({
      endpoint: 'https://judge.example/v1/chat/completions',
      model: 'judge-model',
      apiKey: 'runtime-only-secret',
    });
    expect(kernel.api.getQuestJudgeStatus()).toMatchObject({
      configured: true,
      endpoint: 'https://judge.example/v1/chat/completions',
      model: 'judge-model',
      apiKeyPresent: true,
    });

    await kernel.api.shutdown();
    textarea.remove();
  });

  it('只在生成完成后判定，并在删除楼层时保留已确认节点', async () => {
    const databaseName = `caelian-alpha-quest-floor-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    const handlers = new Map<unknown, (...args: unknown[]) => void>();
    window.eventOn = vi.fn((event, handler) => {
      handlers.set(event, handler);
      return { stop: () => handlers.delete(event) };
    });
    window.tavern_events = {
      MESSAGE_RECEIVED: 'message-received',
      CHARACTER_MESSAGE_RENDERED: 'character-message-rendered',
      GENERATION_ENDED: 'generation-ended',
      MESSAGE_DELETED: 'message-deleted',
    };
    const chat: Array<{
      mes: string;
      is_user: boolean;
    }> = [];
    const textarea = document.createElement('textarea');
    textarea.id = 'send_textarea';
    document.body.appendChild(textarea);
    const setExtensionPrompt = vi.fn();
    window.SillyTavern = {
      getContext: () => ({
        chatId: 'quest-floor-chat',
        name1: '测试冒险者',
        chat,
        setExtensionPrompt,
      }),
    };
    let mvuData: Record<string, unknown> = {
      stat_data: {
        caelian: {
          narrative: {
            world: {
              region: '伊拉亚城',
              place: '中央商业区',
              location: '伊拉亚城-中央商业区',
              gameDate: '新圣约历1385-09-01',
              gameTime: '10:00',
              weather: '晴朗',
              mainStage: 0,
              mainStep: 0,
            },
          },
        },
      },
    };
    window.Mvu = {
      getMvuData: () => mvuData,
      replaceMvuData: (next) => {
        mvuData = next;
      },
    };
    const judgeResult = {
      sceneState: 'in_scene',
      progress: 'transition',
      completionGateSatisfied: true,
      matchedTransitionId: 'advance-flora-encounter',
      suggestedNodeId: 'flora-selling-flowers',
      confidence: 0.96,
      evidence: ['玩家明确答应，并和芙萝拉准备前往城郊。'],
      summary: '花已经卖完，玩家答应陪芙萝拉去采花。',
    };
    const fetchMock = vi.spyOn(window, 'fetch').mockImplementation(
      async (input) => {
        if (String(input).includes('judge.example')) {
          await new Promise((resolve) => window.setTimeout(resolve, 120));
          return new Response(
              JSON.stringify({
                choices: [
                  { message: { content: JSON.stringify(judgeResult) } },
                ],
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            );
        }
        return new Response(null, { status: 404 });
      },
    );
    const kernel = createKernel({
      channel: 'alpha',
      version: '0.2.0-alpha.test',
      buildId: 'quest-floor-test-build',
      databaseName,
      sourceWindow: window,
    });

    await kernel.initialize();
    await kernel.api.execute({
      id: 'create-quest-floor-adventurer',
      type: 'player.create',
      payload: {
        name: '测试冒险者',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    kernel.api.configureQuestJudge({
      endpoint: 'https://judge.example/v1/chat/completions',
      model: 'judge-model',
    });
    chat.push({
      mes: '当前没有追踪任务，这条消息不应触发副 API。',
      is_user: false,
    });
    handlers.get('generation-ended')?.(0);
    await new Promise((resolve) => window.setTimeout(resolve, 160));
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('judge.example'),
      ),
    ).toHaveLength(0);
    chat.splice(0);
    await kernel.api.acceptManagedQuest('side_flora_says');
    chat.push(
      { mes: '好，我陪你去采花。', is_user: true },
      { mes: '芙萝拉开心地点头，收好花篮准备出发。', is_user: false },
    );
    handlers.get('character-message-rendered')?.(1);
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('judge.example'),
      ),
    ).toHaveLength(0);
    handlers.get('generation-ended')?.(1);

    await expect
      .poll(() => document.body.textContent, { timeout: 3000 })
      .toContain('正在推进剧情');

    await expect
      .poll(
        async () =>
          (await kernel.api.getTrackedQuest())?.tracker.current.currentNodeId,
        { timeout: 3000 },
      )
      .toBe('flora-selling-flowers');
    await expect
      .poll(
        () =>
          document.querySelector<HTMLElement>(
            '[data-caelian-quest-guidance]',
          )?.textContent,
        { timeout: 3000 },
      )
      .toContain('允许买花、吆喝、介绍花束或陪伴等方式帮她卖完');
    document
      .querySelector<HTMLButtonElement>('.quest-guidance footer button')
      ?.click();
    expect(textarea.value).toContain('我选择继续推进任务「芙萝拉说」');
    expect(textarea.value).toContain('不要开始后续节点');

    chat.splice(1, 1);
    handlers.get('message-deleted')?.(1);
    await expect
      .poll(
        async () =>
          (await kernel.api.getTrackedQuest())?.tracker.current.currentNodeId,
        { timeout: 3000 },
      )
      .toBe('flora-selling-flowers');

    await kernel.api.pauseTrackedQuest();
    chat.push({
      mes: '这条新消息不应触发已经取消追踪的副 API。',
      is_user: false,
    });
    handlers.get('generation-ended')?.(2);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('judge.example'),
      ),
    ).toHaveLength(1);

    await kernel.api.shutdown();
    fetchMock.mockRestore();
    textarea.remove();
  });
});
