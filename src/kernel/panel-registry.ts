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
  'card-square': () => import('@/modules/card-square/mount'),
  inventory: () => import('@/modules/inventory/mount'),
  crafting: () => import('@/modules/crafting/mount'),
  market: () => import('@/modules/market/mount'),
  gathering: () => import('@/modules/gathering/mount'),
  guild: () => import('@/modules/guild/mount'),
  map: () => import('@/modules/map/mount'),
  worldbook: () => import('@/modules/worldbook/mount'),
  battle: () => import('@/modules/battle/mount'),
  achievements: () => import('@/modules/achievements/mount'),
  mailbox: () => import('@/modules/mailbox/mount'),
  settings: () => import('@/modules/settings/mount'),
  feedback: () => import('@/modules/feedback/mount'),
  surveys: () => import('@/modules/surveys/mount'),
  'release-notes': () => import('@/modules/release-notes/mount'),
  'achievement-letter': () => import('@/modules/achievement-letter/mount'),
  'memory-together-letter': () =>
    import('@/modules/memory-together-letter/mount'),
  'quest-submission': () => import('@/modules/quest-submission/mount'),
  diagnostics: () => import('@/modules/diagnostics/mount'),
};

const gamePanels = new Set<PanelName>([
  'character',
  'affinity',
  'deck',
  'card-square',
  'inventory',
  'crafting',
  'market',
  'gathering',
  'guild',
  'map',
  'battle',
  'achievements',
  'mailbox',
  'settings',
  'feedback',
  'surveys',
]);

export class PanelRegistry {
  private readonly mounted = new Map<PanelName, () => void>();
  private readonly opening = new Map<PanelName, Promise<void>>();
  private readonly panelHostObserver?: MutationObserver;

  constructor(
    private readonly context: PanelContext,
    private readonly events: EventBus,
  ) {
    const HostMutationObserver =
      this.context.document.defaultView?.MutationObserver;
    if (!HostMutationObserver) return;

    this.panelHostObserver = new HostMutationObserver(() => {
      this.syncShellPagePanelState();
    });
    this.panelHostObserver.observe(this.context.document.body, {
      childList: true,
    });
  }

  async open(panel: PanelName): Promise<void> {
    const mounted = this.mounted.get(panel);
    if (mounted) {
      const host = this.context.document.querySelector(
        `[data-caelian-panel="${panel}"]`,
      );
      if (host?.isConnected) return;

      // SillyTavern may replace a parent subtree while Vue still considers the
      // panel mounted. Tear down that stale app before recreating its host.
      try {
        mounted();
      } catch {
        // The host is already gone; deleting the stale registry entry is enough.
      }
      this.mounted.delete(panel);
      this.syncShellPagePanelState();
    }
    const inFlight = this.opening.get(panel);
    if (inFlight) return inFlight;

    const task = (async () => {
      const module = await definitions[panel]();
      const unmount = await module.mount(this.context);
      const host = this.context.document.querySelector(
        `[data-caelian-panel="${panel}"]`,
      );
      if (!host?.isConnected) {
        try {
          unmount();
        } finally {
          this.syncShellPagePanelState();
        }
        throw new Error(`面板 ${panel} 挂载后未进入可见文档`);
      }
      this.mounted.set(panel, unmount);
      this.syncShellPagePanelState();
      await this.events.emit('panel.opened', { panel });
    })()
      .catch((error: unknown) => {
        this.syncShellPagePanelState();
        throw error;
      })
      .finally(() => {
        this.opening.delete(panel);
      });

    this.opening.set(panel, task);
    return task;
  }

  async close(panel: PanelName): Promise<void> {
    await this.opening.get(panel);
    const unmount = this.mounted.get(panel);
    if (!unmount) return;
    try {
      unmount();
    } finally {
      this.mounted.delete(panel);
      this.syncShellPagePanelState();
      await this.events.emit('panel.closed', { panel });
    }
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
    try {
      await Promise.all(
        [...this.mounted.keys()].map((panel) => this.close(panel)),
      );
    } finally {
      this.panelHostObserver?.disconnect();
      this.syncShellPagePanelState();
    }
  }

  private syncShellPagePanelState(): void {
    const shellHost = this.context.document.querySelector<HTMLElement>(
      '.caelian-shell-host',
    );
    if (!shellHost) return;

    const pagePanelOpen = Boolean(
      this.context.document.querySelector(
        '.caelian-panel-host:not(.caelian-shell-host) .ca-frame',
      ),
    );
    shellHost.classList.toggle('caelian-page-panel-open', pagePanelOpen);
  }
}
