import { createApp, reactive, type App } from 'vue';
import NotificationCenterApp from '@/notifications/NotificationCenterApp.vue';
import type {
  ConfirmationInput,
  ConfirmationView,
  NotificationInput,
  NotificationKind,
  QuestGuidanceInput,
  NotificationToastView,
  NotificationViewModel,
} from '@/notifications/types';

const MAX_VISIBLE_TOASTS = 4;
const TOAST_GAP_MS = 120;
const EXIT_DURATION_MS = 280;

const DEFAULT_ICONS: Record<NotificationKind, string> = {
  achievement: '♛',
  task: '✓',
  craft: '✦',
  success: '✓',
  info: '✦',
  warning: '!',
  error: '×',
};

const DEFAULT_EYEBROWS: Record<NotificationKind, string> = {
  achievement: 'ACHIEVEMENT UNLOCKED',
  task: 'QUEST UPDATE',
  craft: 'CRAFT COMPLETE',
  success: 'UPDATE COMPLETE',
  info: 'OSEAS NOTICE',
  warning: 'ATTENTION',
  error: 'SYSTEM ERROR',
};

const DEFAULT_PRIORITIES: Record<NotificationKind, number> = {
  achievement: 72,
  task: 82,
  craft: 62,
  error: 58,
  warning: 54,
  success: 48,
  info: 20,
};

interface ToastTimer {
  handle: ReturnType<typeof setTimeout>;
  startedAt: number;
  remaining: number;
}

interface PendingConfirmation {
  view: ConfirmationView;
  resolve: (accepted: boolean) => void;
}

export class NotificationCenter {
  private readonly model = reactive<NotificationViewModel>({
    toasts: [],
    confirmation: null,
    questGuidance: null,
  });
  private readonly queue: NotificationToastView[] = [];
  private readonly actions = new Map<
    number,
    NotificationInput['onClick']
  >();
  private readonly timers = new Map<number, ToastTimer>();
  private readonly confirmations: PendingConfirmation[] = [];
  private app?: App;
  private host?: HTMLDivElement;
  private questGuidanceAction?: QuestGuidanceInput['onInject'];
  private pumpHandle?: ReturnType<typeof setTimeout>;
  private sequence = 0;

  constructor(private readonly document: Document) {}

  mount(): void {
    if (this.app) return;
    this.document
      .querySelector('[data-caelian-notification-center]')
      ?.remove();
    const host = this.document.createElement('div');
    host.dataset.caelianNotificationCenter = 'true';
    host.className = 'caelian-notification-center-host';
    this.document.body.appendChild(host);
    this.host = host;
    this.app = createApp(NotificationCenterApp, {
      model: this.model,
      dismiss: (id: number) => this.dismiss(id),
      activate: (id: number) => void this.activate(id),
      pause: (id: number) => this.pause(id),
      resume: (id: number) => this.resume(id),
      respond: (accepted: boolean) => this.respond(accepted),
      dismissQuestGuidance: () => this.clearQuestGuidance(),
      injectQuestGuidance: () => this.injectQuestGuidance(),
    });
    this.app.mount(host);
    this.document.addEventListener('keydown', this.handleKeydown);
  }

  show(input: NotificationInput): number {
    this.mount();
    const kind = input.kind ?? 'info';
    const title = input.title.trim();
    const description = input.description?.trim() ?? '';
    const duplicate = [...this.model.toasts, ...this.queue].find(
      (item) =>
        item.kind === kind &&
        item.title === title &&
        item.description === description &&
        Date.now() - item.createdAt < 1_000,
    );
    if (duplicate) return duplicate.id;

    const id = ++this.sequence;
    const item: NotificationToastView = {
      id,
      kind,
      icon: input.icon?.trim() || DEFAULT_ICONS[kind],
      eyebrow: input.eyebrow?.trim() || DEFAULT_EYEBROWS[kind],
      title: title || 'Re∞：欧西亚斯',
      description,
      meta: input.meta?.trim() ?? '',
      duration: Math.max(1_800, Number(input.duration ?? 5_000)),
      priority: Number.isFinite(input.priority)
        ? Number(input.priority)
        : DEFAULT_PRIORITIES[kind],
      actionText: input.actionText?.trim().slice(0, 24) ?? '',
      clickable: typeof input.onClick === 'function',
      leaving: false,
      paused: false,
      createdAt: Date.now(),
    };
    this.actions.set(id, input.onClick);
    this.queue.push(item);
    this.sortQueue();
    this.promoteHighestPriorityToast();
    this.pump();
    return id;
  }

  confirm(input: ConfirmationInput): Promise<boolean> {
    this.mount();
    const view: ConfirmationView = {
      id: ++this.sequence,
      title: input.title.trim() || '请确认',
      description: input.description.trim(),
      confirmText: input.confirmText?.trim() || '确认',
      cancelText: input.cancelText?.trim() || '取消',
      tone: input.tone ?? 'default',
    };
    return new Promise((resolve) => {
      this.confirmations.push({ view, resolve });
      this.presentNextConfirmation();
    });
  }

