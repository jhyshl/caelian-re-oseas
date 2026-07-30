import App from '@/modules/market/App.vue';
import type { PanelContext } from '@/kernel/public-api';
import { mountVuePanel } from '@/ui/mount-vue-panel';

export function mount(context: PanelContext) {
  return mountVuePanel(App, 'market', context);
}
