import type { CommandResult } from '@/domain/commands';
import {
  releaseAnnouncementId,
  releaseNotesFor,
} from '@/content/release-notes';
import type {
  ReleaseChannel,
  RuntimeInfo,
  RuntimeStatus,
} from '@/domain/types';
import { EventBus } from '@/kernel/event-bus';
import { PanelRegistry } from '@/kernel/panel-registry';
import type {
  CaelianPublicApi,
  PanelContext,
  QueryName,
  QueryResultMap,
} from '@/kernel/public-api';
import { createAiProjection } from '@/mvu/projection';
import {
  extractMvuNarrativePatch,
  hasLegacyMvuState,
  normalizeNarrativePatch,
  type MvuNarrativePatch,
} from '@/mvu/contracts';
import {
  CaelianDatabase,
  DATABASE_SCHEMA_VERSION,
} from '@/storage/database';
import { NotificationCenter } from '@/notifications/notification-center';
import type { NotificationKind } from '@/notifications/types';
import { GameRepository } from '@/storage/repository';
import {
  TavernAdapter,
  type TavernEventPayload,
} from '@/tavern/adapter';
import {
  ManagedContentUpdater,
  type ManagedContentSyncResult,
} from '@/content-updates/managed-content';

interface KernelOptions {
  channel: ReleaseChannel;
  version: string;
  buildId: string;
  databaseName?: string;
  sourceWindow?: Window;
}

export class CaelianKernel {
  readonly api: CaelianPublicApi;
  private readonly channel: 'alpha';
  private readonly version: string;
  private readonly buildId: string;
  private readonly adapter: TavernAdapter;
  private readonly db: CaelianDatabase;
  private readonly repository: GameRepository;
  private readonly events = new EventBus();
  private readonly panels: PanelRegistry;
  private readonly notifications: NotificationCenter;
  private readonly managedContent: ManagedContentUpdater;
  private readonly stateDisposers: Array<() => void> = [];
  private status: RuntimeStatus = 'starting';
  private profileId?: string;
  private lastError?: string;
  private projectionQueue: Promise<boolean> = Promise.resolve(false);
  private projectionWriteInProgress = false;
  private mvuIngestDepth = 0;
  private managedContentTimer?: number;
  private readonly pendingTavernUpdates = new Set<Promise<void>>();

  constructor(options: KernelOptions) {
    if (options.channel !== 'alpha') {
      throw new Error('当前构建只允许 Alpha 通道');
    }
    this.channel = options.channel;
    this.version = options.version;
    this.buildId = options.buildId;
    this.adapter = new TavernAdapter(options.sourceWindow);
    this.db = new CaelianDatabase(
      this.channel,
      options.databaseName ?? `caelian-${this.channel}-v2`,
    );
    this.repository = new GameRepository(this.db, this.events);

    const panelContext: PanelContext = {
      api: this.createPanelApi(),
      document: this.adapter.host.document,
    };
    this.panels = new PanelRegistry(panelContext, this.events);
    this.notifications = new NotificationCenter(
      this.adapter.host.document,
    );
    this.managedContent = new ManagedContentUpdater(this.adapter.host);
    this.api = this.createPublicApi();
  }

