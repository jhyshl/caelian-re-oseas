export type ReleaseChannel = 'alpha' | 'beta' | 'release';

export type RuntimeStatus =
  | 'starting'
  | 'ready'
  | 'blocked-by-legacy'
  | 'stopped'
  | 'error';

export type EquipmentSlot = 'weapon' | 'armor' | 'accessory';
export type QuestKind = 'main' | 'side' | 'commission';
export type QuestStatus = 'active' | 'ready' | 'completed' | 'failed';

export interface ProfileRecord {
  id: string;
  chatId: string;
  createdAt: number;
  updatedAt: number;
}

export interface PlayerRecord {
  profileId: string;
  created: boolean;
  name: string;
  classMain: string;
  subclass: string;
  level: number;
  experience: number;
  experienceToNext: number;
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  attack: number;
  defense: number;
  speed: number;
  actionPointsPerTurn: number;
  drawPerTurn: number;
  statPoints: number;
  gold: number;
  reclassCount: number;
  updatedAt: number;
}

export interface StatAllocationRecord {
  profileId: string;
  hpMax: number;
  mpMax: number;
  attack: number;
  defense: number;
  speed: number;
  actionPointsPerTurn: number;
  actionPointCosts: number[];
  updatedAt: number;
}

export interface WorldStateRecord {
  profileId: string;
  region: string;
  place: string;
  location: string;
  gameDate: string;
  gameTime: string;
  weather: string;
  mainStage: number;
  mainStep: number;
  updatedAt: number;
}

export interface RegionAccessRecord {
  id: string;
  profileId: string;
  regionId: string;
  accessible: boolean;
  unlockCondition: string;
  updatedAt: number;
}

export interface StoryFlagRecord {
  id: string;
  profileId: string;
  key: string;
  value: boolean;
  updatedAt: number;
}

export interface GuildRecord {
  profileId: string;
  rank: string;
  experience: number;
  completedTaskCount: number;
  updatedAt: number;
}

export interface QuestRecord {
  id: string;
  profileId: string;
  kind: QuestKind;
  title: string;
  region: string;
  objective: string;
  status: QuestStatus;
  currentStage: number;
  totalStages: number;
  rewardExperience: number;
  rewardGold: number;
  rewardGuildExperience: number;
  updatedAt: number;
}

export interface QuestHistoryRecord {
  id: string;
  profileId: string;
  kind: QuestKind;
  title: string;
  completedDate: string;
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

export interface EquipmentInstanceRecord {
  id: string;
  profileId: string;
  baseId: string;
  name: string;
  slot: EquipmentSlot;
  rarity: string;
  stars: number;
  stats: Record<string, number>;
  description: string;
  updatedAt: number;
}

export interface EquipmentLoadoutRecord {
  profileId: string;
  weaponId: string | null;
  armorId: string | null;
  accessoryId: string | null;
  updatedAt: number;
}

export interface OwnedCardRecord {
  id: string;
  profileId: string;
  cardId: string;
  quantity: number;
  source: string;
  updatedAt: number;
}

export interface DeckRecord {
  id: string;
  profileId: string;
  name: string;
  cardIds: string[];
  active: boolean;
  updatedAt: number;
}

export interface OwnedRelicRecord {
  id: string;
  profileId: string;
  relicId: string;
  carried: boolean;
  acquiredAt: number;
  updatedAt: number;
}

export interface SpecialCollectibleRecord {
  id: string;
  profileId: string;
  collectibleId: string;
  name: string;
  summary: string;
  source: string;
  acquiredDate: string;
  updatedAt: number;
}

export interface PassiveTalentRecord {
  id: string;
  profileId: string;
  passiveId: string;
  name: string;
  description: string;
  updatedAt: number;
}

export type BattleStatus =
  | 'ongoing'
  | 'victory'
  | 'defeat'
  | 'surrendered';

export interface BattleTimedEffect {
  value: number;
  turns: number;
}

export interface BattleCardInstance {
  instanceId: string;
  cardId: string;
}

export interface BattleIntent {
  skillId: string;
  name: string;
  kind: string;
  description: string;
  amount: number;
  hits: number;
}

export interface BattleSummonState {
  id: string;
  name: string;
  duration: number;
  hp: number | null;
  skills: unknown[];
}

export interface BattleChantState {
  id: string;
  name: string;
  turns: number;
  effects: unknown[];
}

export interface BattlePlayerState {
  name: string;
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  shield: number;
  attack: number;
  defense: number;
  speed: number;
  ap: number;
  apMax: number;
  initialDraw: number;
  drawPerTurn: number;
  handLimit: number;
  drawPile: BattleCardInstance[];
  discardPile: BattleCardInstance[];
  hand: BattleCardInstance[];
  buffs: Record<string, BattleTimedEffect>;
  debuffs: Record<string, BattleTimedEffect>;
  summons: BattleSummonState[];
  chants: BattleChantState[];
}

export interface BattleEnemyState {
  id: string;
  definitionId: string;
  name: string;
  hp: number;
  hpMax: number;
  shield: number;
  attack: number;
  defense: number;
  speed: number;
  difficulty: string;
  tags: string[];
  xp: number;
  gold: [number, number];
  loot: Array<{
    id: string;
    name: string;
    chance: number;
  }>;
  buffs: Record<string, BattleTimedEffect>;
  debuffs: Record<string, BattleTimedEffect>;
  intent: BattleIntent | null;
}

export interface BattleLogEntry {
  id: string;
  turn: number;
  kind: 'system' | 'player' | 'enemy' | 'reward';
  text: string;
}

export interface BattleRewards {
  experience: number;
  gold: number;
  guildExperience: number;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
  }>;
}

