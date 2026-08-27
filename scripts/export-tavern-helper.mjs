import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(root, 'dist');
const packageJson = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8'),
);
const channel = process.env.CAELIAN_CHANNEL === 'beta' ? 'beta' : 'alpha';
const channelLabel = channel === 'beta' ? 'Beta' : 'Alpha';
const releaseVersion = process.env.CAELIAN_VERSION ?? packageJson.version;
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
const manifestUrl = `${publicBase}/channels/${channel}.json`;
const manifestSources = [
  {
    name: 'GitHub Pages',
    url: manifestUrl,
  },
  {
    name: 'Sites CDN',
    url: `${sitesBase}/channels/${channel}.json`,
  },
  {
    name: 'Supabase CDN',
    url: `${proxyBase}/channels/${channel}.json`,
  },
];
const allowedBases = [
  `${publicBase}/`,
  `${sitesBase}/`,
  `${proxyBase}/`,
];

const bridge = `// Re∞：欧西亚斯固定 Alpha Bridge
// 启动后持续检查 Alpha manifest；发现新版本时提醒玩家，验证更新成功后自动刷新酒馆。
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
  const reminderKey = 'caelian:bridge:update-reminder:alpha';
  const watcherKey = '__CaelianAlphaUpdateWatcher';
  const previousWatcher = root[watcherKey];
  const showBridgeToast = (level, message) => {
    const d = root.document;
    if (!d || typeof d.createElement !== 'function' || !d.body) return false;
    const styleId = 'caelian-bridge-toast-style-v2';
    if (!d.getElementById?.(styleId)) {
      const style = d.createElement('style');
      style.id = styleId;
      style.textContent = '.caelian-bridge-toast-host{position:fixed;z-index:2147483647;top:max(12px,env(safe-area-inset-top));left:50%;width:min(540px,calc(100vw - 20px));display:grid;gap:8px;transform:translateX(-50%);pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}.caelian-bridge-toast{position:relative;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:11px;min-height:58px;padding:10px 11px;overflow:hidden;border:1px solid rgba(212,168,67,.56);border-radius:15px;color:#f6efe2;background:linear-gradient(135deg,rgba(31,42,55,.98),rgba(43,31,55,.98));box-shadow:0 18px 48px rgba(0,0,0,.44);backdrop-filter:blur(14px) saturate(145%);opacity:0;transform:translateY(-12px);transition:opacity .25s ease,transform .25s ease;pointer-events:auto}.caelian-bridge-toast.warning,.caelian-bridge-toast.error{border-color:rgba(239,118,95,.6);background:linear-gradient(135deg,rgba(56,29,31,.98),rgba(34,19,30,.98))}.caelian-bridge-toast.show{opacity:1;transform:none}.caelian-bridge-toast.hide{opacity:0;transform:translateY(-10px)}.caelian-bridge-toast-icon{display:grid;width:36px;height:36px;place-items:center;border-radius:11px;color:#201506;background:linear-gradient(135deg,#ffe197,#b98220);font-weight:900}.caelian-bridge-toast.warning .caelian-bridge-toast-icon,.caelian-bridge-toast.error .caelian-bridge-toast-icon{color:#fff;background:linear-gradient(135deg,#ffb59b,#ad4435)}.caelian-bridge-toast-copy{min-width:0}.caelian-bridge-toast-copy span{display:block;color:#e5c875;font-size:8px;font-weight:800;letter-spacing:.15em}.caelian-bridge-toast-copy strong{display:block;margin-top:2px;overflow:hidden;color:#fff2d8;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.caelian-bridge-toast-close{width:23px;height:23px;padding:0;border:0;border-radius:7px;color:#d8ccbb;background:rgba(255,255,255,.07);font-size:16px;cursor:pointer}.caelian-bridge-toast-progress{position:absolute;right:9px;bottom:0;left:9px;height:2px;background:linear-gradient(90deg,transparent,#ffe197);transform-origin:left;animation:caelianBridgeToastTimer 5s linear forwards}@keyframes caelianBridgeToastTimer{to{transform:scaleX(0)}}@media(prefers-reduced-motion:reduce){.caelian-bridge-toast{transition:none}.caelian-bridge-toast-progress{animation:none}}';
      (d.head || d.documentElement).appendChild(style);
    }
    let host = d.querySelector?.('.caelian-bridge-toast-host');
    if (!host) {
      host = d.createElement('div');
      host.className = 'caelian-bridge-toast-host';
      d.body.appendChild(host);
    }
    const toast = d.createElement('div');
    toast.className = 'caelian-bridge-toast ' + level;
    const icon = d.createElement('div');
    icon.className = 'caelian-bridge-toast-icon';
    icon.textContent = level === 'error' ? '×' : level === 'warning' ? '!' : '✦';
    const copy = d.createElement('div');
    copy.className = 'caelian-bridge-toast-copy';
    const label = d.createElement('span');
    label.textContent = level === 'error' ? 'SYSTEM ERROR' : level === 'warning' ? 'ATTENTION' : 'UPDATE COMPLETE';
    const text = d.createElement('strong');
    text.textContent = String(message || '');
    copy.append(label, text);
    const close = d.createElement('button');
    close.type = 'button';
    close.className = 'caelian-bridge-toast-close';
    close.setAttribute('aria-label', '关闭通知');
    close.textContent = '×';
    const progress = d.createElement('div');
    progress.className = 'caelian-bridge-toast-progress';
    toast.append(icon, copy, close, progress);
    host.appendChild(toast);
    const remove = () => {
      toast.classList.remove('show');
      toast.classList.add('hide');
      setTimeout(() => {
        toast.remove();
        if (!host.childElementCount) host.remove();
      }, 260);
    };
    close.addEventListener('click', remove);
    try {
      (root.requestAnimationFrame || requestAnimationFrame)(() => {
        toast.classList.add('show');
      });
    } catch {
      setTimeout(() => toast.classList.add('show'), 20);
    }
    setTimeout(remove, level === 'error' ? 7000 : 5000);
    return true;
  };

  const showBridgeUpdatePrompt = (manifest, actions) => {
    const d = root.document;
    if (!d || typeof d.createElement !== 'function' || !d.body) return null;
    const styleId = 'caelian-bridge-update-style-v1';
    if (!d.getElementById?.(styleId)) {
      const style = d.createElement('style');
      style.id = styleId;
      style.textContent = '.caelian-bridge-toast-host{position:fixed;z-index:2147483647;top:max(12px,env(safe-area-inset-top));left:50%;width:min(540px,calc(100vw - 20px));display:grid;gap:8px;transform:translateX(-50%);pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}.caelian-bridge-update{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;padding:13px;overflow:hidden;border:1px solid rgba(224,184,93,.72);border-radius:17px;color:#f9eed8;background:radial-gradient(circle at 12% 0,rgba(244,207,119,.18),transparent 34%),linear-gradient(135deg,rgba(36,31,55,.985),rgba(49,29,58,.985));box-shadow:0 20px 56px rgba(0,0,0,.48),inset 0 1px rgba(255,255,255,.08);backdrop-filter:blur(16px) saturate(145%);opacity:0;transform:translateY(-14px) scale(.98);transition:opacity .28s ease,transform .28s cubic-bezier(.2,.8,.2,1);pointer-events:auto}.caelian-bridge-update.show{opacity:1;transform:none}.caelian-bridge-update::after{position:absolute;inset:0;content:"";background:linear-gradient(105deg,transparent 25%,rgba(255,232,170,.12) 45%,transparent 64%);transform:translateX(-115%);animation:caelianBridgeUpdateSweep 2.8s ease .45s both;pointer-events:none}.caelian-bridge-update-icon{display:grid;width:43px;height:43px;place-items:center;border:1px solid rgba(255,232,165,.72);border-radius:14px;color:#2b1806;background:linear-gradient(145deg,#ffe5a1,#bc7821);box-shadow:0 8px 22px rgba(190,122,34,.28);font-size:21px;font-weight:900}.caelian-bridge-update-copy{min-width:0}.caelian-bridge-update-copy>span{display:block;color:#eacb76;font-size:9px;font-weight:900;letter-spacing:.16em}.caelian-bridge-update-copy>strong{display:block;margin-top:3px;color:#fff3d7;font-size:14px;line-height:1.35}.caelian-bridge-update-copy>p{margin:5px 0 0;color:#d6c9d8;font-size:11px;line-height:1.5}.caelian-bridge-update-copy>small{display:block;margin-top:5px;color:#a99cb4;font-size:9px}.caelian-bridge-update-close{width:25px;height:25px;padding:0;border:0;border-radius:8px;color:#ded1bf;background:rgba(255,255,255,.08);font-size:17px;cursor:pointer}.caelian-bridge-update-actions{grid-column:2/4;display:flex;flex-wrap:wrap;gap:7px}.caelian-bridge-update-actions button{min-height:31px;padding:6px 11px;border:1px solid rgba(231,198,119,.32);border-radius:9px;color:#e8dccb;background:rgba(255,255,255,.07);font-size:10px;font-weight:750;cursor:pointer;transition:transform .16s ease,background .16s ease}.caelian-bridge-update-actions button:hover{background:rgba(255,255,255,.13);transform:translateY(-1px)}.caelian-bridge-update-actions button.primary{border-color:rgba(255,226,153,.72);color:#271706;background:linear-gradient(135deg,#ffe39b,#c7872d)}.caelian-bridge-update-actions button.ignore{margin-left:auto;color:#b9adbd;border-color:transparent;background:transparent}@keyframes caelianBridgeUpdateSweep{to{transform:translateX(115%)}}@media(max-width:460px){.caelian-bridge-update{grid-template-columns:auto minmax(0,1fr) auto;padding:11px}.caelian-bridge-update-icon{width:38px;height:38px}.caelian-bridge-update-actions{grid-column:1/4}.caelian-bridge-update-actions button{flex:1}.caelian-bridge-update-actions button.ignore{margin-left:0;flex-basis:100%}}@media(prefers-reduced-motion:reduce){.caelian-bridge-update{transition:none}.caelian-bridge-update::after{animation:none}}';
      (d.head || d.documentElement).appendChild(style);
    }

    let host = d.querySelector?.('.caelian-bridge-toast-host');
    if (!host) {
      host = d.createElement('div');
      host.className = 'caelian-bridge-toast-host';
      d.body.appendChild(host);
    }
    host.querySelector?.('[data-caelian-update-prompt]')?.remove();

    const prompt = d.createElement('section');
    prompt.className = 'caelian-bridge-update';
    prompt.dataset.caelianUpdatePrompt = manifest.buildId;
    prompt.setAttribute('role', 'status');
    prompt.setAttribute('aria-live', 'polite');

    const icon = d.createElement('div');
    icon.className = 'caelian-bridge-update-icon';
    icon.textContent = '↥';

    const copy = d.createElement('div');
    copy.className = 'caelian-bridge-update-copy';
    const eyebrow = d.createElement('span');
    eyebrow.textContent = 'UPDATE AVAILABLE';
    const title = d.createElement('strong');
    title.textContent = '发现新版本 ' + manifest.version;
    const description = d.createElement('p');
    description.textContent = '新内容已经发布。更新验证成功后将自动刷新一次酒馆，确保加载最新内容。';
    const meta = d.createElement('small');
    meta.textContent = '构建 ' + manifest.buildId.slice(0, 8) + ' · Alpha 通道';
    copy.append(eyebrow, title, description, meta);

    const close = d.createElement('button');
    close.type = 'button';
    close.className = 'caelian-bridge-update-close';
    close.setAttribute('aria-label', '稍后提醒');
    close.textContent = '×';

    const actionRow = d.createElement('div');
    actionRow.className = 'caelian-bridge-update-actions';
    const update = d.createElement('button');
    update.type = 'button';
    update.className = 'primary';
    update.textContent = '立即更新';
    const later = d.createElement('button');
    later.type = 'button';
    later.textContent = '2 小时后提醒';
    const ignore = d.createElement('button');
    ignore.type = 'button';
    ignore.className = 'ignore';
    ignore.textContent = '忽略此版本';
    actionRow.append(update, later, ignore);
    prompt.append(icon, copy, close, actionRow);
    host.appendChild(prompt);

    let settled = false;
    let autoLaterTimer = null;
    const remove = () => {
      settled = true;
      if (autoLaterTimer !== null && typeof root.clearTimeout === 'function') {
        root.clearTimeout(autoLaterTimer);
      }
      prompt.classList.remove('show');
      setTimeout(() => {
        prompt.remove();
        if (!host.childElementCount) host.remove();
      }, 280);
    };
    const settle = (action) => {
      if (settled) return;
      settled = true;
      remove();
      action();
    };
    close.addEventListener('click', () => settle(actions.later));
    later.addEventListener('click', () => settle(actions.later));
    ignore.addEventListener('click', () => settle(actions.ignore));
    update.addEventListener('click', () => settle(actions.update));
    try {
      (root.requestAnimationFrame || requestAnimationFrame)(() => {
        prompt.classList.add('show');
      });
    } catch {
      setTimeout(() => prompt.classList.add('show'), 20);
    }
    if (typeof root.setTimeout === 'function') {
      autoLaterTimer = root.setTimeout(
        () => settle(actions.later),
        30_000,
      );
    }
    return { buildId: manifest.buildId, remove };
  };

  const notify = (level, message) => {
    try {
      if (typeof root.Caelian?.notify === 'function') {
        root.Caelian.notify({
          kind: level,
          title: 'Re∞：欧西亚斯 Alpha',
          description: message,
          duration: level === 'error' ? 7000 : 5000,
        });
        return;
      }
      if (showBridgeToast(level, message)) return;
      root.toastr?.[level]?.(message, 'Re∞：欧西亚斯 Alpha');
    } catch {}
  };
  root.__CaelianBridgeNotify = notify;

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
      await root.Caelian?.syncManagedContent?.({ force: false });
    } catch (error) {
      for (const style of installedStyles) style.remove();
      throw error;
    }
  };

  const checkIntervalMs = 10 * 60 * 1000;
  const backgroundIntervalMs = 30 * 60 * 1000;
  const reminderDelayMs = 2 * 60 * 60 * 1000;
  const focusCooldownMs = 30 * 1000;
  const setTimer =
    typeof root.setTimeout === 'function'
      ? root.setTimeout.bind(root)
      : typeof setTimeout === 'function'
        ? setTimeout
        : null;
  const clearTimer =
    typeof root.clearTimeout === 'function'
      ? root.clearTimeout.bind(root)
      : typeof clearTimeout === 'function'
        ? clearTimeout
        : null;
  let watchTimer = null;
  let deferredTimer = null;
  let checking = false;
  let installing = false;
  let stopped = false;
  let lastCheckAt = Date.now();
  let updatePrompt = null;
  let deferredManifest = null;
  let disposeBattleWatch = null;
  let broadcast = null;

  const readReminder = () => {
    try {
      const value = JSON.parse(root.localStorage.getItem(reminderKey) || 'null');
      if (!value || typeof value.buildId !== 'string') return null;
      return {
        buildId: value.buildId,
        nextReminderAt: Number(value.nextReminderAt || 0),
        ignored: value.ignored === true,
      };
    } catch {
      return null;
    }
  };

  const writeReminder = (value) => {
    try {
      root.localStorage.setItem(reminderKey, JSON.stringify(value));
    } catch {}
  };

  const fetchLatestManifest = async () => {
    for (let index = 0; index < manifestSources.length; index += 1) {
      try {
        return {
          manifest: await fetchManifest(manifestSources[index]),
          sourceIndex: index,
        };
      } catch {}
    }
    return null;
  };

  const isBattleRunning = async () => {
    try {
      const snapshot = await root.Caelian?.query?.('state');
      return snapshot?.battle?.state?.status === 'ongoing';
    } catch {
      return false;
    }
  };

  const preferredOpenPanel = () => {
    try {
      const panels = root.Caelian?.listOpenPanels?.() || [];
      return panels.find(
        (panel) =>
          panel !== 'shell' &&
          panel !== 'release-notes' &&
          panel !== 'achievement-letter',
      );
    } catch {
      return null;
    }
  };

  const restorePanel = async (panel) => {
    if (!panel || typeof root.Caelian?.navigatePanel !== 'function') return;
    try {
      await root.Caelian.navigatePanel(panel);
    } catch {}
  };

  const reloadTavern = () => {
    try {
      if (typeof root.location?.reload === 'function') {
        root.location.reload();
        return true;
      }
    } catch {}
    return false;
  };

  const installAvailableUpdate = async (requested) => {
    if (installing || root.Caelian?.buildId === requested.buildId) return;
    installing = true;
    updatePrompt?.remove?.();
    updatePrompt = null;
    const cachedGood = readCached(cacheKey);
    const oldPanel = preferredOpenPanel();
    notify('info', '正在安全更新到 ' + requested.version + '……');

    const candidates = [requested];
    const candidateUrls = new Set([requested.modules.runtime.url]);
    for (const source of manifestSources) {
      try {
        const alternate = await fetchManifest(source);
        if (
          alternate.buildId === requested.buildId &&
          !candidateUrls.has(alternate.modules.runtime.url)
        ) {
          candidates.push(alternate);
          candidateUrls.add(alternate.modules.runtime.url);
        }
      } catch {}
    }

    let lastError = null;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      try {
        await activate(candidate, index > 0);
        if (cachedGood && cachedGood.buildId !== candidate.buildId) {
          writeCached(previousCacheKey, cachedGood);
        }
        writeCached(cacheKey, candidate);
        writeReminder({
          buildId: candidate.buildId,
          nextReminderAt: Number.MAX_SAFE_INTEGER,
          ignored: true,
        });
        await restorePanel(oldPanel);
        notify('success', 'Alpha ' + candidate.version + ' 更新完成，正在刷新酒馆……');
        try {
          broadcast?.postMessage({
            type: 'installed',
            buildId: candidate.buildId,
          });
        } catch {}
        installing = false;
        if (!reloadTavern()) {
          notify('warning', '自动刷新酒馆失败，请手动刷新页面以加载最新内容。');
        }
        return;
      } catch (error) {
        lastError = error;
      }
    }

    if (cachedGood && cachedGood.buildId !== requested.buildId) {
      try {
        await activate(cachedGood, true);
        await restorePanel(oldPanel);
        notify('warning', '更新未完成，已恢复到上一个可用版本。');
        installing = false;
        return;
      } catch (error) {
        lastError = error;
      }
    }
    installing = false;
    notify(
      'error',
      '更新失败：' +
        (lastError instanceof Error ? lastError.message : String(lastError)),
    );
  };

  const stopDeferredWatch = () => {
    disposeBattleWatch?.();
    disposeBattleWatch = null;
    if (deferredTimer !== null && clearTimer) clearTimer(deferredTimer);
    deferredTimer = null;
  };

  const tryDeferredUpdate = async () => {
    if (!deferredManifest || installing || (await isBattleRunning())) return;
    const manifest = deferredManifest;
    deferredManifest = null;
    stopDeferredWatch();
    await installAvailableUpdate(manifest);
  };

  const scheduleDeferredCheck = () => {
    if (!setTimer || stopped || !deferredManifest) return;
    if (deferredTimer !== null && clearTimer) clearTimer(deferredTimer);
    deferredTimer = setTimer(async () => {
      deferredTimer = null;
      await tryDeferredUpdate();
      if (deferredManifest) scheduleDeferredCheck();
    }, 15_000);
  };

  const requestInstall = async (manifest) => {
    if (await isBattleRunning()) {
      deferredManifest = manifest;
      stopDeferredWatch();
      if (typeof root.Caelian?.on === 'function') {
        disposeBattleWatch = root.Caelian.on('state.changed', () => {
          void tryDeferredUpdate();
        });
      }
      scheduleDeferredCheck();
      notify('warning', '检测到进行中的战斗，将在战斗结束后自动更新。');
      return;
    }
    await installAvailableUpdate(manifest);
  };

  const snoozeManifest = (manifest) => {
    writeReminder({
      buildId: manifest.buildId,
      nextReminderAt: Date.now() + reminderDelayMs,
      ignored: false,
    });
  };

  const ignoreManifest = (manifest) => {
    writeReminder({
      buildId: manifest.buildId,
      nextReminderAt: Number.MAX_SAFE_INTEGER,
      ignored: true,
    });
  };

  const promptForUpdate = (manifest) => {
    const reminder = readReminder();
    if (
      reminder?.buildId === manifest.buildId &&
      (reminder.ignored || Date.now() < reminder.nextReminderAt)
    ) {
      return;
    }
    snoozeManifest(manifest);
    try {
      broadcast?.postMessage({
        type: 'prompted',
        buildId: manifest.buildId,
        nextReminderAt: Date.now() + reminderDelayMs,
      });
    } catch {}
    updatePrompt?.remove?.();
    updatePrompt = showBridgeUpdatePrompt(manifest, {
      update: () => void requestInstall(manifest),
      later: () => snoozeManifest(manifest),
      ignore: () => ignoreManifest(manifest),
    });
    if (!updatePrompt && typeof root.Caelian?.notify === 'function') {
      root.Caelian.notify({
        kind: 'info',
        icon: '↥',
        eyebrow: 'UPDATE AVAILABLE',
        title: '发现新版本 ' + manifest.version,
        description: '点击此通知立即更新；验证成功后会自动刷新酒馆。',
        duration: 12_000,
        priority: 88,
        onClick: () => requestInstall(manifest),
      });
    }
  };

  const scheduleCheck = (delay) => {
    if (!setTimer || stopped) return;
    if (watchTimer !== null && clearTimer) clearTimer(watchTimer);
    watchTimer = setTimer(() => {
      watchTimer = null;
      void checkForUpdates(false);
    }, delay);
  };

  const checkForUpdates = async (force) => {
    if (checking || stopped) return;
    const now = Date.now();
    if (!force && now - lastCheckAt < focusCooldownMs) return;
    checking = true;
    lastCheckAt = now;
    try {
      const latest = await fetchLatestManifest();
      if (
        latest &&
        latest.manifest.buildId !== root.Caelian?.buildId
      ) {
        promptForUpdate(latest.manifest);
      }
      await root.Caelian?.syncManagedContent?.({ force: false });
    } finally {
      checking = false;
      const hidden = root.document?.visibilityState === 'hidden';
      scheduleCheck(hidden ? backgroundIntervalMs : checkIntervalMs);
    }
  };

  const onVisible = () => {
    if (root.document?.visibilityState !== 'hidden') {
      void checkForUpdates(false);
    }
  };
  const onFocus = () => void checkForUpdates(false);
  const onOnline = () => void checkForUpdates(true);

  const startUpdateWatcher = () => {
    if (stopped) return;
    try {
      previousWatcher?.stop?.();
    } catch {}
    root.document?.addEventListener?.('visibilitychange', onVisible);
    root.addEventListener?.('focus', onFocus);
    root.addEventListener?.('online', onOnline);
    if (typeof root.BroadcastChannel === 'function') {
      try {
        broadcast = new root.BroadcastChannel('caelian:alpha:update');
        broadcast.addEventListener('message', (event) => {
          const data = event?.data;
          if (data?.type === 'prompted' && typeof data.buildId === 'string') {
            writeReminder({
              buildId: data.buildId,
              nextReminderAt: Number(data.nextReminderAt || Date.now() + reminderDelayMs),
              ignored: false,
            });
            if (updatePrompt?.buildId === data.buildId) {
              updatePrompt.remove();
              updatePrompt = null;
            }
          }
        });
      } catch {}
    }
    scheduleCheck(checkIntervalMs);
    root[watcherKey] = {
      channel: 'alpha',
      checkIntervalMs,
      checkNow: () => checkForUpdates(true),
      syncContent: () =>
        root.Caelian?.syncManagedContent?.({ force: true }),
      stop: () => {
        if (stopped) return;
        stopped = true;
        if (watchTimer !== null && clearTimer) clearTimer(watchTimer);
        watchTimer = null;
        stopDeferredWatch();
        updatePrompt?.remove?.();
        updatePrompt = null;
        root.document?.removeEventListener?.('visibilitychange', onVisible);
        root.removeEventListener?.('focus', onFocus);
        root.removeEventListener?.('online', onOnline);
        try {
          broadcast?.close?.();
        } catch {}
        broadcast = null;
      },
    };
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
    startUpdateWatcher();
    return;
  }

  try {
    await activate(requested);
    if (cachedGood && cachedGood.buildId !== requested.buildId) {
      writeCached(previousCacheKey, cachedGood);
    }
    writeCached(cacheKey, requested);
    notify('success', 'Alpha ' + requested.version + ' 已加载');
    startUpdateWatcher();
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
        startUpdateWatcher();
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
    if (typeof root.__CaelianBridgeNotify === 'function') {
      root.__CaelianBridgeNotify('error', message);
    } else {
      root.toastr?.error?.(message, 'Re∞：欧西亚斯 Alpha');
    }
  } catch {}
  console.error('[Caelian Alpha Bridge]', error);
});`;

