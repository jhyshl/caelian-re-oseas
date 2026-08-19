import type { CommandResult } from '@/domain/commands';
import type { AchievementDefinition } from '@/content/types';
import type {
  AchievementSpecialState,
  EventLogRecord,
  GameSnapshot,
  InventoryStackRecord,
  MailboxState,
  MarketView,
  QuestCompletionResult,
  QuestRecord,
  QuestTrackerRecord,
  RuntimeInfo,
} from '@/domain/types';
import type { KernelEventMap } from '@/kernel/event-bus';
import type {
  ConfirmationInput,
  NotificationInput,
} from '@/notifications/types';
import type { ManagedContentSyncResult } from '@/content-updates/managed-content';
import type {
  SurveyCatalogSyncResult,
  SurveyListEntry,
  SurveyResponseRecord,
  SurveySubmissionDraft,
} from '@/surveys/types';
import type {
  QuestListEntry,
} from '@/quests/catalog';
import type {
  OpenAiCompatibleJudgeConfig,
  QuestJudgeModel,
  QuestJudgeModelListConfig,
} from '@/quests/judge-client';
import type {
  RegionWorldbookOverview,
  RegionWorldbookSyncResult,
} from '@/worldbook/region-switcher';

export interface QuestJudgeStatus {
  configured: boolean;
  endpoint?: string;
  modelsEndpoint?: string;
  model?: string;
  jsonMode?: boolean;
  apiKeyPresent: boolean;
}

export interface TrackedQuestView {
  quest: QuestRecord;
  tracker: QuestTrackerRecord;
  position?: {
    stageTitle: string;
    sceneTitle: string;
    beatTitle: string;
  };
  action?: {
    type:
      | 'submit_item'
      | 'claim_items'
      | 'claim_equipment'
      | 'confirm'
      | 'start_battle';
    label: string;
    transitionId?: string;
    itemId?: string;
    itemName?: string;
    count?: number;
    ownedCount?: number;
    monsterId?: string;
    openPanel?: 'deck' | 'inventory' | 'battle' | 'market';
    available: boolean;
  };
}

export interface PendingQuestSubmissionView {
  questId: string;
  questName: string;
  itemId: string;
  itemName: string;
  count: number;
  ownedCount: number;
  available: boolean;
}

export type PanelName =
  | 'shell'
  | 'character'
  | 'affinity'
  | 'deck'
  | 'card-square'
  | 'inventory'
  | 'crafting'
  | 'market'
  | 'guild'
  | 'map'
  | 'worldbook'
  | 'battle'
  | 'achievements'
  | 'mailbox'
  | 'settings'
  | 'feedback'
  | 'surveys'
  | 'release-notes'
  | 'achievement-letter'
  | 'memory-together-letter'
  | 'quest-submission'
  | 'diagnostics';
export type QueryName =
  | 'runtime'
  | 'state'
  | 'inventory'
  | 'market'
  | 'events'
  | 'achievement-definitions'
  | 'achievement-special'
  | 'mailbox';

export interface QueryResultMap {
  runtime: RuntimeInfo;
  state: GameSnapshot;
  inventory: InventoryStackRecord[];
  market: MarketView;
  events: EventLogRecord[];
  'achievement-definitions': Record<string, AchievementDefinition>;
  'achievement-special': AchievementSpecialState;
  mailbox: MailboxState;
}

export interface TavernAvatarUrls {
  user: string;
  character: string;
  userOriginal: string;
  characterOriginal: string;
}

export interface TavernAvatarRequest {
  refresh?: 'all' | 'user' | 'character';
}

