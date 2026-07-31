import type { AiProjection } from '@/domain/types';
import type {
  TavernAvatarRequest,
  TavernAvatarUrls,
} from '@/kernel/public-api';
import { LEGACY_STAT_DATA_KEYS } from '@/mvu/contracts';
import type { LegacyAchievementPayload } from '@/storage/repositories/achievement-repository';
import {
  ACHIEVEMENT_PATCHES,
  type AchievementPatchSignal,
} from '@/achievements/patch-registry';

export interface TavernEventPayload {
  avatarId?: string;
}

type TavernEventHandler = (
  eventName: string,
  payload?: TavernEventPayload,
) => void | Promise<void>;

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
  private readonly runtime: Window;
  private readonly disposers: Array<() => void> = [];
  private userAvatarUrl: string | undefined;
  private characterAvatarUrl: string | undefined;
  private userAvatarOriginalUrl: string | undefined;
  private characterAvatarOriginalUrl: string | undefined;
  private userAvatarId: string | undefined;

  constructor(sourceWindow: Window = window) {
    this.runtime = sourceWindow;
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

  async avatarUrls(
    options: TavernAvatarRequest = {},
  ): Promise<TavernAvatarUrls> {
    if (options.refresh === 'all' || options.refresh === 'user') {
      this.userAvatarUrl = undefined;
      this.userAvatarOriginalUrl = undefined;
    }
    if (options.refresh === 'all' || options.refresh === 'character') {
      this.characterAvatarUrl = undefined;
      this.characterAvatarOriginalUrl = undefined;
    }
    if (
      this.userAvatarUrl !== undefined &&
      this.characterAvatarUrl !== undefined &&
      this.userAvatarOriginalUrl !== undefined &&
      this.characterAvatarOriginalUrl !== undefined
    ) {
      return {
        user: this.userAvatarUrl,
        character: this.characterAvatarUrl,
        userOriginal: this.userAvatarOriginalUrl,
        characterOriginal: this.characterAvatarOriginalUrl,
      };
    }
    try {
      const context = await this.context();
      const user = this.resolveUserAvatar(context);
      const character = this.resolveCharacterAvatar(context);
      const userOriginal = this.resolveUserAvatarOriginal(context);
      const characterOriginal =
        this.resolveCharacterAvatarOriginal(context);
      if (user) this.userAvatarUrl = user;
      if (character) this.characterAvatarUrl = character;
      if (userOriginal) this.userAvatarOriginalUrl = userOriginal;
      if (characterOriginal) {
        this.characterAvatarOriginalUrl = characterOriginal;
      }
    } catch {
      // Leave missing URLs uncached so a panel mounted slightly later can retry.
    }
    return {
      user: this.userAvatarUrl ?? '',
      character: this.characterAvatarUrl ?? '',
      userOriginal:
        this.userAvatarOriginalUrl ?? this.userAvatarUrl ?? '',
      characterOriginal:
        this.characterAvatarOriginalUrl ??
        this.characterAvatarUrl ??
        '',
    };
  }

  legacyPreserveAdventureSave(): boolean {
    try {
      const raw = this.host.localStorage.getItem('adv_panel_settings_v1');
      if (!raw) return false;
      const parsed = JSON.parse(raw) as {
        preserveAdventureSave?: unknown;
      };
      return parsed.preserveAdventureSave === true;
    } catch {
      return false;
    }
  }

  legacyAchievementPayload(): LegacyAchievementPayload {
    try {
      const achievementState = this.readLocalJson(
        'caelian_global_achievements_v1',
      );
      const prefix = 'caelian_special_patch_past_present_poem_v1';
      return {
        unlocked: this.asRecord(achievementState.unlocked),
        advanced: this.readLocalJson(
          'caelian_advanced_achievement_stats_v1',
        ),
        oldPlayerPatch: this.localFlag(
          'caelian_special_patch_old_player_v1',
        ),
        repoRewardPatch: this.localFlag(
          'caelian_special_patch_repo_reward_v1',
        ),
        poemRewardGranted: this.localFlag(`${prefix}_reward_granted`),
        poemUnlockedAt:
          this.host.localStorage.getItem(`${prefix}_reward_timestamp`) ??
          this.host.localStorage.getItem(
            `${prefix}_letter_opened_timestamp`,
          ) ??
          undefined,
        poemDailyGiftDate:
          this.host.localStorage.getItem(`${prefix}_daily_gift_day`) ??
          undefined,
        poemDailyGiftItems: this.readLocalValue(
          `${prefix}_daily_gift_last_items`,
        ),
      };
    } catch {
      return {};
    }
  }

  achievementPatchSignals(): AchievementPatchSignal[] {
    const hostState = this.host as unknown as Record<string, unknown>;
    return ACHIEVEMENT_PATCHES.flatMap((patch) => {
      const active =
        hostState[patch.windowFlag] === true ||
        patch.activationStorageKeys.some((key) => this.localFlag(key));
      if (!active) return [];
      return [
        {
          id: patch.id,
          opened: patch.openedStorageKeys.some((key) =>
            this.localFlag(key),
          ),
        },
      ];
    });
  }

  async chatTexts(): Promise<string[]> {
    const context = await this.context();
    const chatTexts = (context.chat ?? []).flatMap((message) => {
      const text = message.mes ?? message.message ?? message.content;
      return typeof text === 'string' && text.trim() ? [text] : [];
    });
    if (chatTexts.length > 0) return chatTexts;
    return [
      ...this.host.document.querySelectorAll<HTMLElement>('.mes .mes_text'),
    ].flatMap((element) => {
      const text = element.innerText || element.textContent || '';
      return text.trim() ? [text] : [];
    });
  }

  hasLegacyRuntime(): boolean {
    return Boolean(this.host.__CaelianRuntime);
  }

  hasMvu(): boolean {
    const mvu = this.resolveMvuApi();
    return Boolean(
      mvu &&
        typeof mvu.getMvuData === 'function' &&
        typeof mvu.replaceMvuData === 'function',
    );
  }

  readMvuData(): Record<string, unknown> | null {
    const mvu = this.resolveMvuApi();
    if (!mvu || !this.hasMvu()) return null;
    try {
      const option: MvuOption = { type: 'message', message_id: 'latest' };
      return this.clone(mvu.getMvuData(option) ?? {});
    } catch {
      return null;
    }
  }

  async writeProjection(projection: AiProjection): Promise<boolean> {
    const mvu = this.resolveMvuApi();
    if (!mvu || !this.hasMvu()) return false;

    const option: MvuOption = { type: 'message', message_id: 'latest' };
    const current = mvu.getMvuData(option) ?? {};
    const next = this.clone(current);
    const statData = this.asRecord(next.stat_data);
    const currentCaelian = this.asRecord(statData.caelian);
    const currentNarrative = this.asRecord(currentCaelian.narrative);
    const hasCurrentNarrative = Object.prototype.hasOwnProperty.call(
      currentCaelian,
      'narrative',
    );
    const isLegacyMigration = LEGACY_STAT_DATA_KEYS.some(
      (key) => key in statData,
    );

    for (const key of LEGACY_STAT_DATA_KEYS) {
      delete statData[key];
    }
    const nextCaelian: Record<string, unknown> = { ...projection };
    if (hasCurrentNarrative) {
      nextCaelian.narrative = this.clone(currentNarrative);
    } else if (!isLegacyMigration) {
      delete nextCaelian.narrative;
    }
    next.stat_data = {
      ...statData,
      caelian: nextCaelian,
    };

    if (JSON.stringify(current) === JSON.stringify(next)) return false;
    await Promise.resolve(mvu.replaceMvuData(next, option));
    return true;
  }

  subscribe(handler: TavernEventHandler): void {
    for (const eventName of [
      'caelian-special-achievement-patch',
      'caelian-launch-reward-patch',
    ]) {
      const listener = () => {
        void handler('ACHIEVEMENT_PATCH_CHANGED');
      };
      this.host.addEventListener(eventName, listener);
      this.disposers.push(() =>
        this.host.removeEventListener(eventName, listener),
      );
    }

    const tavernEventNames = [
      'CHAT_CHANGED',
      'MESSAGE_RECEIVED',
      'MESSAGE_UPDATED',
      'PERSONA_CHANGED',
      'PERSONA_UPDATED',
      'CHARACTER_EDITED',
    ] as const;
    const boundTavernEvents: Array<{
      eventOn: NonNullable<Window['eventOn']>;
      event: unknown;
    }> = [];
    let retryTimer: number | undefined;
    let cancelled = false;

    const hasBinding = (
      bindings: Array<{
        eventOn: NonNullable<Window['eventOn']>;
        event: unknown;
      }>,
      eventOn: NonNullable<Window['eventOn']>,
      event: unknown,
    ): boolean =>
      bindings.some(
        (binding) =>
          binding.eventOn === eventOn && binding.event === event,
      );

    const eventOnApis = (): Array<NonNullable<Window['eventOn']>> => {
      const candidates = this.apiScopes().flatMap((scope) =>
        typeof scope.eventOn === 'function' ? [scope.eventOn] : [],
      );
      const lexical = this.resolveLexicalEventOnApi();
      if (lexical) candidates.push(lexical);
      return candidates.filter(
        (candidate, index) => candidates.indexOf(candidate) === index,
      );
    };

    const tavernEventApis = (): Array<Record<string, unknown>> => {
      const candidates = this.apiScopes().flatMap((scope) =>
        scope.tavern_events ? [scope.tavern_events] : [],
      );
      const lexical = this.resolveLexicalTavernEventsApi();
      if (lexical) candidates.push(lexical);
      return candidates.filter(
        (candidate, index) => candidates.indexOf(candidate) === index,
      );
    };

    const bindAvailableEvents = (): void => {
      if (cancelled) return;
      const eventOns = eventOnApis();

      for (const eventOn of eventOns) {
        for (const events of tavernEventApis()) {
          for (const eventName of tavernEventNames) {
            const event = events[eventName];
            if (
              event === undefined ||
              hasBinding(boundTavernEvents, eventOn, event)
            ) {
              continue;
            }
            try {
              this.addEventDisposer(
                eventOn(event, (...args) => {
                  const payload = this.handleAvatarEvent(eventName, args);
                  void handler(eventName, payload);
                }),
              );
              boundTavernEvents.push({ eventOn, event });
            } catch {
              // Some helper frames expose event tokens owned by another bus.
            }
          }
        }
      }
    };

    const retryStartedAt = Date.now();
    const retryBinding = (): void => {
      retryTimer = undefined;
      if (cancelled) return;
      bindAvailableEvents();
      const elapsed = Date.now() - retryStartedAt;
      retryTimer = this.host.setTimeout(
        retryBinding,
        elapsed < 15_000 ? 250 : 5_000,
      );
    };

    bindAvailableEvents();
    retryTimer = this.host.setTimeout(retryBinding, 250);

    this.disposers.push(() => {
      cancelled = true;
      if (retryTimer !== undefined) this.host.clearTimeout(retryTimer);
    });
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
    if (typeof this.host.Caelian?.notify === 'function') {
      this.host.Caelian.notify({
        kind: level,
        title: 'Re∞：欧西亚斯 Alpha',
        description: message,
        duration: level === 'error' ? 7_000 : 5_000,
      });
      return;
    }
    this.host.toastr?.[level]?.(message, 'Re∞：欧西亚斯 Alpha');
  }

  private resolveHost(sourceWindow: Window): Window {
    return resolveTavernHost(sourceWindow);
  }

  private apiScopes(): Window[] {
    return this.runtime === this.host
      ? [this.host]
      : [this.host, this.runtime];
  }

  private resolveMvuApi(): MvuLike | undefined {
    for (const mvu of this.mvuApis()) {
      if (
        mvu &&
        typeof mvu.getMvuData === 'function' &&
        typeof mvu.replaceMvuData === 'function'
      ) {
        return mvu;
      }
    }
    return undefined;
  }

  private mvuApis(): MvuLike[] {
    const candidates = this.apiScopes().flatMap((scope) =>
      scope.Mvu ? [scope.Mvu] : [],
    );
    const lexical = this.resolveLexicalMvuApi();
    if (lexical) candidates.push(lexical);
    return candidates.filter(
      (candidate, index) => candidates.indexOf(candidate) === index,
    );
  }

  private resolveLexicalMvuApi(): MvuLike | undefined {
    try {
      return typeof Mvu !== 'undefined' ? Mvu : undefined;
    } catch {
      return undefined;
    }
  }

  private resolveLexicalEventOnApi(): Window['eventOn'] {
    try {
      return typeof eventOn === 'function' ? eventOn : undefined;
    } catch {
      return undefined;
    }
  }

  private resolveLexicalTavernEventsApi():
    | Record<string, unknown>
    | undefined {
    try {
      return typeof tavern_events !== 'undefined'
        ? tavern_events
        : undefined;
    } catch {
      return undefined;
    }
  }

  private resolveUserAvatar(context: TavernContext): string {
    const document = this.host.document;
    const selectedPersona = document.querySelector<HTMLElement>(
      '#user_avatar_block .avatar-container.selected',
    );
    const selectedPersonaId =
      this.userAvatarId ??
      selectedPersona?.dataset.avatarId?.trim() ??
      context.chatMetadata?.persona ??
      context.powerUserSettings?.default_persona;
    const selectedThumbnail = this.thumbnailUrl(
      context,
      'persona',
      selectedPersonaId,
    );
    if (selectedThumbnail) {
      this.userAvatarId = selectedPersonaId;
      return selectedThumbnail;
    }

    const selectedImage = selectedPersona
      ?.querySelector<HTMLImageElement>('img[src]')
      ?.getAttribute('src');
    const selectedImageUrl = this.safeAvatarUrl(selectedImage);
    if (selectedImageUrl) return selectedImageUrl;

    const messageImages = document.querySelectorAll<HTMLImageElement>(
      '.mes[is_user="true"] .avatar img[src]',
    );
    const messageImage = messageImages.item(messageImages.length - 1);
    const messageImageUrl = this.safeAvatarUrl(
      messageImage?.getAttribute('src'),
    );
    if (messageImageUrl) return messageImageUrl;

    return '';
  }

  private resolveUserAvatarOriginal(context: TavernContext): string {
    const selectedPersona = this.host.document.querySelector<HTMLElement>(
      '#user_avatar_block .avatar-container.selected',
    );
    const selectedPersonaId =
      this.userAvatarId ??
      selectedPersona?.dataset.avatarId?.trim() ??
      context.chatMetadata?.persona ??
      context.powerUserSettings?.default_persona;
    const original = this.originalAvatarUrl(
      'persona',
      selectedPersonaId,
    );
    if (original) {
      this.userAvatarId = selectedPersonaId;
      return original;
    }
    return this.safeAvatarUrl(
      selectedPersona
        ?.querySelector<HTMLImageElement>('img[src]')
        ?.getAttribute('src'),
    );
  }

  private resolveCharacterAvatar(context: TavernContext): string {
    const helperScopes =
      this.runtime === this.host
        ? [this.host]
        : [this.runtime, this.host];
    for (const scope of helperScopes) {
      try {
        const helper = scope.getCharAvatarPath?.('current');
        const helperUrl = this.safeAvatarUrl(helper);
        if (helperUrl) return helperUrl;
      } catch {
        // The helper may not be ready while Tavern is switching character data.
      }
    }

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

  private resolveCharacterAvatarOriginal(context: TavernContext): string {
    const helperScopes =
      this.runtime === this.host
        ? [this.host]
        : [this.runtime, this.host];
    for (const scope of helperScopes) {
      try {
        const helper = scope.getCharAvatarPath?.('current');
        const helperUrl = this.safeAvatarUrl(helper);
        if (helperUrl) return helperUrl;
      } catch {
        // The helper may not be ready while Tavern is switching character data.
      }
    }

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
    return (
      this.originalAvatarUrl('avatar', character?.avatar) ||
      this.resolveCharacterAvatar(context)
    );
  }

  private originalAvatarUrl(
    type: 'avatar' | 'persona',
    file: string | undefined,
  ): string {
    const value = file?.trim();
    if (!value) return '';
    if (
      value.startsWith('data:image/') ||
      value.startsWith('blob:') ||
      value.startsWith('/') ||
      /^https?:\/\//i.test(value)
    ) {
      return this.safeAvatarUrl(value);
    }
    const path =
      type === 'persona'
        ? `/User Avatars/${encodeURIComponent(value)}`
        : `/characters/${encodeURIComponent(value)}`;
    return this.safeAvatarUrl(path);
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

  private handleAvatarEvent(
    eventName: string,
    args: unknown[],
  ): TavernEventPayload | undefined {
    if (eventName === 'CHAT_CHANGED') {
      this.userAvatarUrl = undefined;
      this.characterAvatarUrl = undefined;
      this.userAvatarOriginalUrl = undefined;
      this.characterAvatarOriginalUrl = undefined;
      this.userAvatarId = undefined;
      return undefined;
    }
    if (eventName === 'PERSONA_CHANGED') {
      const avatarId =
        typeof args[0] === 'string' && args[0].trim()
          ? args[0].trim()
          : undefined;
      this.userAvatarId = avatarId;
      this.userAvatarUrl = undefined;
      this.userAvatarOriginalUrl = undefined;
      return avatarId ? { avatarId } : undefined;
    }
    if (eventName === 'PERSONA_UPDATED') {
      this.userAvatarUrl = undefined;
      this.userAvatarOriginalUrl = undefined;
      return undefined;
    }
    if (eventName === 'CHARACTER_EDITED') {
      this.characterAvatarUrl = undefined;
      this.characterAvatarOriginalUrl = undefined;
    }
    return undefined;
  }

  private addEventDisposer(value: unknown): void {
    if (typeof value === 'function') {
      this.disposers.push(value as () => void);
      return;
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      'stop' in value
    ) {
      const stop = value.stop;
      if (typeof stop === 'function') {
        this.disposers.push(() => stop.call(value));
      }
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  }

  private readLocalJson(key: string): Record<string, unknown> {
    return this.asRecord(this.readLocalValue(key));
  }

  private readLocalValue(key: string): unknown {
    try {
      return JSON.parse(this.host.localStorage.getItem(key) || '{}');
    } catch {
      return {};
    }
  }

  private localFlag(key: string): boolean {
    const value = this.host.localStorage.getItem(key);
    return value === '1' || value === 'true' || Boolean(value);
  }
}
