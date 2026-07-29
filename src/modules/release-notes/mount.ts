import type { PanelContext } from '@/kernel/public-api';
import { mountVuePanel } from '@/ui/mount-vue-panel';
import App from './App.vue';

export function mount(context: PanelContext): () => void {
  return mountVuePanel(App, 'release-notes', context);
}
