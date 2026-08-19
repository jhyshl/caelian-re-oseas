import type { CommandResult, DomainCommand } from '@/domain/commands';
import { domainCommandSchema } from '@/domain/commands';
import type {
  AchievementSpecialState,
  GameSnapshot,
  MailboxState,
  MarketView,
  ProfileRecord,
  QuestCompletionResult,
  QuestProgressSnapshot,
  TavernFloorReference,
} from '@/domain/types';
import type { AchievementPatchSignal } from '@/achievements/patch-registry';
import type { AchievementDefinition } from '@/content/types';
import type { EventBus } from '@/kernel/event-bus';
import type { CaelianDatabase } from '@/storage/database';
import type { QuestDefinition } from '@/quests/schema';
import { BattleRepository } from '@/storage/repositories/battle-repository';
import {
  AchievementRepository,
  type LegacyAchievementPayload,
} from '@/storage/repositories/achievement-repository';
import { CardRepository } from '@/storage/repositories/card-repository';
import { CraftingRepository } from '@/storage/repositories/crafting-repository';
import { InventoryRepository } from '@/storage/repositories/inventory-repository';
import { MarketRepository } from '@/storage/repositories/market-repository';
import { NarrativeRepository } from '@/storage/repositories/narrative-repository';
import { GuildRepository } from '@/storage/repositories/guild-repository';
import { PlayerRepository } from '@/storage/repositories/player-repository';
import { ProfileRepository } from '@/storage/repositories/profile-repository';
import { WorldRepository } from '@/storage/repositories/world-repository';
import {
  QuestProgressRepository,
  type ApplyLocalQuestTransitionInput,
  type BindQuestFloorInput,
  type QuestFloorRollbackResult,
} from '@/storage/repositories/quest-progress-repository';

export class GameRepository {
  private readonly profiles: ProfileRepository;
  private readonly players: PlayerRepository;
  private readonly world: WorldRepository;
  private readonly inventory: InventoryRepository;
  private readonly cards: CardRepository;
  private readonly crafting: CraftingRepository;
  private readonly guild: GuildRepository;
  private readonly battles: BattleRepository;
  private readonly narrative: NarrativeRepository;
  private readonly achievements: AchievementRepository;
  private readonly market: MarketRepository;
  private readonly questProgress: QuestProgressRepository;

  constructor(
    private readonly db: CaelianDatabase,
    private readonly events: EventBus,
  ) {
    this.profiles = new ProfileRepository(db);
    this.players = new PlayerRepository(db);
    this.world = new WorldRepository(db);
    this.inventory = new InventoryRepository(db);
    this.cards = new CardRepository(db);
    this.crafting = new CraftingRepository(db);
    this.guild = new GuildRepository(db);
    this.battles = new BattleRepository(db);
    this.narrative = new NarrativeRepository(db);
    this.achievements = new AchievementRepository(db, events);
    this.market = new MarketRepository(db);
    this.questProgress = new QuestProgressRepository(db);
  }

  ensureProfile(
    chatId: string,
    defaults: { playerName?: string } = {},
  ): Promise<ProfileRecord> {
    return this.profiles.ensure(chatId, defaults);
  }

  resolveProfile(
    chatId: string,
    defaults: {
      playerName?: string;
      legacyPreserveAdventureSave?: boolean;
    } = {},
  ): Promise<ProfileRecord> {
    return this.profiles.resolve(chatId, defaults);
  }

