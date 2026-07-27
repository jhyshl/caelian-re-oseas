import type { DomainCommand, CommandResult } from '@/domain/commands';
import { domainCommandSchema } from '@/domain/commands';
import type {
  CharacterRecord,
  GameSnapshot,
  InventoryStackRecord,
  ProfileRecord,
  WorldStateRecord,
} from '@/domain/types';
import type { EventBus } from '@/kernel/event-bus';
import type { CaelianDatabase } from '@/storage/database';

export class GameRepository {
  constructor(
    private readonly db: CaelianDatabase,
    private readonly events: EventBus,
  ) {}

  async ensureProfile(
    chatId: string,
    defaults: { playerName?: string } = {},
  ): Promise<ProfileRecord> {
    const existing = await this.db.profiles.where('chatId').equals(chatId).first();
    if (existing) return existing;

    const now = Date.now();
    const profile: ProfileRecord = {
      id: `profile:${encodeURIComponent(chatId)}`,
      chatId,
      createdAt: now,
      updatedAt: now,
    };
    const character: CharacterRecord = {
      profileId: profile.id,
      name: defaults.playerName?.trim() || '冒险者',
      className: '未选择',
      subclass: '',
      level: 1,
      updatedAt: now,
    };
    const world: WorldStateRecord = {
      profileId: profile.id,
      region: '圣德里安学院',
      location: '中央广场',
      gameDate: '',
      storyFlags: [],
      updatedAt: now,
    };

    await this.db.transaction(
      'rw',
      [this.db.profiles, this.db.characters, this.db.worldStates],
      async () => {
        await this.db.profiles.add(profile);
        await this.db.characters.add(character);
        await this.db.worldStates.add(world);
      },
    );

    return profile;
  }

  async snapshot(profileId: string): Promise<GameSnapshot> {
    const [profile, character, world, quests, inventory] = await Promise.all([
      this.db.profiles.get(profileId),
      this.db.characters.get(profileId),
      this.db.worldStates.get(profileId),
      this.db.questRecords.where('profileId').equals(profileId).toArray(),
      this.db.inventoryStacks.where('profileId').equals(profileId).toArray(),
    ]);

    if (!profile || !character || !world) {
      throw new Error(`档案 ${profileId} 未完成初始化`);
    }

    return { profile, character, world, quests, inventory };
  }

  async execute(
    profileId: string,
    input: unknown,
  ): Promise<CommandResult> {
    const parsed = domainCommandSchema.safeParse(input);
    if (!parsed.success) {
      return {
        id: this.readCommandId(input),
        status: 'rejected',
        message: parsed.error.issues.map((issue) => issue.message).join('；'),
      };
    }

    const command = parsed.data;
    const result = await this.db.transaction(
      'rw',
      [
        this.db.characters,
        this.db.worldStates,
        this.db.inventoryStacks,
        this.db.commandInbox,
        this.db.eventLog,
        this.db.profiles,
      ],
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

  async recentEvents(profileId: string, limit = 30) {
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
    const now = Date.now();

    switch (command.type) {
      case 'character.update': {
        const current = await this.db.characters.get(profileId);
        if (!current) throw new Error('人物档案不存在');
        await this.db.characters.put({
          ...current,
          ...command.payload,
          profileId,
          updatedAt: now,
        });
        return;
      }
      case 'world.move': {
        const current = await this.db.worldStates.get(profileId);
        if (!current) throw new Error('世界状态不存在');
        await this.db.worldStates.put({
          ...current,
          ...command.payload,
          profileId,
          updatedAt: now,
        });
        return;
      }
      case 'inventory.adjust': {
        const stackId = `${profileId}:${command.payload.itemId}`;
        const current = await this.db.inventoryStacks.get(stackId);
        const quantity = (current?.quantity ?? 0) + command.payload.delta;
        if (quantity < 0) throw new Error('背包数量不能小于 0');
        if (quantity === 0) {
          await this.db.inventoryStacks.delete(stackId);
          return;
        }
        const stack: InventoryStackRecord = {
          id: stackId,
          profileId,
          itemId: command.payload.itemId,
          name: command.payload.name ?? current?.name ?? command.payload.itemId,
          quantity,
          updatedAt: now,
        };
        await this.db.inventoryStacks.put(stack);
        return;
      }
    }
  }

  private readCommandId(input: unknown): string {
    if (typeof input === 'object' && input !== null && 'id' in input) {
      return String(input.id);
    }
    return 'invalid-command';
  }
}
