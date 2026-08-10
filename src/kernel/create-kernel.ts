import type { CommandResult } from '@/domain/commands';
import {
  releaseAnnouncementId,
  releaseNotesFor,
} from '@/content/release-notes';
import type {
  QuestCompletionResult,
  QuestRecord,
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
  QuestJudgeStatus,
  TrackedQuestView,
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
  QuestCatalogLoader,
  type QuestListEntry,
} from '@/quests/catalog';
import {
  fetchOpenAiCompatibleModels,
  OpenAiCompatibleQuestJudgeClient,
  resolveChatEndpoint,
  type OpenAiCompatibleJudgeConfig,
  type QuestJudgeModel,
  type QuestJudgeModelListConfig,
} from '@/quests/judge-client';
import {
  clearQuestJudgePreferences,
  loadQuestJudgePreferences,
  saveQuestJudgePreferences,
} from '@/quests/judge-preferences';
import {
  buildCurrentNodeContext,
  buildQuestPlayerGuidance,
  buildQuestNavigationContext,
} from '@/quests/prompt-builder';
import { questNode, type QuestDefinition } from '@/quests/schema';
import { initialQuestProgress } from '@/quests/state-machine';
import {
  questLocationMatches,
  QuestTrackerService,
} from '@/quests/tracker-service';
import { QuestProgressRepository } from '@/storage/repositories/quest-progress-repository';
import {
  TavernAdapter,
  type TavernEventPayload,
} from '@/tavern/adapter';
import {
  ManagedContentUpdater,
  type ManagedContentSyncResult,
} from '@/content-updates/managed-content';
import { SurveyService } from '@/surveys/survey-service';
import type {
  SurveyCatalogSyncResult,
  SurveyDefinition,
} from '@/surveys/types';
import {
  RegionWorldbookSwitcher,
} from '@/worldbook/region-switcher';
import {
  formatStoryBattleResult,
  parseStoryBattleStart,
} from '@/battle/story-bridge';

const SURVEY_POLL_INTERVAL_MS = 2 * 60 * 1_000;

interface KernelOptions {
  channel: Extract<ReleaseChannel, 'alpha' | 'beta'>;
  version: string;
  buildId: string;
  databaseName?: string;
  sourceWindow?: Window;
}

interface QuestEvaluationPresentation {
  questId: string;
  transitionAccepted: boolean;
  summary: string;
}

export class CaelianKernel {
  readonly api: CaelianPublicApi;
  private readonly channel: Extract<ReleaseChannel, 'alpha' | 'beta'>;
  private readonly version: string;
  private readonly buildId: string;
  private readonly adapter: TavernAdapter;
  private readonly db: CaelianDatabase;
  private readonly repository: GameRepository;
  private readonly events = new EventBus();
  private readonly panels: PanelRegistry;
  private readonly notifications: NotificationCenter;
  private readonly managedContent: ManagedContentUpdater;
  private readonly surveys: SurveyService;
  private readonly questCatalogs: QuestCatalogLoader;
  private readonly questProgress: QuestProgressRepository;
  private readonly regionWorldbook: RegionWorldbookSwitcher;
  private readonly stateDisposers: Array<() => void> = [];
  private status: RuntimeStatus = 'starting';
  private profileId?: string;
  private lastError?: string;
  private projectionQueue: Promise<boolean> = Promise.resolve(false);
  private projectionWriteInProgress = false;
  private mvuIngestDepth = 0;
  private managedContentTimer?: number;
  private surveyTimer?: number;
  private surveyPromptActive = false;
  private questTracker?: QuestTrackerService;
  private questJudgeApiKey?: string;
  private questJudge: QuestJudgeStatus = {
    configured: false,
    apiKeyPresent: false,
  };
  private shuttingDown = false;
  private readonly promptedSurveyIds = new Set<string>();
  private readonly pendingTavernUpdates = new Set<Promise<void>>();
  private tavernUpdateQueue: Promise<void> = Promise.resolve();
  private readonly handledStoryBattleFloors = new Set<string>();

  constructor(options: KernelOptions) {
    this.channel = options.channel;
    this.version = options.version;
    this.buildId = options.buildId;
    this.adapter = new TavernAdapter(
      options.sourceWindow,
      this.channel === 'beta' ? 'Beta' : 'Alpha',
    );
    this.regionWorldbook = new RegionWorldbookSwitcher(
      () => this.adapter.regionWorldbookApi(),
      () => this.adapter.currentCharacterName(),
    );
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
    this.managedContent = new ManagedContentUpdater(
      this.adapter.host,
      this.channel,
    );
    this.surveys = new SurveyService(
      this.db,
      this.adapter.host,
      this.channel,
    );
    this.questCatalogs = new QuestCatalogLoader(this.adapter.host);
    this.questProgress = new QuestProgressRepository(this.db);
    const savedQuestJudge = loadQuestJudgePreferences(this.adapter.host);
    if (savedQuestJudge) this.configureQuestJudge(savedQuestJudge);
    this.api = this.createPublicApi();
  }

