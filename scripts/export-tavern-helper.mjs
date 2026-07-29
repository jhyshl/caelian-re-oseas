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
const proxyBase = (
  process.env.CAELIAN_PROXY_BASE ??
  'https://tlsdyacdkbcjxbwvyeim.supabase.co/functions/v1/caelian-release-proxy'
).replace(/\/+$/, '');
const sitesBase = (
  process.env.CAELIAN_SITES_BASE ??
  'https://caelian-re-oseas-alpha.jianghailou7.chatgpt.site'
).replace(/\/+$/, '');
const manifestUrl = `${publicBase}/channels/alpha.json`;
const manifestSources = [
  {
    name: 'GitHub Pages',
    url: manifestUrl,
  },
  {
    name: 'Sites CDN',
    url: `${sitesBase}/channels/alpha.json`,
  },
  {
    name: 'Supabase CDN',
    url: `${proxyBase}/channels/alpha.json`,
  },
];
const allowedBases = [
  `${publicBase}/`,
  `${sitesBase}/`,
  `${proxyBase}/`,
];

const bridge = `// Re∞：欧西亚斯固定 Alpha Bridge
// 每次启动读取 Alpha manifest；主线路不可达时自动切换独立公网镜像。
(async function loadCaelianAlpha() {
  'use strict';

  const root = (() => {
    try {
      return window.parent && window.parent.document ? window.parent : window;
    } catch {
      return window;
    }
  })();
  const manifestSources = ${JSON.stringify(manifestSources, null, 2)};
  const allowedBases = ${JSON.stringify(allowedBases)};
  const cacheKey = 'caelian:bridge:last-manifest:alpha';
  const previousCacheKey = 'caelian:bridge:previous-manifest:alpha';
  const notify = (level, message) => {
    try {
      root.toastr?.[level]?.(message, 'Re∞：欧西亚斯 Alpha');
    } catch {}
  };

  const isAllowedUrl = (value) =>
    typeof value === 'string' &&
    allowedBases.some((base) => value.startsWith(base));

  const validate = (manifest) => {
    const runtime = manifest?.modules?.runtime;
    const styles = Array.isArray(runtime?.css) ? runtime.css : [];
    if (
      manifest?.channel !== 'alpha' ||
      manifest?.bridgeApi !== 1 ||
      typeof manifest?.buildId !== 'string' ||
      !isAllowedUrl(runtime?.url) ||
      styles.some((style) => !isAllowedUrl(style?.url))
    ) {
      throw new Error('Alpha manifest 格式或来源不合法');
    }
    return manifest;
  };

  const fetchManifest = async (source) => {
    const separator = source.url.includes('?') ? '&' : '?';
    const response = await fetch(
      source.url + separator + 'caelian-manifest=' + Date.now(),
      {
        cache: 'no-store',
        credentials: 'omit',
      },
    );
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
      if (!isAllowedUrl(style?.url)) continue;
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
  const sourceErrors = [];
  let requested = null;
  let requestedSourceIndex = -1;

  for (let index = 0; index < manifestSources.length; index += 1) {
    const source = manifestSources[index];
    try {
      requested = await fetchManifest(source);
      requestedSourceIndex = index;
      break;
    } catch (error) {
      sourceErrors.push(source.name + ': ' + String(error));
    }
  }

  if (!requested) {
    if (!cachedGood) {
      throw new Error(
        '无法取得 Alpha 更新清单：' + sourceErrors.join('；'),
      );
    }
    requested = cachedGood;
    notify('warning', '更新线路暂时不可用，已加载上一次成功构建。');
  } else if (requestedSourceIndex > 0) {
    notify('warning', '主更新线路不可达，已自动切换备用公网 CDN。');
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

    for (let index = 0; index < manifestSources.length; index += 1) {
      if (index === requestedSourceIndex) continue;
      try {
        const alternate = await fetchManifest(manifestSources[index]);
        if (
          alternate.modules.runtime.url !== requested.modules.runtime.url
        ) {
          recoveryCandidates.push(alternate);
        }
      } catch {}
    }

    if (
      cachedGood &&
      cachedGood.modules.runtime.url !== requested.modules.runtime.url
    ) {
      recoveryCandidates.push(cachedGood);
    }
    if (
      cachedPrevious &&
      cachedPrevious.modules.runtime.url !== requested.modules.runtime.url
    ) {
      recoveryCandidates.push(cachedPrevious);
    }
    if (isAllowedUrl(requested.previous?.url)) {
      try {
        const publishedPrevious = await fetchManifest({
          name: 'previous',
          url: requested.previous.url,
        });
        if (
          publishedPrevious.modules.runtime.url !==
          requested.modules.runtime.url
        ) {
          recoveryCandidates.push(publishedPrevious);
        }
      } catch {}
    }

    const attempted = new Set();
    for (const fallback of recoveryCandidates) {
      const runtimeUrl = fallback.modules.runtime.url;
      if (attempted.has(runtimeUrl)) continue;
      attempted.add(runtimeUrl);
      try {
        await activate(fallback, true);
        if (fallback.buildId === requested.buildId) {
          writeCached(cacheKey, fallback);
          notify('warning', '主线路加载失败，已从备用公网 CDN 加载当前版本。');
        } else {
          writeCached(cacheKey, fallback);
          notify(
            'warning',
            'Alpha 更新失败，已自动回退到 ' + fallback.version +
              '（' + fallback.buildId.slice(0, 8) + '）',
          );
        }
        return;
      } catch {}
    }
    throw new Error(
      'Alpha 更新失败且无法切换备用线路：' +
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
  info: '固定读取公网 Alpha 通道；主线路不可达时自动切换备用公网 CDN。',
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
      manifestSources,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