  async initialize(): Promise<void> {
    this.notifications.mount();
    if (this.adapter.hasLegacyRuntime()) {
      this.status = 'blocked-by-legacy';
      this.lastError = '检测到旧版 __CaelianRuntime；Alpha 已停止写入。';
      this.notifyRuntime('error', this.lastError, '旧版脚本仍在运行');
      await this.panels.open('shell');
      return;
    }

    try {
      this.stateDisposers.push(
        this.events.on('achievement.unlocked', (notice) => {
          this.notifications.show({
            kind: 'achievement',
            icon: '♛',
            title: notice.name,
            description: notice.description,
            meta: '★'.repeat(notice.stars),
            duration: 6_200,
            onClick: () => this.panels.navigate('achievements'),
          });
        }),
      );
      await this.activateCurrentProfile();
      await this.ingestMvuNarrative();
      await this.scanCurrentAchievements();
      this.stateDisposers.push(
        this.events.on('state.changed', async () => {
          if (this.mvuIngestDepth > 0) return;
          await this.syncProjection();
        }),
      );
      this.adapter.subscribe((eventName, payload) => {
        this.queueTavernUpdate(eventName, payload);
      });
      this.status = 'ready';
      await this.syncProjection();
      await this.panels.open('shell');
      await this.openReleaseNotesIfNew();
      await this.openAchievementSpecialIfNeeded();
      this.startManagedContentUpdates();
      await this.events.emit('runtime.ready', this.getRuntimeInfo());
    } catch (error) {
      this.status = 'error';
      this.lastError =
        error instanceof Error ? error.message : String(error);
      this.notifyRuntime('error', this.lastError);
      throw error;
    }
  }

  getRuntimeInfo(): RuntimeInfo {
    return {
      channel: this.channel,
      version: this.version,
      buildId: this.buildId,
      databaseName: this.db.name,
      databaseVersion: DATABASE_SCHEMA_VERSION,
      status: this.status,
      profileId: this.profileId,
      mvuAvailable: this.adapter.hasMvu(),
      lastError: this.lastError,
    };
  }