  async initialize(): Promise<void> {
    this.notifications.mount();
    if (this.adapter.hasLegacyRuntime()) {
      this.status = 'blocked-by-legacy';
      this.lastError = `检测到旧版 __CaelianRuntime；${this.channelLabel()} 已停止写入。`;
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
      await this.initializeWorldbook();
      await this.syncQuestContext();
      await this.scanCurrentAchievements();
      this.stateDisposers.push(
        this.events.on('state.changed', async () => {
          if (this.mvuIngestDepth > 0) return;
          await this.syncProjection();
        }),
      );
      this.stateDisposers.push(
        this.events.on('panel.closed', () => {
          void this.offerPendingSurvey();
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
      this.startSurveyUpdates();
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
        message: this.lastError ?? `${this.channelLabel()} 内核尚未就绪`,
      };
    }
    try {
      const type = this.commandType(command);
      const battleBeforeFinish =
        type === 'battle.finish'
          ? (await this.repository.snapshot(this.profileId)).battle
          : null;
      const result = await this.repository.execute(this.profileId, command);
      if (
        result.status === 'applied' &&
        type === 'battle.finish' &&
        battleBeforeFinish?.storyTriggered === true
      ) {
        const currentInput = this.adapter.currentInputText().trim();
        const battleResult = formatStoryBattleResult(battleBeforeFinish);
        const filled = this.adapter.setUserInput(
          currentInput ? `${currentInput}\n\n${battleResult}` : battleResult,
        );
        this.notifyRuntime(
          filled ? 'success' : 'warning',
          filled
            ? '战斗结果已写入聊天框，发送后主 API 会继续当前剧情。'
            : '战斗已结束，但没有找到酒馆输入框；可重新打开战斗记录查看结果。',
          '剧情战斗结果',
        );
      }
      if (
        result.status === 'applied' &&
        type &&
        ['inventory.adjust', 'battle.use-item', 'battle.finish'].includes(type)
      ) {
        await this.advanceTrackedQuestFromLocalState();
      }
      if (
        result.status === 'applied' &&
        type &&
        [
          'world.move',
          'quest.abandon',
          'inventory.adjust',
          'battle.use-item',
          'battle.finish',
        ].includes(type)
      ) {
        await this.syncQuestContext();
      }
      return result;
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

  configureQuestJudge(
    config: OpenAiCompatibleJudgeConfig | null,
  ): void {
    if (!config) {
      this.questTracker = undefined;
      this.questJudgeApiKey = undefined;
      this.questJudge = { configured: false, apiKeyPresent: false };
      clearQuestJudgePreferences(this.adapter.host);
      return;
    }
    const endpoint = resolveChatEndpoint(config.endpoint);
    const model = config.model.trim();
    if (!endpoint || !model) {
      throw new Error('副 API 地址和模型不能为空');
    }
    const modelsEndpoint = config.modelsEndpoint?.trim() || undefined;
    const apiKey = config.apiKey?.trim() || this.questJudgeApiKey;
    const resolvedConfig: OpenAiCompatibleJudgeConfig = {
      ...config,
      endpoint,
      ...(modelsEndpoint ? { modelsEndpoint } : {}),
      model,
      ...(apiKey ? { apiKey } : {}),
    };
    const client = new OpenAiCompatibleQuestJudgeClient(
      resolvedConfig,
      (input, init) => this.adapter.host.fetch(input, init),
    );
    this.questTracker = new QuestTrackerService(
      this.questProgress,
      client,
    );
    this.questJudgeApiKey = apiKey;
    this.questJudge = {
      configured: true,
      endpoint,
      ...(modelsEndpoint ? { modelsEndpoint } : {}),
      model,
      jsonMode: config.jsonMode !== false,
      apiKeyPresent: Boolean(apiKey),
    };
    saveQuestJudgePreferences(this.adapter.host, resolvedConfig);
  }

  getQuestJudgeStatus(): QuestJudgeStatus {
    return { ...this.questJudge };
  }

  fetchQuestJudgeModels(
    config: QuestJudgeModelListConfig,
  ): Promise<QuestJudgeModel[]> {
    const apiKey = config.apiKey?.trim() || this.questJudgeApiKey;
    return fetchOpenAiCompatibleModels(
      {
        ...config,
        ...(apiKey ? { apiKey } : {}),
      },
      (input, init) => this.adapter.host.fetch(input, init),
    );
  }

  async listAvailableQuests(
    options: { refresh?: boolean } = {},
  ): Promise<QuestListEntry[]> {
    const profileId = this.requireProfile();
    const [catalog, snapshot] = await Promise.all([
      this.questCatalogs.load({ force: options.refresh }),
      this.repository.snapshot(profileId),
    ]);
    const activeQuestIds = new Set(
      snapshot.quests.flatMap((quest) =>
        quest.definitionId ? [quest.definitionId] : [],
      ),
    );
    const completedQuestIds = new Set(
      snapshot.questHistory.flatMap((quest) =>
        quest.definitionId ? [quest.definitionId] : [],
      ),
    );
    return catalog.listAvailable({
      region: snapshot.world.region,
      location: snapshot.world.location,
      level: snapshot.player.level,
      activeQuestIds,
      completedQuestIds,
    });
  }

  async acceptManagedQuest(
    definitionId: string,
  ): Promise<TrackedQuestView> {
    this.notifications.clearQuestGuidance();
    const profileId = this.requireProfile();
    const [catalog, snapshot] = await Promise.all([
      this.questCatalogs.load(),
      this.repository.snapshot(profileId),
    ]);
    const definition = catalog.get(definitionId);
    if (!definition) throw new Error('任务定义不存在');
    const available = catalog.available({
      region: snapshot.world.region,
      location: snapshot.world.location,
      level: snapshot.player.level,
      activeQuestIds: new Set(
        snapshot.quests.flatMap((quest) =>
          quest.definitionId ? [quest.definitionId] : [],
        ),
      ),
      completedQuestIds: new Set(
        snapshot.questHistory.flatMap((quest) =>
          quest.definitionId ? [quest.definitionId] : [],
        ),
      ),
    });
    if (!available.some((quest) => quest.id === definition.id)) {
      throw new Error('该任务当前不可接取，请检查所在地区和等级');
    }

    const quest = await this.repository.acceptQuestDefinition(
      profileId,
      definition,
    );
    const tracker = await this.repository.selectTrackedQuest(
      profileId,
      quest.id,
      initialQuestProgress(definition),
    );
    const target = questNode(definition, definition.startNodeId).locations[0];
    this.adapter.setUserInput(
      target
        ? `已接取任务「${definition.name}」，前往${target}。`
        : `已接取任务「${definition.name}」。`,
    );
    await this.syncQuestContext();
    await this.syncProjection();
    await this.events.emit('quest.tracking-changed', {
      questId: quest.id,
      trackerState: tracker.current.trackerState,
    });
    return this.trackedQuestView(profileId, quest, tracker, definition);
  }

  async trackQuest(questId: string): Promise<TrackedQuestView> {
    this.notifications.clearQuestGuidance();
    const profileId = this.requireProfile();
    const quest = await this.requireManagedQuest(profileId, questId);
    const definition = await this.questDefinition(quest);
    let tracker = await this.repository.selectTrackedQuest(
      profileId,
      quest.id,
      initialQuestProgress(definition),
    );
    if (quest.status === 'active') {
      await this.advanceTrackedQuestFromLocalState();
      tracker =
        (await this.repository.selectedQuestTracker(profileId)) ?? tracker;
    }
    const currentQuest = await this.requireManagedQuest(profileId, quest.id);
    await this.syncQuestContext();
    await this.events.emit('quest.tracking-changed', {
      questId: quest.id,
      trackerState: tracker.current.trackerState,
    });
    return this.trackedQuestView(
      profileId,
      currentQuest,
      tracker,
      definition,
    );
  }

  async pauseTrackedQuest(): Promise<TrackedQuestView | null> {
    this.notifications.clearQuestGuidance();
    const profileId = this.requireProfile();
    const tracker = await this.repository.pauseTrackedQuest(profileId);
    if (!tracker) return null;
    const quest = await this.requireManagedQuest(
      profileId,
      tracker.questId,
    );
    await this.syncQuestContext();
    await this.events.emit('quest.tracking-changed', {
      questId: quest.id,
      trackerState: tracker.current.trackerState,
    });
    return this.trackedQuestView(profileId, quest, tracker);
  }

  async resumeTrackedQuest(): Promise<TrackedQuestView | null> {
    const profileId = this.requireProfile();
    let tracker = await this.repository.resumeTrackedQuest(profileId);
    if (!tracker) return null;
    await this.advanceTrackedQuestFromLocalState();
    tracker =
      (await this.repository.selectedQuestTracker(profileId)) ?? tracker;
    const quest = await this.requireManagedQuest(
      profileId,
      tracker.questId,
    );
    await this.syncQuestContext();
    await this.events.emit('quest.tracking-changed', {
      questId: quest.id,
      trackerState: tracker.current.trackerState,
    });
    return this.trackedQuestView(profileId, quest, tracker);
  }

  async getTrackedQuest(): Promise<TrackedQuestView | null> {
    const profileId = this.requireProfile();
    const tracker = await this.repository.selectedQuestTracker(profileId);
    if (!tracker) return null;
    const quest = await this.requireManagedQuest(
      profileId,
      tracker.questId,
    );
    return this.trackedQuestView(profileId, quest, tracker);
  }

  async submitTrackedQuestAction(): Promise<TrackedQuestView> {
    return this.performTrackedQuestAction();
  }

  async performTrackedQuestAction(): Promise<TrackedQuestView> {
    this.notifications.clearQuestGuidance();
    const profileId = this.requireProfile();
    const tracker = await this.repository.selectedQuestTracker(profileId);
    if (!tracker) throw new Error('当前没有正在追踪的任务');
    const quest = await this.requireManagedQuest(profileId, tracker.questId);
    const definition = await this.questDefinition(quest);
    const node = questNode(definition, tracker.current.currentNodeId);
    const action = node.requiredAction;
    if (!action) throw new Error('当前任务节点没有需要提交的本地动作');
    if (action.openPanel) {
      await this.panels.open(action.openPanel);
    }
    if (action.type === 'start_battle') {
      if (!action.monsterId) throw new Error('当前任务战斗缺少怪物编号');
      const result = await this.execute({
        id: `quest-battle:${quest.id}:${action.monsterId}:${Date.now()}`,
        type: 'battle.start',
        payload: {
          monsterId: action.monsterId,
          count: action.battleCount ?? 1,
          source: action.battleReason ?? `任务：${quest.title}`,
          relatedQuestId: quest.id,
        },
      });
      if (result.status !== 'applied') {
        throw new Error(result.message ?? '任务战斗启动失败');
      }
      await this.panels.open('battle');
      return this.trackedQuestView(profileId, quest, tracker, definition);
    }
    if (!action.transitionId) throw new Error('当前任务动作缺少本地跳转');
    const floor = await this.currentAssistantFloor();
    if (!floor) throw new Error('当前对话中没有可绑定任务进度的 AI 楼层');
    let updated = await this.repository.applyLocalQuestTransition(
      profileId,
      {
        questId: quest.id,
        definition,
        transitionId: action.transitionId,
        floor,
        mode: action.type === 'submit_item' ? 'submit' : 'action',
      },
    );
    await this.advanceTrackedQuestFromLocalState();
    updated =
      (await this.repository.selectedQuestTracker(profileId)) ?? updated;
    const updatedQuest = await this.requireManagedQuest(profileId, quest.id);
    await this.syncQuestContext();
    await this.syncProjection();
    await this.events.emit('quest.tracking-changed', {
      questId: quest.id,
      trackerState: updated.current.trackerState,
    });
    return this.trackedQuestView(
      profileId,
      updatedQuest,
      updated,
      definition,
    );
  }

  async completeTrackedQuest(): Promise<QuestCompletionResult> {
    this.notifications.clearQuestGuidance();
    const profileId = this.requireProfile();
    const tracker = await this.repository.selectedQuestTracker(profileId);
    if (!tracker) throw new Error('当前没有等待结算的任务');
    const quest = await this.requireManagedQuest(profileId, tracker.questId);
    if (quest.status !== 'ready') throw new Error('当前任务尚未达到结算条件');
    const definition = await this.questDefinition(quest);
    const result = await this.repository.completeQuestDefinition(
      profileId,
      definition,
    );
    await this.syncQuestContext();
    await this.syncProjection();
    await this.events.emit('quest.tracking-changed', {
      trackerState: 'none',
    });
    return result;
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
    this.shuttingDown = true;
    if (this.surveyTimer !== undefined) {
      this.adapter.host.clearInterval(this.surveyTimer);
      this.surveyTimer = undefined;
    }
    await this.panels.closeAll();
    this.notifications.destroy();
    this.adapter.unsubscribeAll();
    if (this.managedContentTimer !== undefined) {
      this.adapter.host.clearInterval(this.managedContentTimer);
      this.managedContentTimer = undefined;
    }
    await Promise.all([...this.pendingTavernUpdates]);
    await this.adapter.setQuestContext('');
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
    const task = this.tavernUpdateQueue
      .catch(() => undefined)
      .then(() => this.handleTavernUpdate(eventName, payload))
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
    this.tavernUpdateQueue = task;
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
      eventName === 'MESSAGE_UPDATED' &&
      this.projectionWriteInProgress
    ) {
      return;
    }
    if (eventName === 'CHAT_CHANGED') {
      this.notifications.clearQuestGuidance();
      await this.activateCurrentProfile();
      this.handledStoryBattleFloors.clear();
      await this.initializeWorldbook();
    }
    await this.reconcileQuestFloors(eventName, payload);
    await this.ingestMvuNarrative();
    if (eventName === 'MESSAGE_RECEIVED') {
      await this.triggerStoryBattle(payload);
      const evaluation = await this.evaluateTrackedQuest(payload);
      await this.advanceTrackedQuestFromLocalState();
      if (evaluation) await this.presentQuestGuidance(evaluation);
    }
    await this.syncQuestContext();
    await this.scanCurrentAchievements();
    await this.syncProjection();
    await this.events.emit('tavern.changed', { event: eventName });
  }

  private async triggerStoryBattle(
    payload?: TavernEventPayload,
  ): Promise<void> {
    if (!this.profileId) return;
    const floors = await this.adapter.chatFloors();
    if (!floors?.length) return;
    const floor =
      (payload?.messageId === undefined
        ? undefined
        : floors.find((entry) => entry.index === payload.messageId)) ??
      [...floors].reverse().find((entry) => entry.role === 'assistant');
    if (!floor || floor.role !== 'assistant' || !floor.text) return;
    const request = parseStoryBattleStart(floor.text);
    if (!request || this.handledStoryBattleFloors.has(floor.id)) return;
    this.handledStoryBattleFloors.add(floor.id);
    const snapshot = await this.repository.snapshot(this.profileId);
    if (snapshot.battle) {
      this.notifyRuntime(
        'warning',
        '剧情返回了新的战斗标记，但当前仍有一场战斗未关闭。',
        '剧情战斗未触发',
      );
      return;
    }
    const tracked = await this.repository.selectedQuestTracker(this.profileId);
    const result = await this.execute({
      id: `story-battle:${floor.fingerprint}`,
      type: 'battle.start',
      payload: {
        monsterId: request.monster,
        count: request.count,
        source: request.reason || '剧情自动触发',
        storyTriggered: true,
        relatedQuestId: tracked?.questId || undefined,
      },
    });
    if (result.status !== 'applied' && result.status !== 'duplicate') {
      this.notifyRuntime(
        'error',
        result.message || `无法识别剧情怪物：${request.monster}`,
        '剧情战斗触发失败',
      );
      return;
    }
    await this.panels.open('battle');
    this.notifyRuntime(
      'success',
      `${request.monster}${request.count > 1 ? ` × ${request.count}` : ''}`,
      '剧情战斗已触发',
    );
  }

  private async initializeWorldbook(): Promise<void> {
    const cleanup = await this.regionWorldbook.cleanupLegacyQuestEntries();
    if (cleanup.status === 'applied') {
      this.notifyRuntime(
        'success',
        `已删除 ${cleanup.removed} 条旧版任务/剧情世界书条目；地区与人物资料均已保留。`,
        '旧剧情世界书清理完成',
      );
    }
  }

  private async reconcileQuestFloors(
    eventName: string,
    payload?: TavernEventPayload,
  ): Promise<void> {
    if (!this.profileId) return;
    const causalMutation = [
      'MESSAGE_EDITED',
      'MESSAGE_DELETED',
      'MESSAGE_SWIPED',
    ].includes(eventName);
    const direct =
      causalMutation && payload?.messageId !== undefined
        ? await this.repository.rollbackQuestProgressFromFloor(
            this.profileId,
            payload.messageId,
          )
        : [];
    const floors = await this.adapter.chatFloors();
    const reconciled = floors
      ? await this.repository.reconcileQuestProgress(
          this.profileId,
          floors,
        )
      : [];
    const rollbacks = [...direct, ...reconciled];
    if (rollbacks.length === 0) return;

    this.notifications.clearQuestGuidance();

    await this.events.emit('quest.progress-rolled-back', {
      questIds: [...new Set(rollbacks.map((result) => result.questId))],
      cutoffFloorIndex: Math.min(
        ...rollbacks.map((result) => result.cutoffFloorIndex),
      ),
    });
  }

  private async evaluateTrackedQuest(
    payload?: TavernEventPayload,
  ): Promise<QuestEvaluationPresentation | undefined> {
    if (!this.profileId || !this.questTracker) return undefined;
    const tracker = await this.repository.selectedQuestTracker(
      this.profileId,
    );
    if (!tracker) return undefined;
    const snapshot = await this.repository.snapshot(this.profileId);
    const quest = snapshot.quests.find(
      (candidate) => candidate.id === tracker.questId,
    );
    if (!quest?.definitionId) return undefined;
    const catalog = await this.questCatalogs.load();
    const definition = catalog.get(quest.definitionId);
    if (!definition) return undefined;
    const floors = await this.adapter.chatFloors();
    if (!floors) return undefined;
    const direct =
      payload?.messageId === undefined
        ? undefined
        : floors.find((floor) => floor.index === payload.messageId);
    const floor =
      direct?.role === 'assistant'
        ? direct
        : [...floors].reverse().find((item) => item.role === 'assistant');
    if (!floor) return undefined;

    let progressBannerId: number | undefined;

    try {
      const result = await this.questTracker.evaluateAssistantTurn({
        profileId: this.profileId,
        questRecord: quest,
        quest: definition,
        floor,
        currentLocation: this.snapshotLocation(snapshot),
        recentMessages: await this.adapter.chatConversation(),
        onEvaluationStart: () => {
          this.notifications.clearQuestGuidance();
          progressBannerId = this.notifications.show({
            kind: 'task',
            icon: '✦',
            eyebrow: 'STORY PROGRESSION',
            title: '正在推进剧情',
            description: `正在让副 API 判定「${quest.title}」的本轮进度，请稍候。`,
            meta: '判定中',
            duration: 35_000,
            priority: 96,
          });
        },
      });
      if (result.status !== 'evaluated') return undefined;
      await this.events.emit('quest.evaluated', {
        questId: quest.id,
        floorIndex: floor.index,
        transitionAccepted: result.decision.accepted,
        currentNodeId: result.tracker.current.currentNodeId,
        trackerState: result.tracker.current.trackerState,
      });
      return {
        questId: quest.id,
        transitionAccepted: result.decision.accepted,
        summary: result.decision.next.summary,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.events.emit('quest.judge-failed', {
        questId: quest.id,
        floorIndex: floor.index,
        message,
      });
      this.notifications.show({
        kind: 'warning',
        title: '任务剧情判定暂时失败',
        description: `${message}。本轮不会推进任务进度。`,
        duration: 6_000,
      });
      return undefined;
    } finally {
      if (progressBannerId !== undefined) {
        this.notifications.dismiss(progressBannerId);
      }
    }
  }

  private async presentQuestGuidance(
    evaluation: QuestEvaluationPresentation,
  ): Promise<void> {
    if (!this.profileId) return;
    const tracker = await this.repository.selectedQuestTracker(this.profileId);
    if (!tracker || tracker.questId !== evaluation.questId) return;
    const quest = await this.requireManagedQuest(this.profileId, tracker.questId);
    const definition = await this.questDefinition(quest);
    const node = questNode(definition, tracker.current.currentNodeId);
    const guidance = buildQuestPlayerGuidance(definition, tracker.current);
    const injectable = ['armed', 'tracking', 'detour'].includes(
      tracker.current.trackerState,
    );
    const status =
      tracker.current.trackerState === 'suspended'
        ? '追踪已挂起'
        : tracker.current.trackerState === 'ended'
          ? '节点已结束'
          : evaluation.transitionAccepted
            ? '已推进一个节拍'
            : '保持当前节拍';

    this.notifications.showQuestGuidance({
      questName: definition.name,
      status,
      stageTitle: node.stageTitle,
      sceneTitle: node.sceneTitle,
      beatTitle: node.title,
      summary: tracker.current.summary || evaluation.summary,
      objective: node.objective,
      hint: guidance.hint,
      clues: guidance.clues,
      ...(injectable
        ? {
            injectText: guidance.injectText,
            onInject: () => {
              const filled = this.adapter.setUserInput(guidance.injectText);
              this.notifications.show({
                kind: filled ? 'success' : 'warning',
                title: filled ? '剧情引导已填入' : '未找到酒馆输入框',
                description: filled
                  ? '内容尚未发送，你可以继续修改或直接发送。'
                  : '请根据卡片提示手动输入下一步行动。',
                duration: 4_500,
              });
              return filled;
            },
          }
        : {}),
    });
  }

  private async advanceTrackedQuestFromLocalState(): Promise<boolean> {
    if (!this.profileId) return false;
    const tracker = await this.repository.selectedQuestTracker(
      this.profileId,
    );
    if (
      !tracker ||
      tracker.current.status !== 'active' ||
      ['idle', 'manualPaused', 'suspended', 'ended'].includes(
        tracker.current.trackerState,
      )
    ) {
      return false;
    }
    const quest = await this.requireManagedQuest(
      this.profileId,
      tracker.questId,
    );
    const definition = await this.questDefinition(quest);
    const floor = await this.currentAssistantFloor();
    if (!floor) return false;
    let current = tracker;
    let changed = false;
    for (let index = 0; index < 4; index += 1) {
      const transitionId =
        await this.repository.availableAutomaticQuestTransition(
          this.profileId,
          quest.id,
          definition,
        );
      if (!transitionId) break;
      const updated = await this.repository.applyLocalQuestTransition(
        this.profileId,
        {
          questId: quest.id,
          definition,
          transitionId,
          floor,
          mode: 'automatic',
        },
      );
      changed ||= updated.current.currentNodeId !== current.current.currentNodeId;
      current = updated;
      if (updated.current.status !== 'active') break;
    }
    if (changed) {
      await this.events.emit('quest.tracking-changed', {
        questId: quest.id,
        trackerState: current.current.trackerState,
      });
    }
    return changed;
  }

  private async currentAssistantFloor() {
    const floors = await this.adapter.chatFloors();
    return floors
      ? [...floors].reverse().find((floor) => floor.role === 'assistant')
      : undefined;
  }

  private async trackedQuestView(
    profileId: string,
    quest: QuestRecord,
    tracker: TrackedQuestView['tracker'],
    suppliedDefinition?: QuestDefinition,
  ): Promise<TrackedQuestView> {
    const definition = suppliedDefinition ?? (await this.questDefinition(quest));
    const node = questNode(definition, tracker.current.currentNodeId);
    const position = {
      stageTitle: node.stageTitle,
      sceneTitle: node.sceneTitle,
      beatTitle: node.title,
    };
    if (!node.requiredAction) return { quest, tracker, position };
    const snapshot = await this.repository.snapshot(profileId);
    const action = node.requiredAction;
    const ownedCount = action.itemId
      ? (snapshot.inventory.find((stack) => stack.itemId === action.itemId)
          ?.quantity ?? 0)
      : undefined;
    return {
      quest,
      tracker,
      position,
      action: {
        type: action.type,
        label: action.label,
        ...(action.transitionId
          ? { transitionId: action.transitionId }
          : {}),
        ...(action.itemId ? { itemId: action.itemId } : {}),
        ...(action.itemName ? { itemName: action.itemName } : {}),
        ...(action.count !== undefined ? { count: action.count } : {}),
        ...(action.monsterId ? { monsterId: action.monsterId } : {}),
        ...(action.openPanel ? { openPanel: action.openPanel } : {}),
        ...(ownedCount !== undefined ? { ownedCount } : {}),
        available:
          action.type !== 'submit_item' ||
          (ownedCount ?? 0) >= (action.count ?? 0),
      },
    };
  }

  private async syncQuestContext(): Promise<boolean> {
    if (!this.profileId) return this.adapter.setQuestContext('');
    const tracker = await this.repository.selectedQuestTracker(
      this.profileId,
    );
    if (!tracker) return this.adapter.setQuestContext('');
    if (
      ['idle', 'manualPaused', 'suspended', 'ended'].includes(
        tracker.current.trackerState,
      )
    ) {
      return this.adapter.setQuestContext('');
    }
    const quest = await this.requireManagedQuest(
      this.profileId,
      tracker.questId,
    );
    const definition = await this.questDefinition(quest);
    const node = questNode(definition, tracker.current.currentNodeId);
    const snapshot = await this.repository.snapshot(this.profileId);
    const location = this.snapshotLocation(snapshot);
    const content =
      tracker.current.trackerState === 'armed' &&
      !questLocationMatches(location, node.locations)
        ? buildQuestNavigationContext(definition, tracker.current)
        : buildCurrentNodeContext(definition, tracker.current);
    return this.adapter.setQuestContext(content);
  }

  private createPublicApi(): CaelianPublicApi {
    return {
      channel: this.channel,
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
      refreshNarrativeFromMvu: () => this.ingestMvuNarrative(),
      setUserInput: (text) => this.adapter.setUserInput(text),
      notify: (input) => this.notifications.show(input),
      confirm: (input) => this.notifications.confirm(input),
      syncProjection: () => this.syncProjection(),
      getRegionWorldbookStatus: () => this.regionWorldbook.inspect(),
      setRegionWorldbook: (region, enabled) =>
        this.regionWorldbook.setRegionEnabled(region, enabled),
      switchRegionWorldbook: (previousRegion, nextRegion) =>
        this.regionWorldbook.switchRegion(previousRegion, nextRegion),
      syncManagedContent: (options) =>
        this.syncManagedContent(options?.force ?? true),
      listSurveys: (options) => this.surveys.list(options),
      submitSurvey: (surveyId, draft) =>
        this.surveys.submit(surveyId, draft),
      ignoreSurvey: (surveyId) => this.surveys.ignore(surveyId),
      syncSurveyCatalog: () => this.syncSurveyCatalog(true),
      getManagedContentAutoUpdate: () =>
        this.managedContent.autoUpdateEnabled(),
      setManagedContentAutoUpdate: (enabled) =>
        this.managedContent.setAutoUpdateEnabled(enabled),
      configureQuestJudge: (config) =>
        this.configureQuestJudge(config),
      getQuestJudgeStatus: () => this.getQuestJudgeStatus(),
      fetchQuestJudgeModels: (config) =>
        this.fetchQuestJudgeModels(config),
      listAvailableQuests: (options) =>
        this.listAvailableQuests(options),
      acceptManagedQuest: (definitionId) =>
        this.acceptManagedQuest(definitionId),
      trackQuest: (questId) => this.trackQuest(questId),
      pauseTrackedQuest: () => this.pauseTrackedQuest(),
      resumeTrackedQuest: () => this.resumeTrackedQuest(),
      getTrackedQuest: () => this.getTrackedQuest(),
      submitTrackedQuestAction: () => this.submitTrackedQuestAction(),
      performTrackedQuestAction: () => this.performTrackedQuestAction(),
      completeTrackedQuest: () => this.completeTrackedQuest(),
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
      refreshNarrativeFromMvu: () => this.ingestMvuNarrative(),
      setUserInput: (text) => this.adapter.setUserInput(text),
      notify: (input) => this.notifications.show(input),
      confirm: (input) => this.notifications.confirm(input),
      syncProjection: () => this.syncProjection(),
      getRegionWorldbookStatus: () => this.regionWorldbook.inspect(),
      setRegionWorldbook: (region, enabled) =>
        this.regionWorldbook.setRegionEnabled(region, enabled),
      switchRegionWorldbook: (previousRegion, nextRegion) =>
        this.regionWorldbook.switchRegion(previousRegion, nextRegion),
      syncManagedContent: (options) =>
        this.syncManagedContent(options?.force ?? true),
      listSurveys: (options) => this.surveys.list(options),
      submitSurvey: (surveyId, draft) =>
        this.surveys.submit(surveyId, draft),
      ignoreSurvey: (surveyId) => this.surveys.ignore(surveyId),
      syncSurveyCatalog: () => this.syncSurveyCatalog(true),
      getManagedContentAutoUpdate: () =>
        this.managedContent.autoUpdateEnabled(),
      setManagedContentAutoUpdate: (enabled) =>
        this.managedContent.setAutoUpdateEnabled(enabled),
      configureQuestJudge: (config) =>
        this.configureQuestJudge(config),
      getQuestJudgeStatus: () => this.getQuestJudgeStatus(),
      fetchQuestJudgeModels: (config) =>
        this.fetchQuestJudgeModels(config),
      listAvailableQuests: (options) =>
        this.listAvailableQuests(options),
      acceptManagedQuest: (definitionId) =>
        this.acceptManagedQuest(definitionId),
      trackQuest: (questId) => this.trackQuest(questId),
      pauseTrackedQuest: () => this.pauseTrackedQuest(),
      resumeTrackedQuest: () => this.resumeTrackedQuest(),
      getTrackedQuest: () => this.getTrackedQuest(),
      submitTrackedQuestAction: () => this.submitTrackedQuestAction(),
      performTrackedQuestAction: () => this.performTrackedQuestAction(),
      completeTrackedQuest: () => this.completeTrackedQuest(),
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

  private async ingestMvuNarrative(): Promise<boolean> {
    if (!this.profileId) return false;
    const mvuData = this.adapter.readMvuData();
    if (!mvuData) return false;

    if (hasLegacyMvuState(mvuData)) {
      await this.repository.archiveLegacyMvu(this.profileId, mvuData);
    }

    const extracted = extractMvuNarrativePatch(mvuData);
    if (!extracted) return false;
    const patch = normalizeNarrativePatch(extracted);
    const snapshot = await this.repository.snapshot(this.profileId);
    const changed = this.changedNarrativePatch(patch, snapshot);
    if (!changed) return false;

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
    return true;
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

  private startSurveyUpdates(): void {
    void this.syncSurveyCatalog(true).catch(() => {
      // Background checks stay quiet when the player is offline. The survey
      // panel exposes a visible retry state when it is opened manually.
    });
    this.surveyTimer = this.adapter.host.setInterval(
      () =>
        void this.syncSurveyCatalog(true).catch(() => {
          // A later polling cycle retries both managed catalog mirrors.
        }),
      SURVEY_POLL_INTERVAL_MS,
    );
  }

  private async syncSurveyCatalog(
    offer: boolean,
  ): Promise<SurveyCatalogSyncResult> {
    const result = await this.surveys.refreshCatalog();
    if (offer) await this.offerPendingSurvey();
    return result;
  }

  private async offerPendingSurvey(): Promise<void> {
    if (
      this.status !== 'ready' ||
      this.shuttingDown ||
      this.surveyPromptActive
    ) {
      return;
    }
    const blockingPanels = new Set([
      'feedback',
      'surveys',
      'release-notes',
      'achievement-letter',
    ]);
    if (this.panels.list().some((panel) => blockingPanels.has(panel))) return;

    let pending: SurveyDefinition[];
    try {
      pending = await this.surveys.pending();
    } catch {
      return;
    }
    const survey = pending.find(
      (candidate) => !this.promptedSurveyIds.has(candidate.id),
    );
    if (!survey) return;

    this.promptedSurveyIds.add(survey.id);
    this.surveyPromptActive = true;
    try {
      const shouldView = await this.notifications.confirm({
        title:
          survey.kind === 'single' ? '有一项新的意见征集' : '有一份新的调查问卷',
        description: `${survey.title}${survey.description ? `：${survey.description}` : ''}`,
        confirmText: '查看',
        cancelText: '忽略',
      });
      if (shouldView) {
        await this.panels.navigate('surveys');
      } else {
        await this.surveys.ignore(survey.id);
      }
    } catch (error) {
      this.notifyRuntime(
        'error',
        error instanceof Error ? error.message : String(error),
        '问卷窗口打开失败',
      );
    } finally {
      this.surveyPromptActive = false;
    }
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
    if (releaseNotesFor(this.channel, this.version).length === 0) return;

    const announcementId = releaseAnnouncementId(
      this.channel,
      this.version,
    );
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

  private requireProfile(): string {
    if (this.status !== 'ready' || !this.profileId) {
      throw new Error(
        this.lastError ?? `${this.channelLabel()} 内核尚未就绪`,
      );
    }
    return this.profileId;
  }

  private async requireManagedQuest(
    profileId: string,
    questId: string,
  ): Promise<QuestRecord> {
    const snapshot = await this.repository.snapshot(profileId);
    const quest = snapshot.quests.find((candidate) => candidate.id === questId);
    if (!quest || !quest.definitionId) {
      throw new Error('任务不存在，或尚未接入剧情追踪系统');
    }
    return quest;
  }

  private async questDefinition(
    quest: QuestRecord,
  ): Promise<QuestDefinition> {
    const catalog = await this.questCatalogs.load();
    const definition = quest.definitionId
      ? catalog.get(quest.definitionId)
      : undefined;
    if (!definition) throw new Error('任务定义已不存在');
    return definition;
  }

  private snapshotLocation(
    snapshot: Awaited<ReturnType<GameRepository['snapshot']>>,
  ): string {
    return [snapshot.world.region, snapshot.world.location]
      .filter(Boolean)
      .join('·');
  }

  private commandId(input: unknown): string {
    if (typeof input === 'object' && input !== null && 'id' in input) {
      return String(input.id);
    }
    return 'unknown-command';
  }

  private commandType(input: unknown): string | undefined {
    if (typeof input === 'object' && input !== null && 'type' in input) {
      return String(input.type);
    }
    return undefined;
  }

  private notifyRuntime(
    kind: Extract<NotificationKind, 'info' | 'success' | 'warning' | 'error'>,
    message: string,
    title = `Re∞：欧西亚斯 ${this.channelLabel()}`,
  ): void {
    this.notifications.show({
      kind,
      title,
      description: message,
      duration: kind === 'error' ? 7_000 : 5_000,
    });
  }

  private channelLabel(): 'Alpha' | 'Beta' {
    return this.channel === 'beta' ? 'Beta' : 'Alpha';
  }
}

export function createKernel(options: KernelOptions): CaelianKernel {
  return new CaelianKernel(options);
}