  async snapshot(profileId: string): Promise<GameSnapshot> {
    const [
      profile,
      player,
      statAllocations,
      world,
      regionAccess,
      storyFlags,
      social,
      guild,
      quests,
      questHistory,
      inventory,
      equipment,
      loadout,
      cards,
      decks,
      relics,
      passives,
      battle,
      achievements,
      settings,
    ] = await Promise.all([
      this.db.profiles.get(profileId),
      this.db.playerStates.get(profileId),
      this.db.statAllocations.get(profileId),
      this.db.worldStates.get(profileId),
      this.db.regionAccess.where('profileId').equals(profileId).toArray(),
      this.db.storyFlags.where('profileId').equals(profileId).toArray(),
      this.db.socialProgress.get(`${profileId}:caelian`),
      this.db.guildStates.get(profileId),
      this.db.questRecords.where('profileId').equals(profileId).toArray(),
      this.db.questHistory.where('profileId').equals(profileId).toArray(),
      this.db.inventoryStacks.where('profileId').equals(profileId).toArray(),
      this.db.equipmentInstances.where('profileId').equals(profileId).toArray(),
      this.db.equipmentLoadouts.get(profileId),
      this.db.ownedCards.where('profileId').equals(profileId).toArray(),
      this.db.decks.where('profileId').equals(profileId).toArray(),
      this.db.ownedRelics.where('profileId').equals(profileId).toArray(),
      this.db.passiveTalents.where('profileId').equals(profileId).toArray(),
      this.db.battleSessions
        .where('profileId')
        .equals(profileId)
        .filter((session) => session.active)
        .first(),
      this.achievements.listProgress(profileId),
      this.profiles.displaySettings(profileId),
    ]);
    if (
      !profile ||
      !player ||
      !statAllocations ||
      !world ||
      !social ||
      !guild ||
      !loadout ||
      !settings
    ) {
      throw new Error(`档案 ${profileId} 未完成初始化`);
    }
    return {
      profile,
      player,
      statAllocations,
      world,
      regionAccess,
      storyFlags,
      social,
      guild,
      quests,
      questHistory,
      inventory,
      equipment,
      loadout,
      cards,
      decks,
      relics,
      passives,
      battle: battle ?? null,
      achievements,
      settings,
    };
  }

  async execute(profileId: string, input: unknown): Promise<CommandResult> {
    const parsed = domainCommandSchema.safeParse(input);
    if (!parsed.success) {
      return {
        id: this.readCommandId(input),
        status: 'rejected',
        message: parsed.error.issues.map((issue) => issue.message).join('；'),
      };
    }
    const command = parsed.data;
    const achievementCapture = await this.achievements.capture(
      profileId,
      command,
    );
    if (command.type.startsWith('battle.')) {
      await this.battles.prepare();
    }
    if (command.type === 'player.create' || command.type === 'player.reclass') {
      await this.players.prepare();
    }
    if (
      command.type === 'player.prepare-level-rewards' ||
      command.type === 'player.claim-level-reward'
    ) {
      await this.players.prepareLevelRewards();
    }
    if (command.type.startsWith('market.')) {
      await this.market.prepare();
    }
    if (command.type.startsWith('craft.')) {
      await this.crafting.prepare();
    }
    if (command.type === 'inventory.use-consumable') {
      await this.inventory.prepare();
    }
    if (command.type === 'achievement.claim-daily-gift') {
      await this.achievements.prepareDailyGiftPool();
    }
    const result = await this.db.transaction(
      'rw',
      this.writeTables(),
      async (): Promise<CommandResult> => {
        if (await this.db.commandInbox.get(command.id)) {
          return { id: command.id, status: 'duplicate' };
        }
        await this.applyCommand(profileId, command);
        const now = Date.now();
        await this.db.commandInbox.add({
          id: command.id,
          profileId,
          type: command.type,
          appliedAt: now,
        });
        await this.db.eventLog.add({
          profileId,
          type: command.type,
          payload: command.payload,
          createdAt: now,
        });
        await this.db.profiles.update(profileId, { updatedAt: now });
        return { id: command.id, status: 'applied' };
      },
    );

    if (result.status === 'applied') {
      await this.achievements.handleCommand(
        profileId,
        command,
        achievementCapture,
      );
      await this.events.emit('state.changed', { command: result });
    }
    return result;
  }

  recentEvents(profileId: string, limit = 30) {
    return this.db.eventLog
      .where('profileId')
      .equals(profileId)
      .reverse()
      .limit(limit)
      .toArray();
  }

  async archiveLegacyMvu(
    profileId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const id = `${profileId}:mvu-before-v3`;
    if (await this.db.legacySnapshots.get(id)) return;
    await this.db.legacySnapshots.add({
      id,
      profileId,
      source: 'mvu-before-v3',
      data,
      createdAt: Date.now(),
    });
  }

  importLegacyAchievements(
    profileId: string,
    payload: LegacyAchievementPayload,
  ): Promise<void> {
    return this.achievements.importLegacy(profileId, payload);
  }

  scanAchievements(
    profileId: string,
    chatTexts: string[] = [],
  ): Promise<void> {
    return this.achievements.scanStatic(profileId, chatTexts);
  }

