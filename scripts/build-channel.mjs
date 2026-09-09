import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
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

function commitHasMarker(marker) {
  try {
    return execFileSync('git', ['log', '-1', '--pretty=%B'], {
      cwd: root,
      encoding: 'utf8',
    }).includes(marker);
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
  // A hotfix can publish new immutable assets without changing the user-facing
  // version. Unlike preserve-alpha, this still runs the complete Alpha build.
  if (commitHasMarker('[keep-version]')) {
    const previous = JSON.parse(
      readFileSync(path.join(root, 'dist', 'channels', 'alpha.json'), 'utf8'),
    );
    if (previous.channel !== 'alpha' || !alphaNumber(previous.version)) {
      throw new Error('Cannot keep Alpha version: the restored manifest is invalid.');
    }
    return previous.version;
  }
  try {
    const previous = JSON.parse(
      readFileSync(path.join(root, 'dist', 'channels', 'alpha.json'), 'utf8'),
    );
    if (previous.buildId === buildId && alphaNumber(previous.version)) {
      return previous.version;
    }
    const current = alphaNumber(previous.version) ?? alphaNumber(fallback);
    if (!current) return fallback;
    return `${current.major}.${current.minor}.${current.patch}-alpha.${current.sequence + 1}`;
  } catch {
    return fallback;
  }
}

// A Beta-only publication must retain the deployed Alpha manifest and assets,
// not produce different bytes under the same Alpha version.
if (channel === 'alpha' && commitHasMarker('[preserve-alpha]')) {
  const previous = JSON.parse(
    readFileSync(path.join(root, 'dist', 'channels', 'alpha.json'), 'utf8'),
  );
  if (
    previous.channel !== 'alpha' ||
    !alphaNumber(previous.version) ||
    !/^[a-zA-Z0-9._-]+$/.test(previous.buildId ?? '') ||
    !previous.modules?.runtime?.css?.length
  ) {
    throw new Error('Cannot preserve Alpha: the restored manifest is invalid.');
  }
  const buildRoot = path.join(root, 'dist', 'builds', previous.buildId);
  const files = [path.join(buildRoot, 'index.html')];
  const runtime = previous.modules.runtime;
  for (const asset of [runtime, ...runtime.css]) {
    const assetPath = new URL(asset.url).pathname;
    const prefix = '/builds/' + previous.buildId + '/';
    const start = assetPath.indexOf(prefix);
    if (start < 0) {
      throw new Error('Cannot preserve Alpha: an asset references another build.');
    }
    const localPath = path.resolve(buildRoot, assetPath.slice(start + prefix.length));
    if (!localPath.startsWith(buildRoot + path.sep)) {
      throw new Error('Cannot preserve Alpha: an asset path is outside its build.');
    }
    files.push(localPath);
  }
  for (const file of files) {
    const info = statSync(file);
    if (!info.isFile() || !info.size) {
      throw new Error('Cannot preserve Alpha: a restored artifact is missing or empty.');
    }
  }
  console.log('Preserved Alpha ' + previous.version + ' (' + previous.buildId + ')');
  process.exit(0);
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

function assertCurrentReleaseNote(releaseChannel, releaseVersion) {
  if (process.env.CAELIAN_REQUIRE_RELEASE_NOTE !== '1') return;
  if (process.env.CAELIAN_ALLOW_MISSING_RELEASE_NOTE === '1') {
    console.warn(
      `Skipping ${releaseChannel} release-note validation for ${releaseVersion}.`,
    );
    return;
  }

  const releaseNotes = readFileSync(
    path.join(root, 'src', 'content', 'release-notes.ts'),
    'utf8',
  );
  const collectionName =
    releaseChannel === 'beta' ? 'BETA_RELEASE_NOTES' : 'ALPHA_RELEASE_NOTES';
  const collectionStart = releaseNotes.indexOf(
    `export const ${collectionName}`,
  );
  const collectionEnd =
    collectionStart < 0
      ? -1
      : releaseNotes.indexOf('] as const;', collectionStart);
  const firstEntry =
    collectionStart < 0 || collectionEnd < 0
      ? null
      : releaseNotes
          .slice(collectionStart, collectionEnd)
          .match(/version:\s*['\"]([^'\"]+)['\"]/);
  const firstVersion = firstEntry?.[1] ?? null;
  if (firstVersion !== releaseVersion) {
    throw new Error(
      `The first ${releaseChannel} release note is ${firstVersion ?? 'missing'}, but the publishing build is ${releaseVersion}. Add the exact version as the newest entry before publishing.`,
    );
  }
}

assertCurrentReleaseNote(channel, version);

const environment = {
  ...process.env,
  CAELIAN_CHANNEL: channel,
  CAELIAN_VERSION: version,
  CAELIAN_BUILD_ID: buildId,
};

for (const [command, args] of [
  [process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']],
  [process.execPath, ['scripts/package-build.mjs']],
  [process.execPath, ['scripts/export-tavern-helper.mjs']],
  [process.execPath, ['scripts/prepare-sites-build.mjs']],
]) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Built ${channel} ${version} (${buildId})`);
