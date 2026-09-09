import type { PanelApi, PanelContext } from '@/kernel/public-api';

/** A hidden panel retains its view, but only replays the latest data notification on return. */
export class PanelScope {
  readonly context: PanelContext;
  private active = true;
  private disposed = false;
  private readonly listeners = new Map<() => void, () => void | Promise<void>>();

  constructor(context: PanelContext) {
    const on: PanelApi['on'] = (event, handler) => {
      if (this.disposed) return () => undefined;
      const pending = new Map<string, () => void | Promise<void>>();
      const unsubscribe = context.api.on(event, (payload) => {
        if (this.active) return handler(payload);
        // Persona/avatar changes must not be overwritten by a later message event.
        const key = event === 'tavern.changed' && 'event' in payload
          ? String(payload.event)
          : 'latest';
        pending.set(key, () => handler(payload));
      });
      this.listeners.set(unsubscribe, async () => {
        const replay = [...pending.values()];
        pending.clear();
        await Promise.all(replay.map((handler) => handler()));
      });
      return () => {
        unsubscribe();
        this.listeners.delete(unsubscribe);
      };
    };
    this.context = { ...context, api: { ...context.api, on }, isActive: () => this.active && !this.disposed };
  }

  suspend(): void {
    this.active = false;
  }

  async resume(): Promise<void> {
    this.active = true;
    await Promise.all([...this.listeners.values()].map((replay) => replay()));
  }

  dispose(): void {
    this.disposed = true;
    this.active = false;
    for (const unsubscribe of this.listeners.keys()) unsubscribe();
    this.listeners.clear();
  }
}
