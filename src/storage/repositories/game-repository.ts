import type { CommandResult, DomainCommand } from '@/domain/commands';
import { domainCommandSchema } from '@/domain/commands';
import type { GameSnapshot, ProfileRecord } from '@/domain/types';
import type { EventBus } from '@/kernel/event-bus';
import type { CaelianDatabase } from '@/storage/database';
import { BattleRepository } from '@/storage/repositories/battle-repository';
import { CardRepository } from '@/storage/repositories/card-repository';
import { InventoryRepository } from '@/storage/repositories/inventory-repository';
import { GuildRepository } from '@/storage/repositories/guild-repository';
import { PlayerRepository } from '@/storage/repositories/player-repository';
import { ProfileRepository } from '@/storage/repositories/profile-repository';
import { WorldRepository } from '@/storage/repositories/world-repository';

export class GameRepository {
  private readonly profiles: ProfileRepository;
  private readonly players: PlayerRepository;
  private readonly world: WorldRepository;
  private readonly inventory: InventoryRepository;
  private readonly cards: CardRepository;
  private readonly guild: GuildRepository;
  private readonly battles: BattleRepository;

  constructor(
    private readonly db: CaelianDatabase,
    private readonly events: EventBus,
  ) {
    this.profiles = new ProfileRepository(db);
    this.players = new PlayerRepository(db);
    this.world = new WorldRepository(db);
    this.inventory = new InventoryRepository(db);
    this.cards = new CardRepository(db);
    this.guild = new GuildRepository(db);
    this.battles = new BattleRepository(db);
  }

  ensureProfile(
    chatId: string,
    defaults: { playerName?: string } = {},
  ): Promise<ProfileRecord> {
    return this.profiles.ensure(chatId, defaults);
  }

  async snapshot(profileId: string): Promise<GameSnapshot> {
    const [
      profile,
      player,
      statAllocations,
      world,
      regionAccess,
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
      this.db.achievementProgress
        .where('profileId')
        .equals(profileId)
        .toArray(),
      this.db.settings.get(profileId),
    ]);
    if (
      !profile ||
      !player ||
      !statAllocations ||
      !world ||
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
    if (command.type.startsWith('battle.')) {
      await this.battles.prepare();
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
      case 'world.move':
        return this.world.move(profileId, command.payload);
      case 'quest.accept':
        return this.guild.acceptCommission(profileId, command.payload);
      case 'quest.abandon':
        return this.guild.abandon(profileId, command.payload.questId);
      case 'inventory.adjust':
        return this.inventory.adjust(profileId, command.payload);
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
      case 'battle.start':
        return this.battles.start(profileId, command.payload);
      case 'battle.explore':
        return this.battles.start(profileId, command.payload);
      case 'battle.play-card':
        return this.battles.playCard(profileId, command.payload);
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
      case 'settings.update':
        await this.db.settings.update(profileId, {
          ...command.payload,
          updatedAt: Date.now(),
        });
    }
  }

  private writeTables() {
    return [
      this.db.profiles,
      this.db.playerStates,
      this.db.statAllocations,
      this.db.worldStates,
      this.db.guildStates,
      this.db.questRecords,
      this.db.questHistory,
      this.db.inventoryStacks,
      this.db.equipmentInstances,
      this.db.equipmentLoadouts,
      this.db.ownedRelics,
      this.db.passiveTalents,
      this.db.ownedCards,
      this.db.decks,
      this.db.battleSessions,
      this.db.battleRewards,
      this.db.achievementProgress,
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
