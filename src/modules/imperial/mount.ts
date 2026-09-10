import { createApp, reactive } from 'vue';
import App from './App.vue';
import type { ImperialNotice, ImperialState } from '@/imperial/model';

export interface ImperialOverlay {
  update(profileKey: string, visible: boolean, state: ImperialState | null): void;
  announce(notices: ImperialNotice[]): void;
  clear(): void;
  destroy(): void;
}

export function mountImperialOverlay(host: Window): ImperialOverlay {
  const root = host.document.createElement('div');
  root.id = 'caelian-imperial-overlay';
  host.document.body.append(root);
  const view = reactive({ profileKey: '', visible: false, state: null as ImperialState | null, notices: [] as ImperialNotice[] });
  const app = createApp(App, { view, host, onDismiss: () => { view.notices.shift(); } });
  app.mount(root);
  return {
    update(profileKey, visible, state) {
      if (profileKey !== view.profileKey) view.notices = [];
      Object.assign(view, { profileKey, visible, state });
    },
    announce(notices) { view.notices.push(...notices); },
    clear() { view.visible = false; view.notices = []; view.state = null; },
    destroy() { app.unmount(); root.remove(); },
  };
}
