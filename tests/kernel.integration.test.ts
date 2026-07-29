import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { createKernel } from '@/kernel/create-kernel';
import { CaelianDatabase } from '@/storage/database';

const databaseNames: string[] = [];

afterEach(async () => {
  delete window.__CaelianRuntime;
  delete window.Mvu;
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
    expect(repeatedKernel.api.listOpenPanels()).toEqual(['shell']);
    await repeatedKernel.api.shutdown();
  });
});