  achievementSpecialState(
    profileId: string,
  ): Promise<AchievementSpecialState> {
    return this.achievements.specialState(profileId);
  }

  achievementDefinitions(): Promise<Record<string, AchievementDefinition>> {
    return this.achievements.listDefinitions();
  }

  syncPatchEntitlements(
    profileId: string,
    signals: AchievementPatchSignal[],
    date = new Date(),
  ) {
    return this.achievements.syncPatchEntitlements(profileId, signals, date);
  }

  mailboxState(profileId: string): Promise<MailboxState> {
    return this.achievements.mailboxState(profileId);
  }

  marketState(profileId: string): Promise<MarketView> {
    return this.market.view(profileId);
  }

  bindQuestFloor(
    profileId: string,
    input: BindQuestFloorInput,
  ) {
    return this.questProgress.bindFloor(profileId, input);
  }

  acceptQuestDefinition(
    profileId: string,
    definition: QuestDefinition,
  ) {
    return this.questProgress.acceptDefinition(profileId, definition);
  }

  selectTrackedQuest(
    profileId: string,
    questId: string,
    baseline: QuestProgressSnapshot,
  ) {
    return this.questProgress.selectQuest(profileId, questId, baseline);
  }

  pauseTrackedQuest(profileId: string) {
    return this.questProgress.setSelectedTrackerState(
      profileId,
      'manualPaused',
    );
  }

  resumeTrackedQuest(profileId: string) {
    return this.questProgress.setSelectedTrackerState(profileId, 'armed');
  }

  selectedQuestTracker(profileId: string) {
    return this.questProgress.selectedTracker(profileId);
  }

  applyLocalQuestTransition(
    profileId: string,
    input: ApplyLocalQuestTransitionInput,
  ) {
    return this.questProgress.applyLocalQuestTransition(profileId, input);
  }

  ensurePartySupportCard(
    profileId: string,
    subclass: string,
  ): Promise<void> {
    return this.cards.ensurePartySupportCard(profileId, subclass);
  }

  submitPendingQuestItem(profileId: string, questId: string) {
    return this.questProgress.submitPendingItem(profileId, questId);
  }

  availableAutomaticQuestTransition(
    profileId: string,
    questId: string,
    definition: QuestDefinition,
  ) {
    return this.questProgress.availableAutomaticTransition(
      profileId,
      questId,
      definition,
    );
  }

  async completeQuestDefinition(
    profileId: string,
    definition: QuestDefinition,
  ): Promise<QuestCompletionResult> {
    const result = await this.questProgress.completeDefinition(
      profileId,
      definition,
    );
    await this.achievements.recordExternal(profileId, {
      event: 'quest.complete',
      questId: definition.id,
      ending: result.ending,
    });
    await this.events.emit('state.changed', {
      command: {
        id: `managed-quest-complete:${result.questId}`,
        status: 'applied',
      },
    });
    return result;
  }

  rollbackQuestProgressFromFloor(
    profileId: string,
    floorIndex: number,
  ): Promise<QuestFloorRollbackResult[]> {
    return this.questProgress.rollbackFromFloor(profileId, floorIndex);
  }

  reconcileQuestProgress(
    profileId: string,
    floors: TavernFloorReference[],
  ): Promise<QuestFloorRollbackResult[]> {
    return this.questProgress.reconcileFloors(profileId, floors);
  }