  showQuestGuidance(input: QuestGuidanceInput): void {
    this.mount();
    this.questGuidanceAction = input.onInject;
    this.model.questGuidance = {
      questName: input.questName.trim(),
      status: input.status.trim(),
      stageTitle: input.stageTitle.trim(),
      sceneTitle: input.sceneTitle.trim(),
      beatTitle: input.beatTitle.trim(),
      summary: input.summary.trim(),
      objective: input.objective.trim(),
      hint: input.hint.trim(),
      clues: (input.clues ?? []).map((clue) => clue.trim()).filter(Boolean),
      injectable:
        Boolean(input.injectText?.trim()) &&
        typeof input.onInject === 'function',
      injected: false,
    };
  }

  clearQuestGuidance(): void {
    this.questGuidanceAction = undefined;
    this.model.questGuidance = null;
  }

  dismiss(id: number): void {
    const item = this.model.toasts.find((toast) => toast.id === id);
    if (!item || item.leaving) return;
    item.leaving = true;
    this.clearTimer(id);
    setTimeout(() => {
      const index = this.model.toasts.findIndex(
        (toast) => toast.id === id,
      );
      if (index >= 0) this.model.toasts.splice(index, 1);
      this.actions.delete(id);
      this.pump();
    }, EXIT_DURATION_MS);
  }

  pause(id: number): void {
    const item = this.model.toasts.find((toast) => toast.id === id);
    const timer = this.timers.get(id);
    if (!item || !timer || item.paused || item.leaving) return;
    clearTimeout(timer.handle);
    timer.remaining = Math.max(
      0,
      timer.remaining - (Date.now() - timer.startedAt),
    );
    this.timers.set(id, timer);
    item.paused = true;
  }

  resume(id: number): void {
    const item = this.model.toasts.find((toast) => toast.id === id);
    const timer = this.timers.get(id);
    if (!item || !timer || !item.paused || item.leaving) return;
    item.paused = false;
    this.startTimer(item, timer.remaining);
  }

  respond(accepted: boolean): void {
    const current = this.confirmations.shift();
    if (!current) return;
    this.model.confirmation = null;
    current.resolve(accepted);
    queueMicrotask(() => this.presentNextConfirmation());
  }

  destroy(): void {
    if (this.pumpHandle) clearTimeout(this.pumpHandle);
    this.pumpHandle = undefined;
    for (const id of [...this.timers.keys()]) this.clearTimer(id);
    for (const pending of this.confirmations.splice(0)) {
      pending.resolve(false);
    }
    this.queue.splice(0);
    this.actions.clear();
    this.model.toasts.splice(0);
    this.model.confirmation = null;
    this.clearQuestGuidance();
    this.document.removeEventListener('keydown', this.handleKeydown);
    this.app?.unmount();
    this.host?.remove();
    this.app = undefined;
    this.host = undefined;
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.model.confirmation) {
      event.preventDefault();
      this.respond(false);
    }
  };

  private injectQuestGuidance(): void {
    const guidance = this.model.questGuidance;
    if (!guidance?.injectable || !this.questGuidanceAction) return;
    if (this.questGuidanceAction()) guidance.injected = true;
  }

  private async activate(id: number): Promise<void> {
    const action = this.actions.get(id);
    if (action) {
      try {
        await action();
      } catch {
        // A failed destination must not leave a permanent notification.
      }
    }
    this.dismiss(id);
  }

  private pump(): void {
    if (
      this.pumpHandle ||
      this.queue.length === 0 ||
      this.model.toasts.length >= MAX_VISIBLE_TOASTS
    ) {
      return;
    }
    const item = this.queue.shift();
    if (!item) return;
    this.model.toasts.push(item);
    this.startTimer(item, item.duration);
    this.pumpHandle = setTimeout(() => {
      this.pumpHandle = undefined;
      this.pump();
    }, TOAST_GAP_MS);
  }

  private promoteHighestPriorityToast(): void {
    const next = this.queue[0];
    if (!next || this.model.toasts.length < MAX_VISIBLE_TOASTS) return;
    let lowestIndex = 0;
    for (let index = 1; index < this.model.toasts.length; index += 1) {
      if (
        this.model.toasts[index]!.priority <
        this.model.toasts[lowestIndex]!.priority
      ) {
        lowestIndex = index;
      }
    }
    const lowest = this.model.toasts[lowestIndex];
    if (!lowest || next.priority <= lowest.priority) return;
    this.model.toasts.splice(lowestIndex, 1);
    this.clearTimer(lowest.id);
    lowest.leaving = false;
    lowest.paused = false;
    this.queue.push(lowest);
    this.sortQueue();
  }

  private startTimer(
    item: NotificationToastView,
    remaining: number,
  ): void {
    this.clearTimer(item.id);
    const handle = setTimeout(() => this.dismiss(item.id), remaining);
    this.timers.set(item.id, {
      handle,
      startedAt: Date.now(),
      remaining,
    });
  }

  private clearTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer.handle);
    this.timers.delete(id);
  }

  private sortQueue(): void {
    this.queue.sort(
      (left, right) =>
        right.priority - left.priority || left.id - right.id,
    );
  }

  private presentNextConfirmation(): void {
    if (this.model.confirmation) return;
    this.model.confirmation = this.confirmations[0]?.view ?? null;
  }
}
