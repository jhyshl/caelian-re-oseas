import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp, mkdir, readFile, rm, stat, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildRoot = path.join(root, '.build');
const distRoot = path.join(root, 'dist');
const packageJson = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8'),
);
const publicBase = (
  process.env.CAELIAN_PUBLIC_BASE ??
  'https://jhyshl.github.io/caelian-re-oseas'
).replace(/\/+$/, '');
const managedContentManifest = JSON.parse(
  await readFile(
    path.join(root, 'public', 'managed-content', 'alpha.json'),
    'utf8',
  ),
);

function resolveBuildId() {
  if (process.env.CAELIAN_BUILD_ID) return process.env.CAELIAN_BUILD_ID;
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return `local-${packageJson.version}`;
  }
}

async function sri(relativePath) {
  const bytes = await readFile(path.join(buildRoot, relativePath));
  return `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
}

await stat(path.join(buildRoot, '.vite', 'manifest.json'));
const viteManifest = JSON.parse(
  await readFile(path.join(buildRoot, '.vite', 'manifest.json'), 'utf8'),
);
const alphaKey = Object.keys(viteManifest).find((key) =>
  key.endsWith('src/bridge/alpha-entry.ts'),
);

if (!alphaKey) {
  throw new Error('Vite manifest does not contain the Alpha runtime entry.');
}

const alphaEntry = viteManifest[alphaKey];
const buildId = resolveBuildId().replace(/[^a-zA-Z0-9._-]/g, '-');
const immutableRoot = path.join(distRoot, 'builds', buildId);

let previousChannelManifest = null;
const isPublishableBuildId = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  !value.endsWith('-dirty') &&
  !value.startsWith('local-');
const rebaseManifest = (manifest) => {
  const rebaseUrl = (value) => {
    if (typeof value !== 'string') return value;
    const buildPath = value.match(/\/builds\/[^/]+\/.+$/)?.[0];
    return buildPath ? `${publicBase}${buildPath}` : value;
  };
  const { previous: _discardedPrevious, ...singlePrevious } = manifest;
  return {
    ...singlePrevious,
    modules: {
      ...manifest.modules,
      runtime: {
        ...manifest.modules?.runtime,
        url: rebaseUrl(manifest.modules?.runtime?.url),
        css: (manifest.modules?.runtime?.css ?? []).map((style) => ({
          ...style,
          url: rebaseUrl(style.url),
        })),
      },
    },
  };
};
try {
  const previous = JSON.parse(
    await readFile(path.join(distRoot, 'channels', 'alpha.json'), 'utf8'),
  );
  const previousBuildRoot = path.join(
    distRoot,
    'builds',
    String(previous.buildId ?? ''),
  );
  await stat(previousBuildRoot);
  if (
    isPublishableBuildId(previous.buildId) &&
    previous.buildId !== buildId
  ) {
    previousChannelManifest = rebaseManifest(previous);
  } else if (previous.buildId === buildId) {
    const archived = JSON.parse(
      await readFile(
        path.join(distRoot, 'channels', 'alpha.previous.json'),
        'utf8',
      ),
    );
    const archivedBuildRoot = path.join(
      distRoot,
      'builds',
      String(archived.buildId ?? ''),
    );
    await stat(archivedBuildRoot);
    if (
      isPublishableBuildId(archived.buildId) &&
      archived.buildId !== buildId
    ) {
      previousChannelManifest = rebaseManifest(archived);
    }
  }
} catch {
  // A clean checkout has no previous deployment to retain.
}

/*
 * Builds are immutable and must survive subsequent channel publications.
 * Removing all of dist made a manifest rollback point at files that no longer
 * existed. Replace only a same-id local rebuild and keep every other build.
 */
await mkdir(path.join(distRoot, 'builds'), { recursive: true });
await rm(immutableRoot, { recursive: true, force: true });
await mkdir(immutableRoot, { recursive: true });
await cp(buildRoot, immutableRoot, { recursive: true });
await rm(path.join(immutableRoot, '.vite'), { recursive: true, force: true });

const cssFiles = [
  ...new Set(
    [
      ...(alphaEntry.css ?? []),
      viteManifest['style.css']?.file,
    ].filter((file) => typeof file === 'string' && file.endsWith('.css')),
  ),
];

if (cssFiles.length === 0) {
  throw new Error(
    'Alpha runtime does not expose a host stylesheet for the Tavern bridge.',
  );
}

const css = await Promise.all(
  cssFiles.map(async (file) => ({
    url: `${publicBase}/builds/${buildId}/${file}`,
    integrity: await sri(file),
  })),
);

const channelManifest = {
  channel: 'alpha',
  version: packageJson.version,
  buildId,
  bridgeApi: 1,
  schemaVersion: 1,
  publishedAt: new Date().toISOString(),
  modules: {
    runtime: {
      url: `${publicBase}/builds/${buildId}/${alphaEntry.file}`,
      integrity: await sri(alphaEntry.file),
      css,
    },
  },
  managedContent: {
    url: `${publicBase}/managed-content/alpha.json`,
    revision: managedContentManifest.revision,
    sourceCard: {
      ...managedContentManifest.sourceCard,
      url: `${publicBase}/managed-content/cards/caelian-alpha-mvu-v3.json`,
    },
  },
  ...(previousChannelManifest
    ? {
        previous: {
          buildId: previousChannelManifest.buildId,
          version: previousChannelManifest.version,
          url: `${publicBase}/channels/alpha.previous.json`,
        },
      }
    : {}),
};

await mkdir(path.join(distRoot, 'channels'), { recursive: true });
await rm(path.join(distRoot, 'managed-content'), {
  recursive: true,
  force: true,
});
await cp(
  path.join(root, 'public', 'managed-content'),
  path.join(distRoot, 'managed-content'),
  { recursive: true },
);
if (previousChannelManifest) {
  await writeFile(
    path.join(distRoot, 'channels', 'alpha.previous.json'),
    `${JSON.stringify(previousChannelManifest, null, 2)}\n`,
    'utf8',
  );
}
await writeFile(
  path.join(distRoot, 'channels', 'alpha.json'),
  `${JSON.stringify(channelManifest, null, 2)}\n`,
  'utf8',
);

const statusPage = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Re∞：欧西亚斯 Alpha</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#100d18;color:#f8f4ff;font:16px/1.65 system-ui,sans-serif}
    main{width:min(720px,calc(100% - 48px));padding:40px;border:1px solid #6f5c91;border-radius:24px;background:#191326}
    a{color:#d5b6ff}code{color:#f3d6ff}
  </style>
</head>
<body>
  <main>
    <p>ALPHA CHANNEL</p>
    <h1>Re∞：欧西亚斯</h1>
    <p>当前版本：<code>${packageJson.version}</code></p>
    <p>构建：<code>${buildId}</code></p>
    <p><a href="./channels/alpha.json">Alpha manifest</a> · <a href="./managed-content/cards/caelian-alpha-mvu-v3.json">最新版角色卡</a> · <a href="./builds/${buildId}/index.html">浏览器演示</a> · <a href="./tavern-helper/caelian-alpha.json">酒馆助手接入口</a></p>
  </main>
</body>
</html>
`;

await writeFile(path.join(distRoot, 'index.html'), statusPage, 'utf8');
