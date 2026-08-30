import Dexie, { type Table } from 'dexie';
import type {
  AchievementCounterRecord,
  AchievementProgressRecord,
  BattleRewardRecord,
  BattleSessionRecord,
  CommandInboxRecord,
  ContentVersionRecord,
  CraftingDraftRecord,
  DeckRecord,
  EquipmentInstanceRecord,
  EquipmentLoadoutRecord,
  EventLogRecord,
  GatheringState,
  GuildRecord,
  InventoryStackRecord,
  LegacySnapshotRecord,
  MailRecord,
  MarketStateRecord,
  OwnedCardRecord,
  OwnedRelicRecord,
  PassiveTalentRecord,
  PlayerRecord,
  ProfileRecord,
  QuestHistoryRecord,
  QuestFloorCheckpointRecord,
  QuestRecord,
  QuestTrackerRecord,
  RegionAccessRecord,
  ReleaseChannel,
  RollbackSnapshotRecord,
  SettingsRecord,
  SocialProgressRecord,
  SpecialCollectibleRecord,
  StatAllocationRecord,
  StoryFlagRecord,
  TutorialProgressRecord,
  WorldStateRecord,
} from '@/domain/types';
import type {
  SurveyResponseRecord,
  SurveyTokenRecord,
} from '@/surveys/types';

export const DATABASE_SCHEMA_VERSION = 9;

export class CaelianDatabase extends Dexie {
  profiles!: Table<ProfileRecord, string>;

  playerStates!: Table<PlayerRecord, string>;
  statAllocations!: Table<StatAllocationRecord, string>;

  worldStates!: Table<WorldStateRecord, string>;
  regionAccess!: Table<RegionAccessRecord, string>;
  storyFlags!: Table<StoryFlagRecord, string>;

  guildStates!: Table<GuildRecord, string>;
  questRecords!: Table<QuestRecord, string>;
  questHistory!: Table<QuestHistoryRecord, string>;
  questTrackerStates!: Table<QuestTrackerRecord, string>;
  questFloorCheckpoints!: Table<QuestFloorCheckpointRecord, string>;

  inventoryStacks!: Table<InventoryStackRecord, string>;
  equipmentInstances!: Table<EquipmentInstanceRecord, string>;
  equipmentLoadouts!: Table<EquipmentLoadoutRecord, string>;
  ownedRelics!: Table<OwnedRelicRecord, string>;
  specialCollectibles!: Table<SpecialCollectibleRecord, string>;
  passiveTalents!: Table<PassiveTalentRecord, string>;

  ownedCards!: Table<OwnedCardRecord, string>;
  decks!: Table<DeckRecord, string>;

  battleSessions!: Table<BattleSessionRecord, string>;
  battleRewards!: Table<BattleRewardRecord, string>;

  achievementProgress!: Table<AchievementProgressRecord, string>;
  achievementCounters!: Table<AchievementCounterRecord, string>;
  mailRecords!: Table<MailRecord, string>;
  marketStates!: Table<MarketStateRecord, string>;
  gatheringStates!: Table<GatheringState, string>;
  craftingDrafts!: Table<CraftingDraftRecord, string>;
  socialProgress!: Table<SocialProgressRecord, string>;
  tutorialProgress!: Table<TutorialProgressRecord, string>;

  rollbackSnapshots!: Table<RollbackSnapshotRecord, string>;
  commandInbox!: Table<CommandInboxRecord, string>;
  eventLog!: Table<EventLogRecord, number>;
  settings!: Table<SettingsRecord, string>;
  contentVersions!: Table<ContentVersionRecord, string>;
  legacySnapshots!: Table<LegacySnapshotRecord, string>;
  surveyTokens!: Table<SurveyTokenRecord, string>;
  surveyResponses!: Table<SurveyResponseRecord, string>;

