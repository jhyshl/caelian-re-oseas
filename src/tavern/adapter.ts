import type { AiProjection } from '@/domain/types';
import type { TavernAvatarUrls } from '@/kernel/public-api';
import { LEGACY_STAT_DATA_KEYS } from '@/mvu/contracts';

type TavernEventHandler = (eventName: string) => void | Promise<void>;

export function resolveTavernHost(sourceWindow: Window): Window {
  try {
    const parent = sourceWindow.parent;
    if (
      parent &&
      parent !== sourceWindow &&
      (parent.SillyTavern ||
        parent.Mvu ||
        parent.tavern_events ||
        typeof parent.eventOn === 'function' ||
        parent.__CaelianRuntime)
    ) {
      return parent;
    }
  } catch {
    // Cross-origin parents cannot be a supported Tavern host.
  }
  return sourceWindow;
}

export class TavernAdapter {
  readonly host: Window;
  private readonly disposers: Array<() => void> = [];

  constructor(sourceWindow: Window = window) {
    this.host = this.resolveHost(sourceWindow);
  }

  async context(): Promise<TavernContext> {
    try {
      return (
        (await Promise.resolve(this.host.SillyTavern?.getContext?.())) ?? {}
      );
    } catch {
      return {};
    }
  }

  async identity(): Promise<{ chatId: string; playerName?: string }> {
    const context = await this.context();
    const direct =
      context.chatId ??
      context.chat_id ??
      context.chatID ??
      context.chatFile ??
      context.chatName ??
      context.groupId ??
      context.characterId ??
      'default';
    return {
      chatId: String(direct),
      playerName: context.name1,
    };
  }

  async avatarUrls(): Promise<TavernAvatarUrls> {
    try {
      const context = await this.context();
      return {
        user: this.resolveUserAvatar(context),
        character: this.resolveCharacterAvatar(context),
      };
    } catch {
      return { user: '', character: '' };
    }
  }

  hasLegacyRuntime(): boolean {
    return Boolean(this.host.__CaelianRuntime);
  }

  hasMvu(): boolean {
    const mvu = this.host.Mvu;
    return Boolean(
      mvu &&
        typeof mvu.getMvuData === 'function' &&
        typeof mvu.replaceMvuData === 'function',
    );
  }

  readMvuData(): Record<string, unknown> | null {
    const mvu = this.host.Mvu;
    if (!mvu || !this.hasMvu()) return null;
    try {
      const option: MvuOption = { type: 'message', message_id: 'latest' };
      return this.clone(mvu.getMvuData(option) ?? {});
    } catch {
      return null;
    }
  }

  async writeProjection(projection: AiProjection): Promise<boolean> {
    const mvu = this.host.Mvu;
    if (!mvu || !this.hasMvu()) return false;

    const option: MvuOption = { type: 'message', message_id: 'latest' };
    const current = mvu.getMvuData(option) ?? {};
    const next = this.clone(current);
    const statData = this.asRecord(next.stat_data);

    for (const key of LEGACY_STAT_DATA_KEYS) {
      delete statData[key];
    }
    next.stat_data = {
      ...statData,
      caelian: projection,
    };

    if (JSON.stringify(current) === JSON.stringify(next)) return false;
    await Promise.resolve(mvu.replaceMvuData(next, option));
    return true;
  }

  subscribe(handler: TavernEventHandler): void {
    const eventOn = this.host.eventOn;
    const events = this.host.tavern_events;
    if (typeof eventOn !== 'function' || !events) return;

    for (const eventName of [
      'CHAT_CHANGED',
      'MESSAGE_RECEIVED',
      'MESSAGE_UPDATED',
      'PERSONA_CHANGED',
      'PERSONA_UPDATED',
      'CHARACTER_EDITED',
    ]) {
      const event = events[eventName];
      if (event === undefined) continue;
      const possibleDisposer = eventOn(event, () => void handler(eventName));
      if (typeof possibleDisposer === 'function') {
        this.disposers.push(possibleDisposer as () => void);
      }
    }
  }