  async execute(command: unknown): Promise<CommandResult> {
    if (this.status !== 'ready' || !this.profileId) {
      return {
        id: this.commandId(command),
        status: 'rejected',
        message: this.lastError ?? 'Alpha 内核尚未就绪',
      };
    }
    try {
      return await this.repository.execute(this.profileId, command);
    } catch (error) {
      return {
        id: this.commandId(command),
        status: 'rejected',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async query<K extends QueryName>(name: K): Promise<QueryResultMap[K]> {
    if (name === 'runtime') {
      return this.getRuntimeInfo() as QueryResultMap[K];
    }
    if (!this.profileId) {
      throw new Error(this.lastError ?? '当前没有活动档案');
    }
    if (name === 'events') {
      return (await this.repository.recentEvents(
        this.profileId,
      )) as QueryResultMap[K];
    }
    if (name === 'achievement-special') {
      return (await this.repository.achievementSpecialState(
        this.profileId,
      )) as QueryResultMap[K];
    }
    if (name === 'mailbox') {
      return (await this.repository.mailboxState(
        this.profileId,
      )) as QueryResultMap[K];
    }
    if (name === 'market') {
      return (await this.repository.marketState(
        this.profileId,
      )) as QueryResultMap[K];
    }
    const snapshot = await this.repository.snapshot(this.profileId);
    if (name === 'inventory') {
      return snapshot.inventory as QueryResultMap[K];
    }
    return snapshot as QueryResultMap[K];
  }

  async syncProjection(): Promise<boolean> {
    const task = this.projectionQueue
      .catch(() => false)
      .then(() => this.performProjectionSync());
    this.projectionQueue = task;
    return task;
  }

  private async performProjectionSync(): Promise<boolean> {
    if (this.status !== 'ready' || !this.profileId) return false;
    const snapshot = await this.repository.snapshot(this.profileId);
    const projection = createAiProjection(snapshot, this.channel);
    this.projectionWriteInProgress = true;
    let written: boolean;
    try {
      written = await this.adapter.writeProjection(projection);
    } finally {
      this.projectionWriteInProgress = false;
    }
    if (written) {
      await this.events.emit('projection.synced', {
        revision: projection._meta.revision,
      });
    }
    return written;
  }

  async shutdown(): Promise<void> {
    if (this.status === 'stopped') return;
    await this.panels.closeAll();
    this.notifications.destroy();
    this.adapter.unsubscribeAll();
    if (this.managedContentTimer !== undefined) {
      this.adapter.host.clearInterval(this.managedContentTimer);
      this.managedContentTimer = undefined;
    }
    await Promise.all([...this.pendingTavernUpdates]);
    for (const dispose of this.stateDisposers.splice(0)) dispose();
    this.db.close();
    this.status = 'stopped';
    await this.events.emit('runtime.stopped', this.getRuntimeInfo());
    this.events.clear();
  }

  private queueTavernUpdate(
    eventName: string,
    payload?: TavernEventPayload,
  ): void {
    const task = this.handleTavernUpdate(eventName, payload)
      .catch((error) => {
        if (this.status === 'stopped') return;
        this.lastError =
          error instanceof Error ? error.message : String(error);
        this.notifyRuntime(
          'error',
          this.lastError,
          '酒馆变量更新同步失败',
        );
      })
      .finally(() => {
        this.pendingTavernUpdates.delete(task);
      });
    this.pendingTavernUpdates.add(task);
  }

  private async handleTavernUpdate(
    eventName: string,
    payload?: TavernEventPayload,
  ): Promise<void> {
    if (eventName === 'ACHIEVEMENT_PATCH_CHANGED') {
      await this.syncAchievementPatches();
      await this.events.emit('tavern.changed', { event: eventName });
      return;
    }
    if (
      eventName === 'PERSONA_CHANGED' ||
      eventName === 'PERSONA_UPDATED' ||
      eventName === 'CHARACTER_EDITED'
    ) {
      await this.events.emit('tavern.changed', { event: eventName });
      return;
    }
    if (
      (eventName === 'MESSAGE_UPDATED' ||
        eventName === 'MVU_VARIABLE_UPDATE_ENDED') &&
      this.projectionWriteInProgress
    ) {
      return;
    }
    if (eventName === 'CHAT_CHANGED') {
      await this.activateCurrentProfile();
    }
    await this.ingestMvuNarrative(
      payload?.mvuData,
      payload?.managerMvuData,
      payload?.previousMvuData,
    );
    await this.scanCurrentAchievements();
    if (eventName !== 'MVU_VARIABLE_UPDATE_ENDED') {
      await this.syncProjection();
    }
    await this.events.emit('tavern.changed', { event: eventName });
  }

  private createPublicApi(): CaelianPublicApi {
    return {
      channel: 'alpha',
      version: this.version,
      buildId: this.buildId,
      bridgeApi: 1,
      getRuntimeInfo: () => this.getRuntimeInfo(),
      execute: (command) => this.execute(command),
      query: (name) => this.query(name),
      openPanel: (panel) => this.panels.open(panel),
      navigatePanel: (panel) => this.panels.navigate(panel),
      closePanel: (panel) => this.panels.close(panel),
      listOpenPanels: () => this.panels.list(),
      getAvatarUrls: (options) => this.adapter.avatarUrls(options),
      setUserInput: (text) => this.adapter.setUserInput(text),
      notify: (input) => this.notifications.show(input),
      confirm: (input) => this.notifications.confirm(input),
      syncProjection: () => this.syncProjection(),
      syncManagedContent: (options) =>
        this.syncManagedContent(options?.force ?? true),
      getManagedContentAutoUpdate: () =>
        this.managedContent.autoUpdateEnabled(),
      setManagedContentAutoUpdate: (enabled) =>
        this.managedContent.setAutoUpdateEnabled(enabled),
      on: (event, handler) => this.events.on(event, handler),
      shutdown: () => this.shutdown(),
    };
  }

  private createPanelApi(): PanelContext['api'] {
    return {
      getRuntimeInfo: () => this.getRuntimeInfo(),
      execute: (command) => this.execute(command),
      query: (name) => this.query(name),
      openPanel: (panel) => this.panels.open(panel),
      navigatePanel: (panel) => this.panels.navigate(panel),
      closePanel: (panel) => this.panels.close(panel),
      getAvatarUrls: (options) => this.adapter.avatarUrls(options),
      setUserInput: (text) => this.adapter.setUserInput(text),
      notify: (input) => this.notifications.show(input),
      confirm: (input) => this.notifications.confirm(input),
      syncProjection: () => this.syncProjection(),
      syncManagedContent: (options) =>
        this.syncManagedContent(options?.force ?? true),
      getManagedContentAutoUpdate: () =>
        this.managedContent.autoUpdateEnabled(),
      setManagedContentAutoUpdate: (enabled) =>
        this.managedContent.setAutoUpdateEnabled(enabled),
      on: (event, handler) => this.events.on(event, handler),
    };
  }

  private async activateCurrentProfile(): Promise<void> {
    const identity = await this.adapter.identity();
    const profile = await this.repository.resolveProfile(
      identity.chatId,
      {
        playerName: identity.playerName,
        legacyPreserveAdventureSave:
          this.adapter.legacyPreserveAdventureSave(),
      },
    );
    this.profileId = profile.id;
    await this.repository.importLegacyAchievements(
      profile.id,
      this.adapter.legacyAchievementPayload(),
    );
    await this.syncAchievementPatches();
  }

  private async syncAchievementPatches(): Promise<void> {
    if (!this.profileId) return;
    const result = await this.repository.syncPatchEntitlements(
      this.profileId,
      this.adapter.achievementPatchSignals(),
    );
    if (result.receivedMailIds.length > 0) {
      this.notifications.show({
        kind: 'info',
        icon: '✉',
        title: '收到新的特殊邮件',
        description: `邮箱中新增 ${result.receivedMailIds.length} 封可永久重读的信件。`,
        meta: '补丁成就奖励只会结算一次',
        duration: 7_000,
        onClick: () => this.panels.navigate('mailbox'),
      });
    }
  }

  private async scanCurrentAchievements(): Promise<void> {
    if (!this.profileId) return;
    await this.repository.scanAchievements(
      this.profileId,
      await this.adapter.chatTexts(),
    );
  }

  private async ingestMvuNarrative(
    eventMvuData?: Record<string, unknown>,
    managerMvuData?: Record<string, unknown>,
    previousMvuData?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.profileId) return;
    const fallbackMvuData =
      managerMvuData ?? this.adapter.readMvuData() ?? undefined;
    const eventPatch = this.extractNormalizedNarrative(eventMvuData);
    const previousPatch = this.extractNormalizedNarrative(previousMvuData);
    const fallbackPatch = this.extractNormalizedNarrative(fallbackMvuData);
    const eventRepeatsPrevious =
      eventPatch !== null &&
      previousPatch !== null &&
      this.hashJson(eventPatch) === this.hashJson(previousPatch);
    const fallbackDiffersFromPrevious =
      fallbackPatch !== null &&
      (previousPatch === null ||
        this.hashJson(fallbackPatch) !== this.hashJson(previousPatch));
    const useFallback =
      eventPatch === null ||
      (eventRepeatsPrevious && fallbackDiffersFromPrevious);
    const mvuData = useFallback ? fallbackMvuData : eventMvuData;
    const patch = useFallback ? fallbackPatch : eventPatch;
    if (!mvuData) return;

    if (hasLegacyMvuState(mvuData)) {
      await this.repository.archiveLegacyMvu(this.profileId, mvuData);
    }

    if (!patch) return;
    const snapshot = await this.repository.snapshot(this.profileId);
    const changed = this.changedNarrativePatch(patch, snapshot);
    if (!changed) return;

    this.mvuIngestDepth += 1;
    try {
      await this.repository.execute(this.profileId, {
        id: `mvu-narrative:${this.hashJson(this.profileId)}:${snapshot.profile.updatedAt}:${this.hashJson(changed)}`,
        type: 'narrative.update',
        payload: changed,
      });
    } finally {
      this.mvuIngestDepth -= 1;
    }
  }

  private extractNormalizedNarrative(
    mvuData?: Record<string, unknown>,
  ): MvuNarrativePatch | null {
    if (!mvuData) return null;
    const extracted = extractMvuNarrativePatch(mvuData);
    return extracted ? normalizeNarrativePatch(extracted) : null;
  }

  private changedNarrativePatch(
    patch: MvuNarrativePatch,
    snapshot: Awaited<ReturnType<GameRepository['snapshot']>>,
  ): MvuNarrativePatch | null {
    const companion = patch.companion
      ? Object.fromEntries(
          Object.entries(patch.companion).filter(
            ([key, value]) =>
              snapshot.social[key as keyof typeof patch.companion] !== value,
          ),
        )
      : {};
    const world = patch.world
      ? Object.fromEntries(
          Object.entries(patch.world).filter(
            ([key, value]) =>
              snapshot.world[key as keyof typeof patch.world] !== value,
          ),
        )
      : {};
    const currentFlags = new Map(
      snapshot.storyFlags.map((flag) => [flag.key, flag.value]),
    );
    const storyFlags = patch.storyFlags
      ? Object.fromEntries(
          Object.entries(patch.storyFlags).filter(
            ([key, value]) => (currentFlags.get(key) ?? false) !== value,
          ),
        )
      : {};

    if (
      Object.keys(companion).length === 0 &&
      Object.keys(world).length === 0 &&
      Object.keys(storyFlags).length === 0
    ) {
      return null;
    }
    return {
      ...(Object.keys(companion).length > 0 ? { companion } : {}),
      ...(Object.keys(world).length > 0 ? { world } : {}),
      ...(Object.keys(storyFlags).length > 0 ? { storyFlags } : {}),
    };
  }

  private hashJson(value: unknown): string {
    const source = JSON.stringify(value);
    let hash = 2_166_136_261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
    return (hash >>> 0).toString(36);
  }

  private startManagedContentUpdates(): void {
    void this.syncManagedContent(false);
    this.managedContentTimer = this.adapter.host.setInterval(
      () => void this.syncManagedContent(false),
      10 * 60 * 1_000,
    );
  }

  private async syncManagedContent(
    force: boolean,
  ): Promise<ManagedContentSyncResult> {
    const result = await this.managedContent.sync({ force });
    if (result.applied > 0) {
      this.notifyRuntime(
        'success',
        `已安全更新 ${result.applied} 项角色卡/世界书内容。`,
        '凯利安内容更新完成',
      );
    }
    if (result.conflicts.length > 0 && force) {
      this.notifyRuntime(
        'warning',
        `${result.conflicts.length} 项内容与玩家修改冲突，已保留玩家版本。`,
        '凯利安内容更新已暂停',
      );
    }
    return result;
  }

  private async openReleaseNotesIfNew(): Promise<void> {
    if (releaseNotesFor(this.version).length === 0) return;

    const announcementId = releaseAnnouncementId(this.version);
    try {
      const existing = await this.db.contentVersions.get(announcementId);
      if (existing) return;
    } catch {
      // Without a reliable read, do not risk showing the same notice repeatedly.
      return;
    }

    try {
      await this.panels.open('release-notes');
    } catch {
      // A failed mount must not be recorded as a notice the player has seen.
      return;
    }

    try {
      await this.db.contentVersions.put({
        id: announcementId,
        version: this.version,
        buildId: this.buildId,
        sourceHash: 'release-notes',
        updatedAt: Date.now(),
      });
    } catch {
      // The visible notice is still useful when persistence is unavailable.
    }
  }

  private async openAchievementSpecialIfNeeded(): Promise<void> {
    if (!this.profileId) return;
    const state = await this.repository.achievementSpecialState(
      this.profileId,
    );
    if (state.letterClaimed && !state.dailyGiftAvailable) return;
    await this.panels.open('achievement-letter');
  }

  private commandId(input: unknown): string {
    if (typeof input === 'object' && input !== null && 'id' in input) {
      return String(input.id);
    }
    return 'unknown-command';
  }

  private notifyRuntime(
    kind: Extract<NotificationKind, 'info' | 'success' | 'warning' | 'error'>,
    message: string,
    title = 'Re∞：欧西亚斯 Alpha',
  ): void {
    this.notifications.show({
      kind,
      title,
      description: message,
      duration: kind === 'error' ? 7_000 : 5_000,
    });
  }
}

export function createKernel(options: KernelOptions): CaelianKernel {
  return new CaelianKernel(options);
}
