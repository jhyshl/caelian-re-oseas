import {
  classSubclasses,
  getStarterDeck,
} from '@/content/catalogs/professions';
import { readWorkshopPacks, workshopPassiveId } from '@/workshop';
import type {
  OwnedCardRecord,
  PlayerRecord,
  StatAllocationRecord,
} from '@/domain/types';
import type { CaelianDatabase } from '@/storage/database';

type AllocatableStat =
  | 'hpMax'
  | 'mpMax'
  | 'attack'
  | 'defense'
  | 'speed'
  | 'actionPointsPerTurn';

export class PlayerRepository {
  constructor(private readonly db: CaelianDatabase) {}

  async get(profileId: string): Promise<PlayerRecord> {
    const player = await this.db.playerStates.get(profileId);
    if (!player) throw new Error('玩家档案不存在');
    return player;
  }

  async create(
    profileId: string,
    input: {
      name: string;
      classMain: string;
      subclass: string;
    },
  ): Promise<void> {
    if (!classSubclasses[input.classMain]?.includes(input.subclass)) {
      throw new Error('职业大类与子职业不匹配');
    }
    const now = Date.now();
    await this.db.playerStates.update(profileId, {
      created: true,
      name: input.name,
      classMain: input.classMain,
      subclass: input.subclass,
      updatedAt: now,
    });
    await this.db.guildStates.update(profileId, {
      rank: 'copper',
      updatedAt: now,
    });
    await this.replaceProfessionCards(profileId, input.subclass, now);
  }

  async reclass(
    profileId: string,
    input: { classMain: string; subclass: string },
  ): Promise<void> {
    if (!classSubclasses[input.classMain]?.includes(input.subclass)) {
      throw new Error('职业大类与子职业不匹配');
    }
    const player = await this.get(profileId);
    const cost =
      player.reclassCount <= 0
        ? 500
        : player.reclassCount === 1
          ? 1000
          : 2000;
    if (player.gold < cost) {
      throw new Error(`本次转职需要 ${cost} 金币，当前金币不足`);
    }
    const now = Date.now();
    await this.db.playerStates.put({
      ...player,
      classMain: input.classMain,
      subclass: input.subclass,
      gold: player.gold - cost,
      reclassCount: player.reclassCount + 1,
      updatedAt: now,
    });
    await this.replaceProfessionCards(profileId, input.subclass, now);
  }

  async update(
    profileId: string,
    changes: Partial<
      Pick<PlayerRecord, 'name' | 'level' | 'experience' | 'gold'>
    >,
  ): Promise<void> {
    await this.db.playerStates.update(profileId, {
      ...changes,
      updatedAt: Date.now(),
    });
  }

  async allocateStat(
    profileId: string,
    stat: AllocatableStat,
    direction: 'add' | 'remove',
  ): Promise<void> {
    const [player, allocations] = await Promise.all([
      this.get(profileId),
      this.db.statAllocations.get(profileId),
    ]);
    if (!allocations) throw new Error('属性分配记录不存在');

    if (direction === 'add') {
      this.addStat(player, allocations, stat);
    } else {
      this.removeStat(player, allocations, stat);
    }
    const now = Date.now();
    player.updatedAt = now;
    allocations.updatedAt = now;
    await this.db.playerStates.put(player);
    await this.db.statAllocations.put(allocations);
  }

  private addStat(
    player: PlayerRecord,
    allocations: StatAllocationRecord,
    stat: AllocatableStat,
  ): void {
    const cost =
      stat === 'actionPointsPerTurn'
        ? player.actionPointsPerTurn <= 10
          ? 2
          : 3
        : 1;
    if (player.statPoints < cost) throw new Error('可分配属性点不足');
    player.statPoints -= cost;
    allocations[stat] += 1;

    if (stat === 'hpMax') {
      player.hpMax += 5;
      player.hp = Math.min(player.hpMax, player.hp + 5);
    } else if (stat === 'mpMax') {
      player.mpMax += 5;
      player.mp = Math.min(player.mpMax, player.mp + 5);
    } else {
      player[stat] += 1;
    }
    if (stat === 'actionPointsPerTurn') {
      allocations.actionPointCosts.push(cost);
    }
  }

  private removeStat(
    player: PlayerRecord,
    allocations: StatAllocationRecord,
    stat: AllocatableStat,
  ): void {
    if (allocations[stat] <= 0) throw new Error('该属性没有可返还的投入点');
    allocations[stat] -= 1;
    let refund = 1;

    if (stat === 'hpMax') {
      player.hpMax = Math.max(1, player.hpMax - 5);
      player.hp = Math.min(player.hp, player.hpMax);
    } else if (stat === 'mpMax') {
      player.mpMax = Math.max(0, player.mpMax - 5);
      player.mp = Math.min(player.mp, player.mpMax);
    } else {
      player[stat] = Math.max(0, player[stat] - 1);
    }
    if (stat === 'actionPointsPerTurn') {
      refund = allocations.actionPointCosts.pop() ?? 2;
    }
    player.statPoints += refund;
  }

  private async replaceProfessionCards(
    profileId: string,
    subclass: string,
    now: number,
  ): Promise<void> {
    const starterDeck = getStarterDeck(subclass);
    if (starterDeck.length === 0) {
      throw new Error('该职业没有可用的预设牌组');
    }
    const counts = starterDeck.reduce<Record<string, number>>((result, cardId) => {
      result[cardId] = (result[cardId] ?? 0) + 1;
      return result;
    }, {});
    const ownedCards: OwnedCardRecord[] = Object.entries(counts).map(
      ([cardId, quantity]) => ({
        id: `${profileId}:${cardId}`,
        profileId,
        cardId,
        quantity,
        source: 'starter',
        updatedAt: now,
      }),
    );
    await this.db.ownedCards.where('profileId').equals(profileId).delete();
    await this.db.decks.where('profileId').equals(profileId).delete();
    await this.db.passiveTalents
      .where('profileId')
      .equals(profileId)
      .filter((entry) => entry.passiveId.startsWith('custom_passive_'))
      .delete();
    await this.db.ownedCards.bulkAdd(ownedCards);
    await this.db.decks.add({
      id: `${profileId}:active`,
      profileId,
      name: '预设牌组',
      cardIds: starterDeck,
      active: true,
      updatedAt: now,
    });
    const customProfession = readWorkshopPacks()
      .flatMap((pack) => pack.classes)
      .find((entry) => entry.id === subclass);
    if (customProfession) {
      const passiveId = workshopPassiveId(customProfession.id);
      await this.db.passiveTalents.put({
        id: `${profileId}:${passiveId}`,
        profileId,
        passiveId,
        name: customProfession.talent.name,
        description: customProfession.talent.description,
        updatedAt: now,
      });
    }
  }
}
