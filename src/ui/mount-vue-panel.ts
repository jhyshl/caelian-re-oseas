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
      : panel === 'feedback'
        ? 'caelian-panel-host caelian-feedback-host'
        : 'caelian-panel-host';
  const root = context.document.createElement('div');
  host.appendChild(root);
  context.document.body.appendChild(host);

  const app = createApp(component, { context });
  app.use(createPinia());
  app.mount(root);

  return () => {
    app.unmount();
    host.remove();
  };
}
