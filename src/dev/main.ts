import '@/bridge/alpha-entry';
import type { PanelName } from '@/kernel/public-api';

async function activateThemePreview(): Promise<void> {
  const search = new URLSearchParams(window.location.search);
  const heartPreview = search.get('heart-preview');
  const journeyPreview = search.get('journey-preview');
  const preview = heartPreview ?? journeyPreview;
  if (
    !import.meta.env.DEV ||
    !preview
  ) {
    return;
  }
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (window.Caelian?.getRuntimeInfo().status === 'ready') break;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  if (!window.Caelian) return;
  if (heartPreview) {
    await window.Caelian.execute({
      id: 'dev-preview-heart-affinity',
      type: 'narrative.update',
      payload: { companion: { affinity: 250 } },
    });
    await window.Caelian.execute({
      id: 'dev-preview-heart-theme',
      type: 'settings.update',
      payload: { uiTheme: 'caelian-heart' },
    });
  } else {
    window.__CaelianThemeEntitlements = {
      version: 1,
      ids: ['journey-ticket'],
    };
    window.dispatchEvent(new Event('caelian:theme-entitlements-changed'));
    await window.Caelian.execute({
      id: 'dev-preview-journey-theme',
      type: 'settings.update',
      payload: { uiTheme: 'journey-ticket' },
    });
  }
  if (preview === 'launcher') return;
  if (preview !== 'menu') {
    await window.Caelian.openPanel(preview as PanelName);
    return;
  }
  window.setTimeout(() => {
    document.querySelector<HTMLButtonElement>('.caelian-shell-host .orb')?.click();
  }, 120);
}

void activateThemePreview();

const status = document.querySelector('#caelian-demo-status');

if (status && window.Caelian) {
  const info = window.Caelian.getRuntimeInfo();
  status.textContent = `状态：${info.status} · ${info.databaseName} · ${info.version}`;
}
