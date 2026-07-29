import App from '@/modules/achievement-letter/App.vue';
import type { PanelContext } from '@/kernel/public-api';
import { mountVuePanel } from '@/ui/mount-vue-panel';

export function mount(context: PanelContext): () => void {
  return mountVuePanel(App, 'achievement-letter', context);
}
