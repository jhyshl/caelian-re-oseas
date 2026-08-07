import App from '@/modules/card-square/App.vue';
import type { PanelContext } from '@/kernel/public-api';
import { mountVuePanel } from '@/ui/mount-vue-panel';

export function mount(context: PanelContext): () => void {
  return mountVuePanel(App, 'card-square', context);
}
