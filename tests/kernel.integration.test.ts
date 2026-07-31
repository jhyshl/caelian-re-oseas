import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernel } from '@/kernel/create-kernel';
import { CaelianDatabase } from '@/storage/database';
import { avatarPreferenceKey } from '@/ui/avatar-preferences';

const databaseNames: string[] = [];

afterEach(async () => {
  delete window.__CaelianRuntime;
  delete window.Mvu;
  delete window.SillyTavern;
  delete window.eventOn;
  delete window.tavern_events;
  localStorage.removeItem('caelian_launcher_order_v1');
  localStorage.removeItem(avatarPreferenceKey('caelian'));
  localStorage.removeItem(avatarPreferenceKey('player'));
  document
    .querySelectorAll('[data-caelian-panel]')
    .forEach((element) => element.remove());
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)));
});

describe('CaelianKernel integration', () => {
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
      'inventory',
      'guild',
      'mailbox',
      'market',
      'map',
      'battle',
      'achievements',
      'settings',
      'feedback',
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
      location: '圣德里安学院-学院钟楼',
      gameDate: '新圣约历1385-09-03',
      gameTime: '16:20',
      weather: '晚霞',
      mainStage: 1,
      mainStep: 3,
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
});
