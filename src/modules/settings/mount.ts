import App from '@/modules/settings/App.vue';
import type { PanelContext } from '@/kernel/public-api';
import { mountVuePanel } from '@/ui/mount-vue-panel';

export function mount(context: PanelContext) {
  return mountVuePanel(App, 'settings', context);
}
