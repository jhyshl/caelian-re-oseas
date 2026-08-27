import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

describe('Tavern Helper Alpha bridge export', () => {
  it('exports a lightweight Tail Town theme entitlement without local image assets', async () => {
    await execFileAsync(process.execPath, ['scripts/export-tavern-helper.mjs'], {
      cwd: root,
    });
    const reward = JSON.parse(
      await readFile(
        path.join(
          root,
          'dist',
          'tavern-helper',
          'caelian-tail-town-theme.json',
        ),
        'utf8',
      ),
    ) as { name: string; content: string; info: string };
    const events: string[] = [];
    class TestCustomEvent {
      constructor(
        readonly type: string,
        readonly init?: { detail?: unknown },
      ) {}
    }
    const host = {
      document: {},
      dispatchEvent: (event: TestCustomEvent) => {
        events.push(event.type);
        return true;
      },
      CustomEvent: TestCustomEvent,
    } as Record<string, unknown>;
    host.parent = host;
    host.top = host;

    vm.runInNewContext(reward.content, { window: host, Set, Array });

    expect(reward.name).toContain('尾巴镇专属奖励');
    expect(reward.content).not.toMatch(/data:image|localStorage|indexedDB/i);
    expect(reward.content).not.toMatch(/\.(png|webp|jpe?g)/i);
    expect(reward.info).toContain('线上构建加载');
    expect(host.__CaelianThemeEntitlements).toEqual({
      version: 1,
      ids: ['tail-town-dog'],
    });
    expect(events).toEqual(['caelian:theme-entitlements-changed']);
  });

  it('exports a valid receiver with independent public update sources', async () => {
    await execFileAsync(process.execPath, ['scripts/export-tavern-helper.mjs'], {
      cwd: root,
    });

    const receiver = JSON.parse(
      await readFile(
        path.join(
          root,
          'dist',
          'tavern-helper',
          'caelian-alpha-script.json',
        ),
        'utf8',
      ),
    ) as {
      content: string;
      info: string;
    };

    expect(receiver.content).toContain(
      'https://jhyshl.github.io/caelian-re-oseas/channels/alpha.json',
    );
    expect(receiver.content).toContain(
      'https://tlsdyacdkbcjxbwvyeim.supabase.co/functions/v1/caelian-release-proxy/channels/alpha.json',
    );
    expect(receiver.content).toContain(
      'https://caelian-re-oseas-alpha.jianghailou7.chatgpt.site/channels/alpha.json',
    );
    expect(receiver.content).toContain(
      '主更新线路不可达，已自动切换备用公网 CDN',
    );
    expect(receiver.content).toContain('__CaelianAlphaUpdateWatcher');
    expect(receiver.content).toContain('发现新版本');
    expect(receiver.content).toContain('2 小时后提醒');
    expect(receiver.content).toContain('战斗结束后自动更新');
    expect(receiver.content).toContain("root.location.reload()");
    expect(receiver.content).toContain('更新完成，正在刷新酒馆');
    expect(receiver.content).toContain(
      '自动刷新酒馆失败，请手动刷新页面以加载最新内容',
    );
    expect(receiver.content).not.toMatch(/127\.0\.0\.1|localhost/);
    expect(receiver.info).toContain('备用公网 CDN');
  });

  it('exports an independent Beta receiver without overwriting Alpha', async () => {
    await execFileAsync(process.execPath, ['scripts/export-tavern-helper.mjs'], {
      cwd: root,
      env: {
        ...process.env,
        CAELIAN_CHANNEL: 'beta',
        CAELIAN_VERSION: '1.1.0-beta.1',
      },
    });

    const betaReceiver = JSON.parse(
      await readFile(
        path.join(
          root,
          'dist',
          'tavern-helper',
          'caelian-beta-script.json',
        ),
        'utf8',
      ),
    ) as { content: string; info: string };
    const alphaReceiver = JSON.parse(
      await readFile(
        path.join(
          root,
          'dist',
          'tavern-helper',
          'caelian-alpha-script.json',
        ),
        'utf8',
      ),
    ) as { content: string };

    expect(betaReceiver.content).toContain('/channels/beta.json');
    expect(betaReceiver.content).toContain("manifest?.channel !== 'beta'");
    expect(betaReceiver.content).toContain('__CaelianBetaUpdateWatcher');
    expect(betaReceiver.content).toContain(
      "'Beta ' + candidate.version + ' 更新完成",
    );
    expect(betaReceiver.content).not.toContain('/channels/alpha.json');
    expect(betaReceiver.info).toContain('Beta 通道');
    expect(alphaReceiver.content).toContain('/channels/alpha.json');
  });

  it('switches away from GitHub when WebKit reports Load failed', async () => {
    const receiver = JSON.parse(
      await readFile(
        path.join(
          root,
          'dist',
          'tavern-helper',
          'caelian-alpha-script.json',
        ),
        'utf8',
      ),
    ) as { content: string };
    const requests: string[] = [];
    const warnings: string[] = [];
    const storage = new Map<string, string>();
    const document = {};
    const host = {
      document,
      Caelian: { buildId: 'mirror-test-build' },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
      toastr: {
        warning: (message: string) => warnings.push(message),
      },
    } as Record<string, unknown>;
    host.parent = host;

    const execution = vm.runInNewContext(receiver.content, {
      window: host,
      console,
      Date,
      JSON,
      Promise,
      Set,
      TypeError,
      fetch: async (url: string) => {
        requests.push(url);
        if (url.startsWith('https://jhyshl.github.io/')) {
          throw new TypeError('Load failed');
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            channel: 'alpha',
            version: '0.2.0-alpha.test',
            buildId: 'mirror-test-build',
            bridgeApi: 1,
            modules: {
              runtime: {
                url: 'https://caelian-re-oseas-alpha.jianghailou7.chatgpt.site/builds/mirror-test-build/assets/alpha.js',
                css: [],
              },
            },
          }),
        };
      },
    }) as Promise<void>;

    await execution;

    expect(requests).toHaveLength(2);
    expect(requests[0]).toContain('jhyshl.github.io');
    expect(requests[1]).toContain('jianghailou7.chatgpt.site');
    expect(warnings).toContain(
      '主更新线路不可达，已自动切换备用公网 CDN。',
    );
  });

  it('checks for a newer build, prompts once, and defers refresh during battle', async () => {
    const receiver = JSON.parse(
      await readFile(
        path.join(
          root,
          'dist',
          'tavern-helper',
          'caelian-alpha-script.json',
        ),
        'utf8',
      ),
    ) as { content: string };
    const storage = new Map<string, string>();
    const scheduled: number[] = [];
    const stateListeners: Array<() => void> = [];
    const notifications: Array<{
      title: string;
      description?: string;
      onClick?: () => Promise<void>;
    }> = [];
    let requestCount = 0;
    const currentManifest = {
      channel: 'alpha',
      version: '0.2.0-alpha.current',
      buildId: 'current-build',
      bridgeApi: 1,
      modules: {
        runtime: {
          url: 'https://jhyshl.github.io/caelian-re-oseas/builds/current-build/assets/alpha.js',
          css: [],
        },
      },
    };
    const nextManifest = {
      ...currentManifest,
      version: '0.2.0-alpha.next',
      buildId: 'next-build',
      modules: {
        runtime: {
          url: 'https://jhyshl.github.io/caelian-re-oseas/builds/next-build/assets/alpha.js',
          css: [],
        },
      },
    };
    const host = {
      document: {},
      Caelian: {
        buildId: currentManifest.buildId,
        notify: (input: (typeof notifications)[number]) => {
          notifications.push(input);
        },
        query: async () => ({
          battle: { state: { status: 'ongoing' } },
        }),
        on: (_event: string, handler: () => void) => {
          stateListeners.push(handler);
          return () => undefined;
        },
      },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
      setTimeout: (_callback: () => void, delay: number) => {
        scheduled.push(delay);
        return scheduled.length;
      },
      clearTimeout: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as Record<string, unknown>;
    host.parent = host;

    await (vm.runInNewContext(receiver.content, {
      window: host,
      console,
      Date,
      JSON,
      Number,
      Promise,
      Set,
      TypeError,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () =>
          requestCount++ === 0 ? currentManifest : nextManifest,
      }),
    }) as Promise<void>);

    const watcher = host.__CaelianAlphaUpdateWatcher as {
      checkIntervalMs: number;
      checkNow: () => Promise<void>;
    };
    expect(watcher.checkIntervalMs).toBe(10 * 60 * 1000);
    expect(scheduled).toContain(10 * 60 * 1000);

    await watcher.checkNow();

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.title).toBe(
      '发现新版本 0.2.0-alpha.next',
    );
    expect(notifications[0]?.description).toContain('自动刷新酒馆');
    expect(typeof notifications[0]?.onClick).toBe('function');
    expect(host.Caelian).toMatchObject({ buildId: 'current-build' });

    await watcher.checkNow();
    expect(notifications).toHaveLength(1);
    expect(
      JSON.parse(
        storage.get('caelian:bridge:update-reminder:alpha') ?? '{}',
      ),
    ).toMatchObject({
      buildId: 'next-build',
      ignored: false,
    });

    await notifications[0]?.onClick?.();
    expect(stateListeners).toHaveLength(1);
    expect(notifications[1]?.description).toContain(
      '战斗结束后自动更新',
    );
  });
});