const renderedBridge =
  channel === 'alpha'
    ? bridge
    : bridge
        .replaceAll('Alpha', 'Beta')
        .replaceAll('alpha', 'beta')
        .replaceAll(
          'caelian-re-oseas-beta.jianghailou7.chatgpt.site',
          'caelian-re-oseas-alpha.jianghailou7.chatgpt.site',
        );
const folder = {
  type: 'folder',
  enabled: true,
  name: `Re∞：欧西亚斯 ${channelLabel} 接入口`,
  id:
    channel === 'alpha'
      ? '51e90831-e25a-4afe-b6c6-c3187dd53dc9'
      : '9e445fde-b1b2-4a6f-9d43-4ef0e42fd8b1',
  icon: 'fa-infinity',
  color: 'rgba(104, 81, 145, 1)',
  scripts: [
    {
      type: 'script',
      enabled: true,
      name: `Re∞：欧西亚斯 ${channelLabel} Bridge`,
      id:
        channel === 'alpha'
          ? '11dc566b-8d62-4892-912d-b9f5b25df1b0'
          : 'fd9cf9c7-fabe-47f8-beb4-63d17839f379',
      content: renderedBridge,
    },
  ],
};

const standaloneScript = {
  type: 'script',
  enabled: true,
  name: `Re∞：欧西亚斯${channelLabel}`,
  id:
    channel === 'alpha'
      ? 'f56df46e-b198-4d84-9e94-269079a31e17'
      : '4cd6194c-ed4f-418c-a3e2-216351c95efe',
  content: renderedBridge,
  info: `固定读取公网 ${channelLabel} 通道；每 10 分钟自动检查更新，主线路不可达时切换备用公网 CDN。`,
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

const tailTownThemeUnlockScript = `(function unlockCaelianTailTownTheme() {
  'use strict';
  const root = (() => {
    for (const candidate of [window.top, window.parent, window]) {
      try {
        if (candidate && candidate.document) return candidate;
      } catch {}
    }
    return window;
  })();
  const key = '__CaelianThemeEntitlements';
  const current = root[key];
  const existing = Array.isArray(current)
    ? current
    : current && typeof current === 'object' && Array.isArray(current.ids)
      ? current.ids
      : [];
  const ids = Array.from(new Set([...existing, 'tail-town-dog']));
  root[key] = { version: 1, ids };
  try {
    root.dispatchEvent(new root.CustomEvent(
      'caelian:theme-entitlements-changed',
      { detail: { id: 'tail-town-dog' } },
    ));
  } catch {}
})();`;

const tailTownThemeScript = {
  type: 'script',
  enabled: true,
  name: '尾巴镇专属奖励 · 小狗主题',
  id: '0d7259fc-65de-44c2-9ac6-6bb7a6d84a51',
  content: tailTownThemeUnlockScript,
  info: '导入后在凯利安设置的“界面主题”中解锁小狗主题。主题图片由当前线上构建加载，脚本本身不包含图片或本地资产。',
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

const journeyThemeUnlockScript = `(function unlockCaelianJourneyTheme() {
  'use strict';
  const root = (() => {
    for (const candidate of [window.top, window.parent, window]) {
      try {
        if (candidate && candidate.document) return candidate;
      } catch {}
    }
    return window;
  })();
  const key = '__CaelianThemeEntitlements';
  const current = root[key];
  const existing = Array.isArray(current)
    ? current
    : current && typeof current === 'object' && Array.isArray(current.ids)
      ? current.ids
      : [];
  const ids = Array.from(new Set([...existing, 'journey-ticket']));
  root[key] = { version: 1, ids };
  try {
    root.dispatchEvent(new root.CustomEvent(
      'caelian:theme-entitlements-changed',
      { detail: { id: 'journey-ticket' } },
    ));
  } catch {}
})();`;

const journeyThemeScript = {
  type: 'script',
  enabled: true,
  name: '旅程专属奖励 · 旅程主题',
  id: '18b99716-a47c-4fa7-8d56-a430648bfc63',
  content: journeyThemeUnlockScript,
  info: '导入后在凯利安设置的“界面主题”中解锁旅程主题。主题图片由当前线上构建加载，脚本本身不包含图片或本地资产。',
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
  path.join(distRoot, 'tavern-helper', `caelian-${channel}.json`),
  `${JSON.stringify(folder, null, 2)}\n`,
  'utf8',
);

await writeFile(
  path.join(distRoot, 'tavern-helper', `caelian-${channel}-script.json`),
  `${JSON.stringify(standaloneScript, null, 2)}\n`,
  'utf8',
);

await writeFile(
  path.join(distRoot, 'tavern-helper', `caelian-${channel}-bridge.js`),
  `${renderedBridge}\n`,
  'utf8',
);

await writeFile(
  path.join(distRoot, 'tavern-helper', 'caelian-tail-town-theme.json'),
  `${JSON.stringify(tailTownThemeScript, null, 2)}\n`,
  'utf8',
);

await writeFile(
  path.join(distRoot, 'tavern-helper', 'caelian-journey-theme.json'),
  `${JSON.stringify(journeyThemeScript, null, 2)}\n`,
  'utf8',
);

await writeFile(
  path.join(distRoot, 'tavern-helper', `bridge-meta-${channel}.json`),
  `${JSON.stringify(
    {
      channel,
      bridgeApi: 1,
      packageVersion: releaseVersion,
      manifestUrl,
      manifestSources,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

if (channel === 'alpha') {
  await writeFile(
    path.join(distRoot, 'tavern-helper', 'bridge-meta.json'),
    `${JSON.stringify(
      {
        channel,
        bridgeApi: 1,
        packageVersion: releaseVersion,
        manifestUrl,
        manifestSources,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}
