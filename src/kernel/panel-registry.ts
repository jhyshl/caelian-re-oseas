import type { EventBus } from '@/kernel/event-bus';
import type { PanelContext, PanelName } from '@/kernel/public-api';

interface PanelModule {
  mount(context: PanelContext): () => void | Promise<() => void>;
}

const definitions: Record<PanelName, () => Promise<PanelModule>> = {
  shell: () => import('@/modules/shell/mount'),
  character: () => import('@/modules/character/mount'),
  inventory: () => import('@/modules/inventory/mount'),
  diagnostics: () => import('@/modules/diagnostics/mount'),
};

export class PanelRegistry {
  private readonly mounted = new Map<PanelName, () => void>();
  private readonly opening = new Map<PanelName, Promise<void>>();

  constructor(
    private readonly context: PanelContext,
    private readonly events: EventBus,
  ) {}

  async open(panel: PanelName): Promise<void> {
    if (this.mounted.has(panel)) return;
    const inFlight = this.opening.get(panel);
    if (inFlight) return inFlight;

    const task = (async () => {
      const module = await definitions[panel]();
      const unmount = await module.mount(this.context);
      this.mounted.set(panel, unmount);
      await this.events.emit('panel.opened', { panel });
    })().finally(() => {
      this.opening.delete(panel);
    });

    this.opening.set(panel, task);
    return task;
  }

  async close(panel: PanelName): Promise<void> {
    await this.opening.get(panel);
    const unmount = this.mounted.get(panel);
    if (!unmount) return;
    unmount();
    this.mounted.delete(panel);
    await this.events.emit('panel.closed', { panel });
  }

  list(): PanelName[] {
    return [...this.mounted.keys()];
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.mounted.keys()].map((panel) => this.close(panel)));
  }
}
