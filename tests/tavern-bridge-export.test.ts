import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
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
});
