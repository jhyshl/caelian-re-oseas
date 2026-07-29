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
    expect(receiver.content).not.toMatch(/127\.0\.0\.1|localhost/);
    expect(receiver.info).toContain('备用公网 CDN');
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
});
