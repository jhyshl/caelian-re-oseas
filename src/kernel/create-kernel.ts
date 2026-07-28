import type { CommandResult } from '@/domain/commands';
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
  CaelianDatabase,
  DATABASE_SCHEMA_VERSION,
} from '@/storage/database';
import { GameRepository } from '@/storage/repository';
import { TavernAdapter } from '@/tavern/adapter';

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
  private readonly stateDisposers: Array<() => void> = [];
  private status: RuntimeStatus = 'starting';
  private profileId?: string;
  private revision = 0;
  private lastError?: string;
  private projectionQueue: Promise<boolean> = Promise.resolve(false);

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
    this.api = this.createPublicApi();
  }

  async initialize(): Promise<void> {
    if (this.adapter.hasLegacyRuntime()) {
      this.status = 'blocked-by-legacy';
      this.lastError = '检测到旧版 __CaelianRuntime；Alpha 已停止写入。';
      this.adapter.notify('error', this.lastError);
      await this.panels.open('shell');
      return;
    }

    try {
      await this.activateCurrentProfile();
      this.stateDisposers.push(
        this.events.on('state.changed', async () => {
          await this.syncProjection();
        }),
      );
      this.adapter.subscribe(async (eventName) => {
        await this.events.emit('tavern.changed', { event: eventName });
        if (eventName === 'CHAT_CHANGED') {
          await this.activateCurrentProfile();
        } else {
          await this.syncProjection();
        }
      });
      this.status = 'ready';
      await this.syncProjection();
      await this.panels.open('shell');
      await this.events.emit('runtime.ready', this.getRuntimeInfo());
    } catch (error) {
      this.status = 'error';
      this.lastError =
        error instanceof Error ? error.message : String(error);
      this.adapter.notify('error', this.lastError);
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
    const revision = ++this.revision;
    const projection = createAiProjection(
      snapshot,
      this.channel,
      revision,
    );
    const written = await this.adapter.writeProjection(projection);
    if (written) {
      await this.events.emit('projection.synced', { revision });
    }
    return written;
  }

  async shutdown(): Promise<void> {
    if (this.status === 'stopped') return;
    await this.panels.closeAll();
    this.adapter.unsubscribeAll();
    for (const dispose of this.stateDisposers.splice(0)) dispose();
    this.db.close();
    this.status = 'stopped';
    await this.events.emit('runtime.stopped', this.getRuntimeInfo());
    this.events.clear();
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
      setUserInput: (text) => this.adapter.setUserInput(text),
      syncProjection: () => this.syncProjection(),
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
      setUserInput: (text) => this.adapter.setUserInput(text),
      syncProjection: () => this.syncProjection(),
      on: (event, handler) => this.events.on(event, handler),
    };
  }

  private async activateCurrentProfile(): Promise<void> {
    const identity = await this.adapter.identity();
    const profile = await this.repository.ensureProfile(identity.chatId, {
      playerName: identity.playerName,
    });
    this.profileId = profile.id;
  }

  private commandId(input: unknown): string {
    if (typeof input === 'object' && input !== null && 'id' in input) {
      return String(input.id);
    }
    return 'unknown-command';
  }
}

export function createKernel(options: KernelOptions): CaelianKernel {
  return new CaelianKernel(options);
}
