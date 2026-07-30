import type { EventBus } from '@/kernel/event-bus';
import type { PanelContext, PanelName } from '@/kernel/public-api';

interface PanelModule {
  mount(context: PanelContext): () => void | Promise<() => void>;
}

const definitions: Record<PanelName, () => Promise<PanelModule>> = {
  shell: () => import('@/modules/shell/mount'),
  character: () => import('@/modules/character/mount'),
  affinity: () => import('@/modules/affinity/mount'),
  deck: () => import('@/modules/deck/mount'),
  inventory: () => import('@/modules/inventory/mount'),
  market: () => import('@/modules/market/mount'),
  guild: () => import('@/modules/guild/mount'),
  map: () => import('@/modules/map/mount'),
  battle: () => import('@/modules/battle/mount'),
  achievements: () => import('@/modules/achievements/mount'),
  mailbox: () => import('@/modules/mailbox/mount'),
  settings: () => import('@/modules/settings/mount'),
  feedback: () => import('@/modules/feedback/mount'),
  'release-notes': () => import('@/modules/release-notes/mount'),
  'achievement-letter': () => import('@/modules/achievement-letter/mount'),
  diagnostics: () => import('@/modules/diagnostics/mount'),
};

const gamePanels = new Set<PanelName>([
  'character',
  'affinity',
  'deck',
  'inventory',
  'market',
  'guild',
  'map',
  'battle',
  'achievements',
  'mailbox',
  'settings',
  'feedback',
]);

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

  async navigate(panel: PanelName): Promise<void> {
    await this.open(panel);
    await Promise.all(
      [...this.mounted.keys()]
        .filter((name) => name !== panel && gamePanels.has(name))
        .map((name) => this.close(name)),
    );
  }

  list(): PanelName[] {
    return [...this.mounted.keys()];
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.mounted.keys()].map((panel) => this.close(panel)));
  }
}
