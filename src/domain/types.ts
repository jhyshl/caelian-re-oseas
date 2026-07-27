export type ReleaseChannel = 'alpha' | 'beta' | 'release';

export type RuntimeStatus =
  | 'starting'
  | 'ready'
  | 'blocked-by-legacy'
  | 'stopped'
  | 'error';

export interface ProfileRecord {
  id: string;
  chatId: string;
  createdAt: number;
  updatedAt: number;
}

export interface CharacterRecord {
  profileId: string;
  name: string;
  className: string;
  subclass: string;
  level: number;
  updatedAt: number;
}

export interface WorldStateRecord {
  profileId: string;
  region: string;
  location: string;
  gameDate: string;
  storyFlags: string[];
  updatedAt: number;
}

export interface QuestRecord {
  id: string;
  profileId: string;
  kind: 'main' | 'side' | 'commission';
  title: string;
  objective: string;
  status: 'active' | 'completed' | 'failed';
  updatedAt: number;
}

export interface InventoryStackRecord {
  id: string;
  profileId: string;
  itemId: string;
  name: string;
  quantity: number;
  updatedAt: number;
}

export interface CommandInboxRecord {
  id: string;
  profileId: string;
  type: string;
  appliedAt: number;
}

export interface EventLogRecord {
  id?: number;
  profileId: string;
  type: string;
  payload: unknown;
  createdAt: number;
}

export interface StoredJsonRecord {
  id: string;
  profileId: string;
  data: unknown;
  updatedAt: number;
}

export interface SettingsRecord {
  id: string;
  value: unknown;
  updatedAt: number;
}

export interface ContentVersionRecord {
  id: string;
  version: string;
  buildId: string;
  updatedAt: number;
}

export interface GameSnapshot {
  profile: ProfileRecord;
  character: CharacterRecord;
  world: WorldStateRecord;
  quests: QuestRecord[];
  inventory: InventoryStackRecord[];
}

export interface AiProjection {
  schemaVersion: 1;
  channel: ReleaseChannel;
  revision: number;
  player: {
    name: string;
    className: string;
    subclass: string;
    level: number;
  };
  world: {
    region: string;
    location: string;
    gameDate: string;
    storyFlags: string[];
  };
  guild: {
    activeQuests: Array<{
      kind: QuestRecord['kind'];
      title: string;
      objective: string;
    }>;
  };
  battle: {
    active: false;
  };
}

export interface RuntimeInfo {
  channel: ReleaseChannel;
  version: string;
  buildId: string;
  databaseName: string;
  status: RuntimeStatus;
  profileId?: string;
  mvuAvailable: boolean;
  lastError?: string;
}
