import type { CommandResult } from '@/domain/commands';
import type {
  AchievementSpecialState,
  EventLogRecord,
  GameSnapshot,
  InventoryStackRecord,
  MailboxState,
  MarketView,
  RuntimeInfo,
} from '@/domain/types';
import type { KernelEventMap } from '@/kernel/event-bus';
import type {
  ConfirmationInput,
  NotificationInput,
} from '@/notifications/types';
import type { ManagedContentSyncResult } from '@/content-updates/managed-content';

export type PanelName =
  | 'shell'
  | 'character'
  | 'affinity'
  | 'deck'
  | 'inventory'
  | 'market'
  | 'guild'
  | 'map'
  | 'battle'
  | 'achievements'
  | 'mailbox'
  | 'settings'
  | 'feedback'
  | 'release-notes'
  | 'achievement-letter'
  | 'diagnostics';
export type QueryName =
  | 'runtime'
  | 'state'
  | 'inventory'
  | 'market'
  | 'events'
  | 'achievement-special'
  | 'mailbox';

export interface QueryResultMap {
  runtime: RuntimeInfo;
  state: GameSnapshot;
  inventory: InventoryStackRecord[];
  market: MarketView;
  events: EventLogRecord[];
  'achievement-special': AchievementSpecialState;
  mailbox: MailboxState;
}

export interface TavernAvatarUrls {
  user: string;
  character: string;
}

export interface CaelianPublicApi {
  readonly channel: 'alpha';
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
  getAvatarUrls(): Promise<TavernAvatarUrls>;
  setUserInput(text: string): boolean;
  notify(input: NotificationInput): number;
  confirm(input: ConfirmationInput): Promise<boolean>;
  syncProjection(): Promise<boolean>;
  syncManagedContent(options?: {
    force?: boolean;
  }): Promise<ManagedContentSyncResult>;
  getManagedContentAutoUpdate(): boolean;
  setManagedContentAutoUpdate(enabled: boolean): void;
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
  | 'syncProjection'
  | 'syncManagedContent'
  | 'getManagedContentAutoUpdate'
  | 'setManagedContentAutoUpdate'
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