export interface CaelianPublicApi {
  readonly channel: 'alpha' | 'beta';
  readonly version: string;
  readonly buildId: string;
  readonly bridgeApi: 1;
  getRuntimeInfo(): RuntimeInfo;
  execute(command: unknown): Promise<CommandResult>;
  query<K extends QueryName>(name: K): Promise<QueryResultMap[K]>;
  openPanel(panel: PanelName): Promise<void>;
  navigatePanel(panel: PanelName): Promise<void>;
  closePanel(panel: PanelName): Promise<void>;
  listOpenPanels(): PanelName[];
  getAvatarUrls(options?: TavernAvatarRequest): Promise<TavernAvatarUrls>;
  refreshNarrativeFromMvu(): Promise<boolean>;
  setUserInput(text: string): boolean;
  notify(input: NotificationInput): number;
  confirm(input: ConfirmationInput): Promise<boolean>;
  syncProjection(): Promise<boolean>;
  getRegionWorldbookStatus(): Promise<RegionWorldbookOverview>;
  setRegionWorldbook(
    region: string,
    enabled: boolean,
  ): Promise<RegionWorldbookSyncResult>;
  switchRegionWorldbook(
    previousRegion: string,
    nextRegion: string,
  ): Promise<RegionWorldbookSyncResult>;
  syncManagedContent(options?: {
    force?: boolean;
  }): Promise<ManagedContentSyncResult>;
  listSurveys(options?: { refresh?: boolean }): Promise<SurveyListEntry[]>;
  submitSurvey(
    surveyId: string,
    draft: SurveySubmissionDraft,
  ): Promise<SurveyResponseRecord>;
  ignoreSurvey(surveyId: string): Promise<SurveyResponseRecord>;
  syncSurveyCatalog(): Promise<SurveyCatalogSyncResult>;
  getManagedContentAutoUpdate(): boolean;
  setManagedContentAutoUpdate(enabled: boolean): void;
  configureQuestJudge(
    config: OpenAiCompatibleJudgeConfig | null,
  ): void;
  getQuestJudgeStatus(): QuestJudgeStatus;
  fetchQuestJudgeModels(
    config: QuestJudgeModelListConfig,
  ): Promise<QuestJudgeModel[]>;
  listAvailableQuests(options?: {
    refresh?: boolean;
  }): Promise<QuestListEntry[]>;
  acceptManagedQuest(definitionId: string): Promise<TrackedQuestView>;
  trackQuest(questId: string): Promise<TrackedQuestView>;
  pauseTrackedQuest(): Promise<TrackedQuestView | null>;
  resumeTrackedQuest(): Promise<TrackedQuestView | null>;
  getTrackedQuest(): Promise<TrackedQuestView | null>;
  getPendingQuestSubmission(): Promise<PendingQuestSubmissionView | null>;
  submitPendingQuestItem(): Promise<PendingQuestSubmissionView | null>;
  submitTrackedQuestAction(): Promise<TrackedQuestView>;
  performTrackedQuestAction(): Promise<TrackedQuestView>;
  completeTrackedQuest(): Promise<QuestCompletionResult>;
  on<K extends keyof KernelEventMap>(
    event: K,
    handler: (payload: KernelEventMap[K]) => void | Promise<void>,
  ): () => void;
  shutdown(): Promise<void>;
}

export type PanelApi = Pick<
  CaelianPublicApi,
  | 'execute'
  | 'query'
  | 'openPanel'
  | 'navigatePanel'
  | 'closePanel'
  | 'getAvatarUrls'
  | 'refreshNarrativeFromMvu'
  | 'syncProjection'
  | 'getRegionWorldbookStatus'
  | 'setRegionWorldbook'
  | 'switchRegionWorldbook'
  | 'syncManagedContent'
  | 'listSurveys'
  | 'submitSurvey'
  | 'ignoreSurvey'
  | 'syncSurveyCatalog'
  | 'getManagedContentAutoUpdate'
  | 'setManagedContentAutoUpdate'
  | 'configureQuestJudge'
  | 'getQuestJudgeStatus'
  | 'fetchQuestJudgeModels'
  | 'listAvailableQuests'
  | 'acceptManagedQuest'
  | 'trackQuest'
  | 'pauseTrackedQuest'
  | 'resumeTrackedQuest'
  | 'getTrackedQuest'
  | 'getPendingQuestSubmission'
  | 'submitPendingQuestItem'
  | 'submitTrackedQuestAction'
  | 'performTrackedQuestAction'
  | 'completeTrackedQuest'
  | 'getRuntimeInfo'
  | 'setUserInput'
  | 'notify'
  | 'confirm'
  | 'on'
>;

export interface PanelContext {
  api: PanelApi;
  document: Document;
}