  private async applyCommand(
    profileId: string,
    command: DomainCommand,
  ): Promise<void> {
    switch (command.type) {
      case 'player.create':
        return this.players.create(profileId, command.payload);
      case 'player.update':
        return this.players.update(profileId, command.payload);
      case 'player.reclass':
        return this.players.reclass(profileId, command.payload);
      case 'player.allocate-stat':
        return this.players.allocateStat(
          profileId,
          command.payload.stat,
          command.payload.direction,
        );
      case 'player.prepare-level-rewards':
        return this.players.populateLevelRewardChoices(profileId);
      case 'player.claim-level-reward':
        return this.players.claimLevelReward(profileId, command.payload);
      case 'world.move':
        return this.world.move(profileId, command.payload);
      case 'narrative.update':
        return this.narrative.update(profileId, command.payload);
      case 'quest.accept':
        return this.guild.acceptCommission(profileId, command.payload);
      case 'quest.commission-progress':
        return this.guild.progressCommission(profileId, command.payload.questId);
      case 'quest.commission-complete':
        await this.guild.completeCommission(profileId, command.payload.questId);
        return;
      case 'quest.abandon':
        await this.guild.abandon(profileId, command.payload.questId);
        return this.questProgress.clearQuest(
          profileId,
          command.payload.questId,
        );
      case 'inventory.adjust':
        return this.inventory.adjust(profileId, command.payload);
      case 'inventory.use-consumable':
        return this.inventory.useConsumable(
          profileId,
          command.payload.itemId,
        );
      case 'craft.item':
        return this.crafting.craftItem(
          profileId,
          command.payload.recipeId,
          command.payload.count,
        );
      case 'craft.equipment':
        await this.crafting.mergeEquipment(
          profileId,
          command.payload.baseId,
          command.payload.stars,
        );
        return;
      case 'deck.update':
        return this.cards.updateActiveDeck(profileId, command.payload.cardIds);
      case 'equipment.equip':
        return this.inventory.equip(profileId, command.payload.instanceId);
      case 'equipment.unequip':
        return this.inventory.unequip(profileId, command.payload.slot);
      case 'relic.set-carried':
        return this.inventory.setRelicCarried(
          profileId,
          command.payload.relicId,
          command.payload.carried,
        );
      case 'achievement.record':
        return this.achievements.recordExternal(profileId, command.payload);
      case 'achievement.claim-poem-letter':
        return this.achievements.claimPoemLetter(profileId);
      case 'achievement.claim-daily-gift':
        return this.achievements.claimDailyGift(profileId);
      case 'achievement.claim-creator-gift':
        return this.achievements.claimCreatorGift(profileId);
      case 'mail.open':
        return this.achievements.openMail(
          profileId,
          command.payload.mailId,
        );
      case 'market.buy':
        return this.market.buy(profileId, command.payload);
      case 'market.sell-item':
        return this.market.sellItem(profileId, command.payload);
      case 'market.sell-equipment':
        return this.market.sellEquipment(
          profileId,
          command.payload.instanceId,
        );
      case 'battle.start':
        return this.battles.start(profileId, command.payload);
      case 'battle.explore':
        return this.battles.start(profileId, command.payload);
      case 'battle.play-card':
        return this.battles.playCard(profileId, command.payload);
      case 'battle.choose-astrology-card':
        return this.battles.chooseAstrologyCard(profileId, command.payload);
      case 'battle.use-item':
        return this.battles.useItem(profileId, command.payload);
      case 'battle.prepare-item':
        return this.battles.prepareItem(profileId, command.payload.itemId);
      case 'battle.end-turn':
        return this.battles.endTurn(
          profileId,
          command.payload.battleId,
        );
      case 'battle.discard-hand':
        return this.battles.discardHand(
          profileId,
          command.payload.battleId,
        );
      case 'battle.surrender':
        return this.battles.surrender(
          profileId,
          command.payload.battleId,
        );
      case 'battle.finish':
        return this.battles.finish(profileId, command.payload.battleId);
      case 'battle.claim-reward':
        return this.battles.claimReward(profileId, command.payload);
      case 'settings.update':
        return this.profiles.updateSettings(profileId, command.payload);
    }
  }

  private writeTables() {
    return [
      this.db.profiles,
      this.db.playerStates,
      this.db.statAllocations,
      this.db.worldStates,
      this.db.storyFlags,
      this.db.socialProgress,
      this.db.guildStates,
      this.db.questRecords,
      this.db.questHistory,
      this.db.questTrackerStates,
      this.db.questFloorCheckpoints,
      this.db.inventoryStacks,
      this.db.equipmentInstances,
      this.db.equipmentLoadouts,
      this.db.ownedRelics,
      this.db.specialCollectibles,
      this.db.passiveTalents,
      this.db.ownedCards,
      this.db.decks,
      this.db.battleSessions,
      this.db.battleRewards,
      this.db.achievementProgress,
      this.db.achievementCounters,
      this.db.mailRecords,
      this.db.marketStates,
      this.db.settings,
      this.db.commandInbox,
      this.db.eventLog,
    ] as const;
  }

  private readCommandId(input: unknown): string {
    if (typeof input === 'object' && input !== null && 'id' in input) {
      return String(input.id);
    }
    return 'invalid-command';
  }
}
