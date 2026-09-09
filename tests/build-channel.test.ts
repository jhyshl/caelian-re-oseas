// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const tempRoot = path.resolve(tmpdir());
let fixture: string;

function write(relative: string, contents: string) {
  const target = path.join(fixture, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function run(channel = 'alpha', environment: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['scripts/build-channel.mjs', channel], {
    cwd: fixture,
    encoding: 'utf8',
    env: { ...process.env, CAELIAN_VERSION: '', CAELIAN_BETA_RELEASE: '', CAELIAN_BUILD_ID: 'new-release', ...environment },
  });
}

function prepareNewBuild(message: string) {
  execFileSync('git', [
    '-c', 'user.name=Release test', '-c', 'user.email=release-test@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', message,
  ], { cwd: fixture });
  write('node_modules/vite/bin/vite.js', `import { writeFileSync } from 'node:fs';
writeFileSync('built.json', JSON.stringify({ version: process.env.CAELIAN_VERSION, buildId: process.env.CAELIAN_BUILD_ID }));`);
  for (const name of ['package-build', 'export-tavern-helper', 'prepare-sites-build']) write(`scripts/${name}.mjs`, '');
}

describe('channel publication preservation', () => {
  beforeEach(() => {
    fixture = mkdtempSync(path.join(tempRoot, 'caelian-release-'));
    write('package.json', '{"type":"module","version":"0.2.0-alpha.39"}');
    write('config/release-channels.json', '{"beta":{"version":"1.17.0-beta.1"}}');
    mkdirSync(path.join(fixture, 'scripts'));
    copyFileSync(path.resolve('scripts/build-channel.mjs'), path.join(fixture, 'scripts/build-channel.mjs'));
    execFileSync('git', ['init', '--quiet'], { cwd: fixture });
    execFileSync('git', [
      '-c', 'user.name=Release test', '-c', 'user.email=release-test@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty',
      '-m', 'Release Beta [release-beta] [preserve-alpha]',
    ], { cwd: fixture });
    write('dist/channels/alpha.json', JSON.stringify({
      channel: 'alpha',
      version: '0.2.0-alpha.71',
      buildId: 'existing-alpha',
      modules: { runtime: {
        url: 'https://example.invalid/game/builds/existing-alpha/assets/alpha.js',
        css: [{ url: 'https://example.invalid/game/builds/existing-alpha/assets/style.css' }],
      } },
    }));
    write('dist/builds/existing-alpha/index.html', '<html>Alpha 71</html>');
    write('dist/builds/existing-alpha/assets/alpha.js', 'window.alpha = 71;');
    write('dist/builds/existing-alpha/assets/style.css', 'body { color: red; }');
  });

  afterEach(() => {
    const resolved = path.resolve(fixture);
    if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('caelian-release-')) {
      throw new Error('Refusing to remove an unexpected fixture path.');
    }
    rmSync(resolved, { recursive: true, force: true });
  });

  it('retains the original Alpha manifest and bytes without invoking a new build', () => {
    const manifest = readFileSync(path.join(fixture, 'dist/channels/alpha.json'), 'utf8');
    const runtime = readFileSync(path.join(fixture, 'dist/builds/existing-alpha/assets/alpha.js'), 'utf8');
    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Preserved Alpha 0.2.0-alpha.71 (existing-alpha)');
    expect(readFileSync(path.join(fixture, 'dist/channels/alpha.json'), 'utf8')).toBe(manifest);
    expect(readFileSync(path.join(fixture, 'dist/builds/existing-alpha/assets/alpha.js'), 'utf8')).toBe(runtime);
  });

  it('fails publication when restored Alpha assets are incomplete', () => {
    rmSync(path.join(fixture, 'dist/builds/existing-alpha/assets/alpha.js'));
    const result = run();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ENOENT');
  });

  it('continues to require authorization for a Beta build', () => {
    const result = run('beta');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('CAELIAN_BETA_RELEASE=1');
  });

  it('publishes new Alpha assets under the existing version for keep-version hotfixes', () => {
    prepareNewBuild('Publish hotfix [release-beta] [keep-version]');
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(path.join(fixture, 'built.json'), 'utf8'))).toEqual({ version: '0.2.0-alpha.71', buildId: 'new-release' });
    expect(result.stdout).toContain('Built alpha 0.2.0-alpha.71');
  });

  it('does not guess an older package version when the restored manifest is missing', () => {
    prepareNewBuild('Publish hotfix [keep-version]');
    rmSync(path.join(fixture, 'dist/channels/alpha.json'));
    expect(run().status).not.toBe(0);
  });

  it('rejects an invalid restored version instead of silently incrementing', () => {
    prepareNewBuild('Publish hotfix [keep-version]');
    write('dist/channels/alpha.json', '{"channel":"alpha","version":"invalid"}');
    expect(run().stderr).toContain('Cannot keep Alpha version');
  });

  it('keeps normal Alpha version increments without the hotfix marker', () => {
    prepareNewBuild('Normal Alpha release');
    expect(run().status).toBe(0);
    expect(JSON.parse(readFileSync(path.join(fixture, 'built.json'), 'utf8')).version).toBe('0.2.0-alpha.72');
  });

  it('keeps the configured Beta version and creates a new Beta build', () => {
    prepareNewBuild('Publish hotfix [release-beta] [keep-version]');
    const result = run('beta', { CAELIAN_BETA_RELEASE: '1' });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(path.join(fixture, 'built.json'), 'utf8'))).toEqual({ version: '1.17.0-beta.1', buildId: 'new-release-beta' });
  });
});
