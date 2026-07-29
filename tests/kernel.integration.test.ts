import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { createKernel } from '@/kernel/create-kernel';

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

    const firstKernel = createReleaseKernel('0.2.0-alpha.5');
    await firstKernel.initialize();
    expect(
      document.querySelector('[data-caelian-panel="release-notes"]'),
    ).not.toBeNull();
    await firstKernel.api.shutdown();

    const upgradedKernel = createReleaseKernel('0.2.0-alpha.6');
    await upgradedKernel.initialize();
    expect(
      document.querySelector('[data-caelian-panel="release-notes"]'),
    ).not.toBeNull();
    await upgradedKernel.api.shutdown();

    const repeatedKernel = createReleaseKernel('0.2.0-alpha.6');
    await repeatedKernel.initialize();
    expect(
      document.querySelector('[data-caelian-panel="release-notes"]'),
    ).toBeNull();
    expect(repeatedKernel.api.listOpenPanels()).toEqual(['shell']);
    await repeatedKernel.api.shutdown();
  });
});
