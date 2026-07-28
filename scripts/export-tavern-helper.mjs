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
  const previousCacheKey = 'caelian:bridge:previous-manifest:alpha';
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

  const fetchManifest = async (url) => {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return validate(await response.json());
  };

  const readCached = (key) => {
    try {
      return validate(JSON.parse(root.localStorage.getItem(key) || 'null'));
    } catch {
      return null;
    }
  };

  const writeCached = (key, manifest) => {
    try {
      root.localStorage.setItem(key, JSON.stringify(manifest));
    } catch {}
  };

  const installStyles = async (manifest) => {
    const installed = [];
    for (const style of manifest.modules.runtime.css || []) {
      if (!style?.url || !style.url.startsWith(allowedBase)) continue;
      const existing = root.document.querySelector(
        'link[data-caelian-style="' + style.url + '"]',
      );
      if (existing) continue;

      const link = root.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = style.url;
      link.dataset.caelianStyle = style.url;
      link.dataset.caelianBuild = manifest.buildId;
      if (style.integrity) {
        link.integrity = style.integrity;
        link.crossOrigin = 'anonymous';
      }
      await new Promise((resolve, reject) => {
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener(
          'error',
          () => reject(new Error('样式加载失败：' + style.url)),
          { once: true },
        );
        root.document.head.appendChild(link);
      });
      installed.push(link);
    }
    return installed;
  };

  const activate = async (manifest, recovery = false) => {
    if (root.Caelian?.buildId === manifest.buildId) return;
    const installedStyles = await installStyles(manifest);
    try {
      const runtimeUrl = recovery
        ? manifest.modules.runtime.url +
          (manifest.modules.runtime.url.includes('?') ? '&' : '?') +
          'caelian-recovery=' + Date.now()
        : manifest.modules.runtime.url;
      const runtimeModule = await import(runtimeUrl);
      if (typeof runtimeModule.bootstrapCaelian === 'function') {
        await runtimeModule.bootstrapCaelian();
      }
      if (root.Caelian?.buildId !== manifest.buildId) {
        throw new Error('运行时构建与 Alpha manifest 不一致');
      }
      for (const oldStyle of root.document.querySelectorAll(
        'link[data-caelian-build]',
      )) {
        if (oldStyle.dataset.caelianBuild !== manifest.buildId) oldStyle.remove();
      }
    } catch (error) {
      for (const style of installedStyles) style.remove();
      throw error;
    }
  };

  const cachedGood = readCached(cacheKey);
  const cachedPrevious = readCached(previousCacheKey);
  let requested;
  try {
    requested = await fetchManifest(manifestUrl);
  } catch (error) {
    if (!cachedGood) {
      throw new Error('无法取得 Alpha 更新清单：' + String(error));
    }
    requested = cachedGood;
    notify('warning', 'Alpha 更新清单暂时不可用，已加载上一次成功构建。');
  }

  if (root.Caelian?.buildId === requested.buildId) {
    writeCached(cacheKey, requested);
    return;
  }

  try {
    await activate(requested);
    if (cachedGood && cachedGood.buildId !== requested.buildId) {
      writeCached(previousCacheKey, cachedGood);
    }
    writeCached(cacheKey, requested);
    notify('success', 'Alpha ' + requested.version + ' 已加载');
    return;
  } catch (updateError) {
    const recoveryCandidates = [];
    if (cachedGood && cachedGood.buildId !== requested.buildId) {
      recoveryCandidates.push(cachedGood);
    }
    if (cachedPrevious && cachedPrevious.buildId !== requested.buildId) {
      recoveryCandidates.push(cachedPrevious);
    }
    if (requested.previous?.url?.startsWith(allowedBase)) {
      try {
        const publishedPrevious = await fetchManifest(requested.previous.url);
        if (publishedPrevious.buildId !== requested.buildId) {
          recoveryCandidates.push(publishedPrevious);
        }
      } catch {}
    }

    const attempted = new Set();
    for (const fallback of recoveryCandidates) {
      if (attempted.has(fallback.buildId)) continue;
      attempted.add(fallback.buildId);
      try {
        await activate(fallback, true);
        writeCached(cacheKey, fallback);
        notify(
          'warning',
          'Alpha 更新失败，已自动回退到 ' + fallback.version +
            '（' + fallback.buildId.slice(0, 8) + '）',
        );
        return;
      } catch {}
    }
    throw new Error(
      'Alpha 更新失败且无法恢复上一个版本：' +
        (updateError instanceof Error ? updateError.message : String(updateError)),
    );
  }
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

const standaloneScript = {
  type: 'script',
  enabled: true,
  name: 'Re∞：欧西亚斯Alpha',
  id: 'f56df46e-b198-4d84-9e94-269079a31e17',
  content: bridge,
  info: '固定读取公网 Alpha 通道；发布新版本后，各终端会在下次加载时自动更新。',
  button: {
    enabled: true,
    buttons: [],
  },
  data: {},
  export_with: {
    data: true,
    button: true,
  },
};

await mkdir(path.join(distRoot, 'tavern-helper'), { recursive: true });
await writeFile(
  path.join(distRoot, 'tavern-helper', 'caelian-alpha.json'),
  `${JSON.stringify(folder, null, 2)}\n`,
  'utf8',
);

await writeFile(
  path.join(distRoot, 'tavern-helper', 'caelian-alpha-script.json'),
  `${JSON.stringify(standaloneScript, null, 2)}\n`,
  'utf8',
);

await writeFile(
  path.join(distRoot, 'tavern-helper', 'caelian-alpha-bridge.js'),
  `${bridge}\n`,
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
