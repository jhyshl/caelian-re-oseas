import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(root, 'dist');
const packageJson = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8'),
);
const publicBase = (
  process.env.CAELIAN_PUBLIC_BASE ??
  'https://jhyshl.github.io/caelian-re-oseas'
).replace(/\/+$/, '');
const manifestUrl = `${publicBase}/channels/alpha.json`;

const bridge = `// Re∞：欧西亚斯固定 Alpha Bridge
// 这个接入口不包含业务版本号；每次启动都从 Alpha manifest 解析当前构建。
(async function loadCaelianAlpha() {
  'use strict';

  const root = (() => {
    try {
      return window.parent && window.parent.document ? window.parent : window;
    } catch {
      return window;
    }
  })();
  const manifestUrl = ${JSON.stringify(manifestUrl)};
  const allowedBase = ${JSON.stringify(`${publicBase}/`)};
  const cacheKey = 'caelian:bridge:last-manifest:alpha';
  const notify = (level, message) => {
    try {
      root.toastr?.[level]?.(message, 'Re∞：欧西亚斯 Alpha');
    } catch {}
  };

  const validate = (manifest) => {
    const runtime = manifest?.modules?.runtime;
    if (
      manifest?.channel !== 'alpha' ||
      manifest?.bridgeApi !== 1 ||
      typeof manifest?.buildId !== 'string' ||
      typeof runtime?.url !== 'string' ||
      !runtime.url.startsWith(allowedBase)
    ) {
      throw new Error('Alpha manifest 格式或来源不合法');
    }
    return manifest;
  };

  let manifest;
  try {
    const response = await fetch(manifestUrl, {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    manifest = validate(await response.json());
    try {
      root.localStorage.setItem(cacheKey, JSON.stringify(manifest));
    } catch {}
  } catch (error) {
    try {
      manifest = validate(JSON.parse(root.localStorage.getItem(cacheKey) || 'null'));
      notify('warning', 'Alpha 更新清单暂时不可用，已加载上一次成功构建。');
    } catch {
      throw new Error('无法取得 Alpha 更新清单：' + String(error));
    }
  }

  if (root.Caelian?.buildId === manifest.buildId) return;
  if (typeof root.Caelian?.shutdown === 'function') {
    await root.Caelian.shutdown();
  }

  for (const style of manifest.modules.runtime.css || []) {
    if (!style?.url || !style.url.startsWith(allowedBase)) continue;
    if (root.document.querySelector('link[data-caelian-style="' + style.url + '"]')) {
      continue;
    }
    const link = root.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = style.url;
    link.dataset.caelianStyle = style.url;
    if (style.integrity) {
      link.integrity = style.integrity;
      link.crossOrigin = 'anonymous';
    }
    root.document.head.appendChild(link);
  }

  await import(manifest.modules.runtime.url);
  if (root.Caelian?.buildId !== manifest.buildId) {
    throw new Error('运行时构建与 Alpha manifest 不一致');
  }
  notify('success', 'Alpha ' + manifest.version + ' 已加载');
})().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const root = window.parent || window;
    root.toastr?.error?.(message, 'Re∞：欧西亚斯 Alpha');
  } catch {}
  console.error('[Caelian Alpha Bridge]', error);
});`;

const folder = {
  type: 'folder',
  enabled: true,
  name: 'Re∞：欧西亚斯 Alpha 接入口',
  id: '51e90831-e25a-4afe-b6c6-c3187dd53dc9',
  icon: 'fa-infinity',
  color: 'rgba(104, 81, 145, 1)',
  scripts: [
    {
      type: 'script',
      enabled: true,
      name: 'Re∞：欧西亚斯 Alpha Bridge',
      id: '11dc566b-8d62-4892-912d-b9f5b25df1b0',
      content: bridge,
    },
  ],
};

await mkdir(path.join(distRoot, 'tavern-helper'), { recursive: true });
await writeFile(
  path.join(distRoot, 'tavern-helper', 'caelian-alpha.json'),
  `${JSON.stringify(folder, null, 2)}\n`,
  'utf8',
);

await writeFile(
  path.join(distRoot, 'tavern-helper', 'bridge-meta.json'),
  `${JSON.stringify(
    {
      channel: 'alpha',
      bridgeApi: 1,
      packageVersion: packageJson.version,
      manifestUrl,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
