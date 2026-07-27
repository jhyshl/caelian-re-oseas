import Dexie, { type Table } from 'dexie';
import type {
  CharacterRecord,
  CommandInboxRecord,
  ContentVersionRecord,
  EventLogRecord,
  InventoryStackRecord,
  ProfileRecord,
  QuestRecord,
  ReleaseChannel,
  SettingsRecord,
  StoredJsonRecord,
  WorldStateRecord,
} from '@/domain/types';

export class CaelianDatabase extends Dexie {
  profiles!: Table<ProfileRecord, string>;
  characters!: Table<CharacterRecord, string>;
  worldStates!: Table<WorldStateRecord, string>;
  questRecords!: Table<QuestRecord, string>;
  inventoryStacks!: Table<InventoryStackRecord, string>;
  equipmentInstances!: Table<StoredJsonRecord, string>;
  ownedCards!: Table<StoredJsonRecord, string>;
  decks!: Table<StoredJsonRecord, string>;
  ownedRelics!: Table<StoredJsonRecord, string>;
  battleSessions!: Table<StoredJsonRecord, string>;
  rewardClaims!: Table<StoredJsonRecord, string>;
  marketStates!: Table<StoredJsonRecord, string>;
  achievementProgress!: Table<StoredJsonRecord, string>;
  socialProgress!: Table<StoredJsonRecord, string>;
  tutorialProgress!: Table<StoredJsonRecord, string>;
  rollbackSnapshots!: Table<StoredJsonRecord, string>;
  commandInbox!: Table<CommandInboxRecord, string>;
  eventLog!: Table<EventLogRecord, number>;
  settings!: Table<SettingsRecord, string>;
  contentVersions!: Table<ContentVersionRecord, string>;
  legacySnapshots!: Table<StoredJsonRecord, string>;

  constructor(
    channel: ReleaseChannel,
    databaseName = `caelian-${channel}`,
  ) {
    super(databaseName);

    this.version(1).stores({
      profiles: 'id, &chatId, updatedAt',
      characters: 'profileId, updatedAt',
      worldStates: 'profileId, updatedAt',
      questRecords: 'id, profileId, kind, status, updatedAt',
      inventoryStacks: 'id, profileId, itemId, updatedAt',
      equipmentInstances: 'id, profileId, updatedAt',
      ownedCards: 'id, profileId, updatedAt',
      decks: 'id, profileId, updatedAt',
      ownedRelics: 'id, profileId, updatedAt',
      battleSessions: 'id, profileId, updatedAt',
      rewardClaims: 'id, profileId, updatedAt',
      marketStates: 'id, profileId, updatedAt',
      achievementProgress: 'id, profileId, updatedAt',
      socialProgress: 'id, profileId, updatedAt',
      tutorialProgress: 'id, profileId, updatedAt',
      rollbackSnapshots: 'id, profileId, updatedAt',
      commandInbox: 'id, profileId, type, appliedAt',
      eventLog: '++id, profileId, type, createdAt',
      settings: 'id, updatedAt',
      contentVersions: 'id, version, buildId, updatedAt',
      legacySnapshots: 'id, profileId, updatedAt',
    });
  }
}
