import { createPinia } from 'pinia';
import { createApp, type Component } from 'vue';
import type { PanelContext, PanelName } from '@/kernel/public-api';

export function mountVuePanel(
  component: Component,
  panel: PanelName,
  context: PanelContext,
): () => void {
  const existing = context.document.querySelector(
    `[data-caelian-panel="${panel}"]`,
  );
  existing?.remove();

  const host = context.document.createElement('div');
  host.dataset.caelianPanel = panel;
  host.className =
    panel === 'shell'
      ? 'caelian-panel-host caelian-shell-host'
      : panel === 'worldbook'
        ? 'caelian-panel-host caelian-worldbook-host'
      : panel === 'feedback' ||
          panel === 'surveys' ||
          panel === 'release-notes' ||
          panel === 'achievement-letter' ||
          panel === 'memory-together-letter' ||
          panel === 'quest-submission'
        ? 'caelian-panel-host caelian-modal-host'
        : 'caelian-panel-host';
  const root = context.document.createElement('div');
  host.appendChild(root);
  context.document.body.appendChild(host);

  const app = createApp(component, { context });
  app.use(createPinia());
  try {
    app.mount(root);
  } catch (error) {
    try {
      app.unmount();
    } catch {
      // Vue can throw before the application reaches a mounted state.
    }
    host.remove();
    throw error;
  }

  return () => {
    try {
      app.unmount();
    } finally {
      host.remove();
    }
  };
}