export type BattleAnimationKind =
  | 'card'
  | 'enemy-action'
  | 'damage'
  | 'heal'
  | 'shield'
  | 'mp'
  | 'ap'
  | 'status'
  | 'draw'
  | 'turn';

export interface BattleAnimationEvent {
  id: string;
  turn: number;
  kind: BattleAnimationKind;
  sourceSide?: 'player' | 'enemy' | 'system';
  sourceId?: string;
  targetSide?: 'player' | 'enemy' | 'system';
  targetId?: string;
  amount?: number;
  hpAfter?: number;
  shieldAfter?: number;
  mpAfter?: number;
  apAfter?: number;
  phaseAfter?: 'player' | 'enemy' | 'ended';
  turnAfter?: number;
  cardInstanceId?: string;
  label: string;
}

export interface LocalBattleState {
  schemaVersion: 1;
  status: BattleStatus;
  phase: 'player' | 'enemy' | 'ended';
  turn: number;
  selectedTarget: number;
  player: BattlePlayerState;
  enemies: BattleEnemyState[];
  rewards: BattleRewards | null;
  log: BattleLogEntry[];
  /**
   * Browser-local presentation events. Older Alpha saves can omit this field;
   * consumers must treat a missing list as empty.
   */
  animations?: BattleAnimationEvent[];
}

export interface BattleSessionRecord {
  id: string;
  profileId: string;
  active: boolean;
  source: string;
  relatedQuestId: string;
  turn: number;
  phase: string;
  state: LocalBattleState;
  updatedAt: number;
}

export interface BattleRewardRecord {
  id: string;
  profileId: string;
  battleId: string;
  claimed: boolean;
  rewards: BattleRewards;
  updatedAt: number;
}

export interface AchievementProgressRecord {
  id: string;
  profileId: string;
  achievementId: string;
  progress: number;
  unlocked: boolean;
  unlockedAt: number | null;
  updatedAt: number;
}

export interface AchievementCounterRecord {
  id: string;
  profileId: string;
  key: string;
  value: number;
  data?: unknown;
  updatedAt: number;
}

export interface AchievementUnlockNotice {
  achievementId: string;
  name: string;
  description: string;
  stars: number;
  unlockedAt: number;
}

export interface AchievementSpecialState {
  letterClaimed: boolean;
  dailyGiftAvailable: boolean;
  lastDailyGiftDate: string;
  lastDailyGiftItems: Array<{
    itemId: string;
    name: string;
    quantity: number;
  }>;
}

