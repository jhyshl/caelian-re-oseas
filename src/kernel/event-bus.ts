import type { CommandResult } from '@/domain/commands';
import type {
  AchievementUnlockNotice,
  QuestTrackerState,
  RuntimeInfo,
} from '@/domain/types';
import type { CaelianThemeState } from '@/themes/types';

export interface KernelEventMap {
  'runtime.ready': RuntimeInfo;
  'runtime.stopped': RuntimeInfo;
  'state.changed': { command: CommandResult };
  'projection.synced': { revision: number };
  'panel.opened': { panel: string };
  'panel.closed': { panel: string };
  'tavern.changed': { event: string };
  'quest.progress-rolled-back': {
    questIds: string[];
    cutoffFloorIndex: number;
  };
  'quest.evaluated': {
    questId: string;
    floorIndex: number;
    transitionAccepted: boolean;
    currentNodeId: string;
    trackerState: QuestTrackerState;
  };
  'quest.judge-failed': {
    questId: string;
    floorIndex: number;
    message: string;
  };
  'quest.tracking-changed': {
    questId?: string;
    trackerState: QuestTrackerState | 'none';
  };
  'quest.submission-changed': { pending: boolean };
  'theme.changed': CaelianThemeState;
  'achievement.unlocked': AchievementUnlockNotice;
}

type EventHandler<T> = (payload: T) => void | Promise<void>;

export class EventBus {
  private readonly handlers = new Map<
    keyof KernelEventMap,
    Set<EventHandler<never>>
  >();

  on<K extends keyof KernelEventMap>(
    event: K,
    handler: EventHandler<KernelEventMap[K]>,
  ): () => void {
    const bucket =
      this.handlers.get(event) ?? new Set<EventHandler<never>>();
    bucket.add(handler as EventHandler<never>);
    this.handlers.set(event, bucket);
    return () => bucket.delete(handler as EventHandler<never>);
  }

  async emit<K extends keyof KernelEventMap>(
    event: K,
    payload: KernelEventMap[K],
  ): Promise<void> {
    const bucket = this.handlers.get(event);
    if (!bucket) return;
    await Promise.all(
      [...bucket].map((handler) =>
        Promise.resolve(handler(payload as never)),
      ),
    );
  }

  clear(): void {
    this.handlers.clear();
  }
}
