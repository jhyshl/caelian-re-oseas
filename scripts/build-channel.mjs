import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const channel = process.argv[2] ?? 'alpha';
if (!['alpha', 'beta'].includes(channel)) {
  throw new Error(`Unsupported release channel: ${channel}`);
}
if (channel === 'beta' && process.env.CAELIAN_BETA_RELEASE !== '1') {
  throw new Error(
    'Beta builds require explicit approval (CAELIAN_BETA_RELEASE=1).',
  );
}

const packageJson = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8'),
);
const channelConfig = JSON.parse(
  readFileSync(path.join(root, 'config', 'release-channels.json'), 'utf8'),
);

function gitBuildId() {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  return dirty ? `${sha}-dirty` : sha;
}

function preserveAlphaVersionForCommit() {
  try {
    return execFileSync('git', ['log', '-1', '--pretty=%B'], {
      cwd: root,
      encoding: 'utf8',
    }).includes('[preserve-alpha]');
  } catch {
    return false;
  }
}

function alphaNumber(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)-alpha\.(\d+)$/);
  return match
    ? {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        sequence: Number(match[4]),
      }
    : null;
}

function nextAlphaVersion(buildId) {
  const fallback = String(packageJson.version);
  try {
    const previous = JSON.parse(
      readFileSync(path.join(root, 'dist', 'channels', 'alpha.json'), 'utf8'),
    );
    if (previous.buildId === buildId && alphaNumber(previous.version)) {
      return previous.version;
    }
    if (preserveAlphaVersionForCommit() && alphaNumber(previous.version)) {
      return previous.version;
    }
    const current = alphaNumber(previous.version) ?? alphaNumber(fallback);
    if (!current) return fallback;
    return `${current.major}.${current.minor}.${current.patch}-alpha.${current.sequence + 1}`;
  } catch {
    return fallback;
  }
}

const baseBuildId = process.env.CAELIAN_BUILD_ID || gitBuildId();
const buildId =
  channel === 'beta' && !baseBuildId.endsWith('-beta')
    ? `${baseBuildId}-beta`
    : baseBuildId;
const version =
  process.env.CAELIAN_VERSION ||
  (channel === 'beta'
    ? String(channelConfig.beta.version)
    : nextAlphaVersion(buildId));
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const environment = {
  ...process.env,
  CAELIAN_CHANNEL: channel,
  CAELIAN_VERSION: version,
  CAELIAN_BUILD_ID: buildId,
};

for (const [command, args] of [
  [npmExecutable, ['exec', '--', 'vite', 'build']],
  [process.execPath, ['scripts/package-build.mjs']],
  [process.execPath, ['scripts/export-tavern-helper.mjs']],
  [process.execPath, ['scripts/prepare-sites-build.mjs']],
]) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: environment,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Built ${channel} ${version} (${buildId})`);