export interface MarketStateRecord {
  id: string;
  profileId: string;
  regionId: string;
  refreshKey: string;
  inventory: unknown;
  updatedAt: number;
}

export interface CraftingDraftRecord {
  id: string;
  profileId: string;
  kind: 'card' | 'profession';
  name: string;
  draft: unknown;
  updatedAt: number;
}

export interface TutorialProgressRecord {
  id: string;
  profileId: string;
  step: string;
  completed: boolean;
  updatedAt: number;
}

export interface SocialProgressRecord {
  id: string;
  profileId: string;
  characterId: string;
  affinity: number;
  mood: string;
  location: string;
  clothing: string;
  innerThought: string;
  relationshipStage: string;
  updatedAt: number;
}

export interface RollbackSnapshotRecord {
  id: string;
  profileId: string;
  reason: string;
  snapshot: unknown;
  createdAt: number;
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

export interface SettingsRecord {
  id: string;
  profileId: string;
  preserveAdventureSave: boolean;
  sharedProfileId?: string;
  battleDifficulty: 'easy' | 'normal' | 'hard' | 'hell';
  updatedAt: number;
}

export interface ContentVersionRecord {
  id: string;
  version: string;
  buildId: string;
  sourceHash: string;
  updatedAt: number;
}

export interface LegacySnapshotRecord {
  id: string;
  profileId: string;
  source: string;
  data: unknown;
  createdAt: number;
}

export interface GameSnapshot {
  profile: ProfileRecord;
  player: PlayerRecord;
  statAllocations: StatAllocationRecord;
  world: WorldStateRecord;
  regionAccess: RegionAccessRecord[];
  storyFlags: StoryFlagRecord[];
  social: SocialProgressRecord;
  guild: GuildRecord;
  quests: QuestRecord[];
  questHistory: QuestHistoryRecord[];
  inventory: InventoryStackRecord[];
  equipment: EquipmentInstanceRecord[];
  loadout: EquipmentLoadoutRecord;
  cards: OwnedCardRecord[];
  decks: DeckRecord[];
  relics: OwnedRelicRecord[];
  passives: PassiveTalentRecord[];
  battle: BattleSessionRecord | null;
  achievements: AchievementProgressRecord[];
  settings: SettingsRecord;
}

export interface MvuCompanionState {
  affinity: number;
  mood: string;
  location: string;
  clothing: string;
  innerThought: string;
}

export interface MvuNarrativeState {
  companion: MvuCompanionState;
  storyFlags: Record<string, boolean>;
}

export interface AiProjection {
  _meta: {
    schemaVersion: 3;
    owner: 'caelian-alpha';
    channel: ReleaseChannel;
    revision: number;
  };
  state: {
    player: {
      name: string;
      profession: string;
      level: number;
      hp: number;
      hpMax: number;
      mp: number;
      mpMax: number;
      gold: number;
    };
    world: {
      region: string;
      location: string;
      gameDate: string;
      gameTime: string;
      weather: string;
      mainStage: number;
      mainStep: number;
      accessibleRegions: string[];
    };
    guild: {
      rank: string;
      activeQuests: Array<{
        id: string;
        kind: QuestKind;
        title: string;
        region: string;
        objective: string;
        status: QuestStatus;
        currentStage: number;
        totalStages: number;
      }>;
    };
    battle: {
      active: boolean;
      status: BattleStatus | 'none';
      phase: LocalBattleState['phase'] | 'none';
      source: string;
      relatedQuestId: string;
      turn: number;
      enemies: Array<{
        name: string;
        hp: number;
        hpMax: number;
      }>;
      result: {
        experience: number;
        gold: number;
        items: string[];
      } | null;
    };
    companion: {
      relationshipStage: string;
    };
  };
  narrative: MvuNarrativeState;
}

export interface RuntimeInfo {
  channel: ReleaseChannel;
  version: string;
  buildId: string;
  databaseName: string;
  databaseVersion: number;
  status: RuntimeStatus;
  profileId?: string;
  mvuAvailable: boolean;
  lastError?: string;
}