  constructor(
    channel: ReleaseChannel,
    databaseName = `caelian-${channel}-v2`,
  ) {
    super(databaseName);

    this.version(2).stores({
      profiles: 'id, &chatId, updatedAt',

      playerStates: 'profileId, created, classMain, subclass, level, updatedAt',
      statAllocations: 'profileId, updatedAt',

      worldStates: 'profileId, region, location, updatedAt',
      regionAccess: 'id, profileId, regionId, accessible, updatedAt',
      storyFlags: 'id, profileId, key, value, updatedAt',

      guildStates: 'profileId, rank, updatedAt',
      questRecords: 'id, profileId, kind, status, region, updatedAt',
      questHistory: 'id, profileId, kind, completedDate, updatedAt',

      inventoryStacks: 'id, profileId, itemId, updatedAt',
      equipmentInstances: 'id, profileId, baseId, slot, rarity, stars, updatedAt',
      equipmentLoadouts: 'profileId, updatedAt',
      ownedRelics: 'id, profileId, relicId, carried, acquiredAt, updatedAt',
      specialCollectibles:
        'id, profileId, collectibleId, acquiredDate, updatedAt',
      passiveTalents: 'id, profileId, passiveId, updatedAt',

      ownedCards: 'id, profileId, cardId, quantity, source, updatedAt',
      decks: 'id, profileId, active, updatedAt',

      battleSessions: 'id, profileId, active, relatedQuestId, updatedAt',
      battleRewards: 'id, profileId, battleId, claimed, updatedAt',

      achievementProgress:
        'id, profileId, achievementId, unlocked, updatedAt',
      marketStates: 'id, profileId, regionId, refreshKey, updatedAt',
      craftingDrafts: 'id, profileId, kind, updatedAt',
      socialProgress: 'id, profileId, characterId, updatedAt',
      tutorialProgress: 'id, profileId, step, completed, updatedAt',

      rollbackSnapshots: 'id, profileId, reason, createdAt',
      commandInbox: 'id, profileId, type, appliedAt',
      eventLog: '++id, profileId, type, createdAt',
      settings: 'id, profileId, updatedAt',
      contentVersions: 'id, version, buildId, sourceHash, updatedAt',
      legacySnapshots: 'id, profileId, source, createdAt',
    });

    this.version(3).stores({
      achievementCounters: 'id, profileId, key, updatedAt',
    });

    this.version(4).stores({
      mailRecords:
        'id, profileId, &mailId, source, receivedAt, openedAt, updatedAt',
    });

    this.version(5)
      .stores({})
      .upgrade(async (transaction) => {
        await transaction
          .table<InventoryStackRecord, string>('inventoryStacks')
          .where('itemId')
          .startsWith('daily:')
          .delete();
      });

    this.version(6).stores({
      surveyTokens: 'surveyId, createdAt',
      surveyResponses:
        'id, &surveyId, status, surveyRevision, submittedAt, updatedAt',
    });

    this.version(7).stores({
      questTrackerStates:
        'id, profileId, questId, selected, [profileId+questId], updatedAt',
      questFloorCheckpoints:
        'id, profileId, questId, floorId, floorIndex, [profileId+questId], [profileId+questId+floorIndex], createdAt',
    });

    this.version(8)
      .stores({})
      .upgrade(async (transaction) => {
        if (transaction.storeNames.includes('playerStates')) {
          await transaction
            .table<PlayerRecord, string>('playerStates')
            .toCollection()
            .modify((player) => {
              player.lifesteal = Math.max(
                0,
                Math.min(30, Number(player.lifesteal ?? 0) || 0),
              );
            });
        }
        if (transaction.storeNames.includes('statAllocations')) {
          await transaction
            .table<StatAllocationRecord, string>('statAllocations')
            .toCollection()
            .modify((allocation) => {
              allocation.lifesteal = Math.max(
                0,
                Math.min(30, Number(allocation.lifesteal ?? 0) || 0),
              );
            });
        }
      });

    this.version(9).stores({
      gatheringStates: 'id, profileId, regionId, refreshKey, updatedAt',
    });
  }
}