  unsubscribeAll(): void {
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {
        // Tavern event adapters are allowed to expose best-effort disposers.
      }
    }
  }

  setUserInput(text: string): boolean {
    const value = text.trim();
    const hostDocument = this.host.document;
    const input =
      hostDocument.querySelector<HTMLTextAreaElement>('#send_textarea') ??
      hostDocument.querySelector<HTMLElement>(
        '[contenteditable="true"][role="textbox"]',
      );
    if (!input) return false;
    input.focus();
    if ('value' in input) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(input, value);
      if (!setter) (input as HTMLTextAreaElement).value = value;
    } else {
      input.textContent = value;
    }
    input.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: value,
      }),
    );
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  notify(
    level: 'info' | 'success' | 'warning' | 'error',
    message: string,
  ): void {
    this.host.toastr?.[level]?.(message, 'Re∞：欧西亚斯 Alpha');
  }

  private resolveHost(sourceWindow: Window): Window {
    return resolveTavernHost(sourceWindow);
  }

  private resolveUserAvatar(context: TavernContext): string {
    const document = this.host.document;
    const selectedPersona = document.querySelector<HTMLElement>(
      '#user_avatar_block .avatar-container.selected',
    );
    const selectedImage = selectedPersona
      ?.querySelector<HTMLImageElement>('img[src]')
      ?.getAttribute('src');
    const selectedImageUrl = this.safeAvatarUrl(selectedImage);
    if (selectedImageUrl) return selectedImageUrl;

    const selectedPersonaId = selectedPersona?.dataset.avatarId?.trim();
    const selectedThumbnail = this.thumbnailUrl(
      context,
      'persona',
      selectedPersonaId,
    );
    if (selectedThumbnail) return selectedThumbnail;

    const messageImages = document.querySelectorAll<HTMLImageElement>(
      '.mes[is_user="true"] .avatar img[src]',
    );
    const messageImage = messageImages.item(messageImages.length - 1);
    const messageImageUrl = this.safeAvatarUrl(
      messageImage?.getAttribute('src'),
    );
    if (messageImageUrl) return messageImageUrl;

    return this.thumbnailUrl(
      context,
      'persona',
      context.chatMetadata?.persona ??
        context.powerUserSettings?.default_persona,
    );
  }

  private resolveCharacterAvatar(context: TavernContext): string {
    const characters = context.characters ?? [];
    const characterIndex = Number(context.characterId);
    const directCharacter = Number.isInteger(characterIndex)
      ? characters[characterIndex]
      : undefined;
    const character =
      directCharacter ??
      characters.find(
        (candidate) =>
          candidate.name?.trim() &&
          candidate.name.trim() === context.name2?.trim(),
      );
    const thumbnail = this.thumbnailUrl(
      context,
      'avatar',
      character?.avatar,
    );
    if (thumbnail) return thumbnail;

    const messageImages = this.host.document.querySelectorAll<HTMLImageElement>(
      '.mes[is_user="false"] .avatar img[src]',
    );
    const messageImage = messageImages.item(messageImages.length - 1);
    return this.safeAvatarUrl(messageImage?.getAttribute('src'));
  }

  private thumbnailUrl(
    context: TavernContext,
    type: 'avatar' | 'persona',
    file: string | undefined,
  ): string {
    const value = file?.trim();
    if (!value) return '';
    if (value.startsWith('data:image/') || value.startsWith('blob:')) {
      return this.safeAvatarUrl(value);
    }
    try {
      const thumbnail = context.getThumbnailUrl?.(type, value);
      const thumbnailUrl = this.safeAvatarUrl(thumbnail);
      if (thumbnailUrl) return thumbnailUrl;
    } catch {
      // Older Tavern builds may expose the data without the helper.
    }
    const fallback =
      type === 'persona'
        ? `/User Avatars/${encodeURIComponent(value)}`
        : `/characters/${encodeURIComponent(value)}`;
    return this.safeAvatarUrl(fallback);
  }

  private safeAvatarUrl(value: string | null | undefined): string {
    const source = value?.trim();
    if (!source) return '';
    if (/^data:image\//i.test(source)) return source;
    try {
      const url = new URL(source, this.host.document.baseURI);
      return ['http:', 'https:', 'blob:'].includes(url.protocol)
        ? url.href
        : '';
    } catch {
      return '';
    }
  }

  private clone(value: Record<string, unknown>): Record<string, unknown> {
    try {
      return structuredClone(value);
    } catch {
      return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  }
}
