import type { CommandResult } from '@/domain/commands';
import type {
  EventLogRecord,
  GameSnapshot,
  InventoryStackRecord,
  RuntimeInfo,
} from '@/domain/types';
import type { KernelEventMap } from '@/kernel/event-bus';

export type PanelName = 'shell' | 'character' | 'inventory' | 'diagnostics';
export type QueryName = 'runtime' | 'state' | 'inventory' | 'events';

export interface QueryResultMap {
  runtime: RuntimeInfo;
  state: GameSnapshot;
  inventory: InventoryStackRecord[];
  events: EventLogRecord[];
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
  closePanel(panel: PanelName): Promise<void>;
  listOpenPanels(): PanelName[];
  syncProjection(): Promise<boolean>;
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
  | 'closePanel'
  | 'syncProjection'
  | 'getRuntimeInfo'
  | 'on'
>;

export interface PanelContext {
  api: PanelApi;
  document: Document;
}
