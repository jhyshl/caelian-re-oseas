import type { EventBus } from '@/kernel/event-bus';
import type { PanelContext, PanelName } from '@/kernel/public-api';
import { PanelScope } from '@/kernel/panel-scope';

interface PanelModule {
  mount(context: PanelContext): (() => void) | Promise<() => void>;
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

// Retain at most three inactive pages. Battle and transient dialogs keep their
// existing teardown/settlement lifecycle.
const cacheablePanels = new Set<PanelName>([
  'character', 'inventory', 'deck', 'crafting', 'market', 'map', 'achievements',
]);
const MAX_CACHED_PANELS = 3;

export class PanelRegistry {
  private readonly mounted = new Map<PanelName, () => void>();
  private readonly opening = new Map<PanelName, Promise<void>>();
  private readonly scopes = new Map<PanelName, PanelScope>();
  private readonly cached = new Map<PanelName, { host: HTMLElement; unmount: () => void }>();
  private epoch = 0;
  private disposed = false;
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
    if (this.disposed) return;
    const inFlight = this.opening.get(panel);
    if (inFlight) return inFlight;
    const retained = this.cached.get(panel);
    if (retained) {
      this.cached.delete(panel);
      if (retained.host.isConnected) {
        retained.host.hidden = false;
        this.mounted.set(panel, retained.unmount);
        this.syncShellPagePanelState();
        const task = this.scopes.get(panel)!.resume()
          .then(() => this.events.emit('panel.opened', { panel }))
          .finally(() => this.opening.delete(panel));
        this.opening.set(panel, task);
        return task;
      }
      retained.unmount();
    }
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
    const epoch = this.epoch;
    const task = (async () => {
      const module = await definitions[panel]();
      if (this.disposed || epoch !== this.epoch) return;
      const scope = new PanelScope(this.context);
      this.scopes.set(panel, scope);
      let cleanup: () => void;
      try {
        cleanup = await module.mount(scope.context);
      } catch (error) {
        scope.dispose();
        this.scopes.delete(panel);
        throw error;
      }
      const unmount = () => {
        scope.dispose();
        this.scopes.delete(panel);
        cleanup();
      };
      if (this.disposed || epoch !== this.epoch) {
        unmount();
        return;
      }
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

  async close(panel: PanelName, retain = true): Promise<void> {
    await this.opening.get(panel);
    const unmount = this.mounted.get(panel);
    if (!unmount) return;
    try {
      const host = this.context.document.querySelector<HTMLElement>(`[data-caelian-panel="${panel}"]`);
      if (retain && cacheablePanels.has(panel) && host?.isConnected) {
        this.scopes.get(panel)?.suspend();
        host.hidden = true;
        this.cached.set(panel, { host, unmount });
        while (this.cached.size > MAX_CACHED_PANELS) {
          const oldest = this.cached.keys().next().value!;
          this.cached.get(oldest)!.unmount();
          this.cached.delete(oldest);
        }
      } else {
        unmount();
      }
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
    this.disposed = true;
    this.epoch += 1;
    try {
      await Promise.allSettled([...this.opening.values()]);
      await Promise.all(
        [...this.mounted.keys()].map((panel) => this.close(panel, false)),
      );
    } finally {
      this.clearCached();
      this.panelHostObserver?.disconnect();
      this.syncShellPagePanelState();
    }
  }

  /** Called before changing profiles, even when the new chat shares an adventure save. */
  async resetPages(): Promise<void> {
    this.epoch += 1;
    await Promise.allSettled([...this.opening.values()]);
    for (const [panel, unmount] of this.mounted) {
      if (panel === 'shell') continue;
      unmount();
      this.mounted.delete(panel);
    }
    this.clearCached();
    this.syncShellPagePanelState();
  }

  private clearCached(): void {
    for (const entry of this.cached.values()) entry.unmount();
    this.cached.clear();
  }

  private syncShellPagePanelState(): void {
    const shellHost = this.context.document.querySelector<HTMLElement>(
      '.caelian-shell-host',
    );
    if (!shellHost) return;

    const pagePanelOpen = Boolean(
      this.context.document.querySelector(
        '.caelian-panel-host:not(.caelian-shell-host):not([hidden]) .ca-frame',
      ),
    );
    shellHost.classList.toggle('caelian-page-panel-open', pagePanelOpen);
  }
}
