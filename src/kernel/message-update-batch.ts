import type { TavernEventPayload } from '@/tavern/adapter';

const priorities: Record<string, number> = {
  MESSAGE_UPDATED: 1,
  USER_MESSAGE_RENDERED: 2,
  CHARACTER_MESSAGE_RENDERED: 3,
  MESSAGE_RECEIVED: 4,
};

export interface PendingMessageUpdate {
  eventName: string;
  payload?: TavernEventPayload;
}

/** Only coalesce passive notifications; edits, swipes and generation boundaries stay ordered. */
export class MessageUpdateBatch {
  private readonly pending = new Map<string, PendingMessageUpdate>();

  accepts(eventName: string): boolean {
    return Object.hasOwn(priorities, eventName);
  }

  add(eventName: string, payload?: TavernEventPayload): PendingMessageUpdate | null {
    const key = payload?.messageId === undefined ? 'latest' : String(payload.messageId);
    const existing = this.pending.get(key);
    if (existing) {
      if (priorities[eventName]! >= priorities[existing.eventName]!) {
        existing.eventName = eventName;
        existing.payload = payload;
      }
      return null;
    }
    const update = { eventName, payload };
    this.pending.set(key, update);
    return update;
  }

  take(update: PendingMessageUpdate): void {
    const key = update.payload?.messageId === undefined ? 'latest' : String(update.payload.messageId);
    if (this.pending.get(key) === update) this.pending.delete(key);
  }

  clear(): void {
    this.pending.clear();
  }
}
