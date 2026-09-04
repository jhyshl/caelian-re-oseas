import {
  classSubclasses,
  getProfessionCardPool,
  getStarterDeck,
} from '@/content/catalogs/professions';
import {
  loadPassiveCatalog,
  type PassiveDefinition,
} from '@/content/catalogs/battle';
import {
  loadEquipmentDefinitions,
  loadRelics,
} from '@/content/catalogs/inventory';
import type {
  EquipmentDefinition,
  RelicDefinition,
} from '@/content/types';
import {
  isWorkshopProfessionCertificationInvalid,
  readWorkshopPacks,
  workshopPassiveId,
} from '@/workshop';
import type {
  OwnedCardRecord,
  PlayerRecord,
  StatAllocationRecord,
} from '@/domain/types';
import type { CaelianDatabase } from '@/storage/database';
import {
  MAGICIAN_PASSIVE_ID,
  MAGICIAN_SUBCLASS_ID,
} from '@/content/catalogs/magician';
import {
  LIFESTEAL_CAP,
  LIFESTEAL_STAT_POINT_COST,
} from '@/player/progression';
import {
  aggregateEquipmentStats,
  scaleEquipmentStatsByStars,
} from '@/equipment-stats';

type AllocatableStat =
  | 'hpMax'
  | 'mpMax'
  | 'attack'
  | 'defense'
  | 'speed'
  | 'actionPointsPerTurn'
  | 'lifesteal';

const STANDARD_PASSIVE_BY_SUBCLASS: Record<string, string> = {
  holy_knight: 'pas_shield_master',
  shadow_knight: 'pas_first_strike',
  dragon_knight: 'pas_sharp_blade',
  elementalist: 'pas_lucky_draw',
  arcane_mage: 'pas_lucky_draw',
  alchemist: 'pas_hunter_eye',
  apothecary: 'pas_regen',
  blacksmith: 'pas_iron_skin',
  fire_mage: 'pas_sharp_blade',
  thunder_mage: 'pas_sharp_blade',
  weapon_master: 'pas_sharp_blade',
  water_mage: 'pas_regen',
  wood_mage: 'pas_regen',
  priest: 'pas_regen',
  nun: 'pas_regen',
  wind_mage: 'pas_hunter_eye',
  astrologer: 'pas_hunter_eye',
  dark_mage: 'pas_leech',
  vampire_hunter: 'pas_leech',
  summoner: 'pas_tough',
  mechanic: 'pas_iron_skin',
  merchant: 'pas_gold_finder',
  dark_priest: 'pas_leech',
  [MAGICIAN_SUBCLASS_ID]: MAGICIAN_PASSIVE_ID,
};

export class PlayerRepository {
  private passives?: Record<string, PassiveDefinition>;
  private equipment?: Record<string, EquipmentDefinition>;
  private relics?: Record<string, RelicDefinition>;

  constructor(private readonly db: CaelianDatabase) {}

  async prepare(): Promise<void> {
    this.passives ??= await loadPassiveCatalog();
  }

  async prepareLevelRewards(): Promise<void> {
    [this.equipment, this.relics] = await Promise.all([
      this.equipment ?? loadEquipmentDefinitions(),
      this.relics ?? loadRelics(),
    ]);
  }

  async get(profileId: string): Promise<PlayerRecord> {
    const player = await this.db.playerStates.get(profileId);
    if (!player) throw new Error('玩家档案不存在');
    player.lifesteal = Math.max(
      0,
      Math.min(LIFESTEAL_CAP, Number(player.lifesteal ?? 0) || 0),
    );
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
    if (isWorkshopProfessionCertificationInvalid(input.subclass)) {
      throw new Error('该自制职业的自动评定认证已失效，请先重新评定');
    }
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
    if (isWorkshopProfessionCertificationInvalid(input.subclass)) {
      throw new Error('该自制职业的自动评定认证已失效，请先重新评定');
    }
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
    const [player, allocations, loadout, equipment] = await Promise.all([
      this.get(profileId),
      this.db.statAllocations.get(profileId),
      this.db.equipmentLoadouts.get(profileId),
      this.db.equipmentInstances
        .where('profileId')
        .equals(profileId)
        .toArray(),
    ]);
    if (!allocations) throw new Error('属性分配记录不存在');
    allocations.lifesteal = Math.max(
      0,
      Math.min(LIFESTEAL_CAP, Number(allocations.lifesteal ?? 0) || 0),
    );
    const equippedIds = new Set(
      loadout
        ? [loadout.weaponId, loadout.armorId, loadout.accessoryId].filter(
            (id): id is string => Boolean(id),
          )
        : [],
    );
    const equipmentBonus = aggregateEquipmentStats(
      equipment.filter((item) => equippedIds.has(item.id)),
    );

    if (direction === 'add') {
      this.addStat(player, allocations, stat, equipmentBonus);
    } else {
      this.removeStat(player, allocations, stat, equipmentBonus);
    }
    const now = Date.now();
    player.updatedAt = now;
    allocations.updatedAt = now;
    await this.db.playerStates.put(player);
    await this.db.statAllocations.put(allocations);
  }

  async populateLevelRewardChoices(profileId: string): Promise<void> {
    if (!this.equipment || !this.relics) {
      throw new Error('升级奖励目录尚未加载');
    }
    const player = await this.get(profileId);
    const reward = player.pendingLevelRewards?.find(
      (entry) => !entry.equipmentClaimed || !entry.relicClaimed,
    );
    if (!reward) return;

    if (!reward.equipmentClaimed && reward.equipmentIds.length === 0) {
      reward.equipmentIds = this.sample(Object.keys(this.equipment), 5);
      reward.equipmentClaimed = reward.equipmentIds.length === 0;
    }
    if (!reward.relicClaimed && reward.relicIds.length === 0) {
      const owned = new Set(
        (await this.db.ownedRelics.where('profileId').equals(profileId).toArray())
          .map((entry) => entry.relicId),
      );
      reward.relicIds = this.sample(
        Object.entries(this.relics)
          .filter(
            ([id, relic]) => relic.levelReward === true && !owned.has(id),
          )
          .map(([id]) => id),
        3,
      );
      reward.relicClaimed = reward.relicIds.length === 0;
    }
    this.removeCompletedLevelRewards(player);
    player.updatedAt = Date.now();
    await this.db.playerStates.put(player);
  }

  async claimLevelReward(
    profileId: string,
    input: {
      rewardId: string;
      kind: 'equipment' | 'relic';
      choiceId?: string;
    },
  ): Promise<void> {
    if (!this.equipment || !this.relics) {
      throw new Error('升级奖励目录尚未加载');
    }
    const player = await this.get(profileId);
    const reward = player.pendingLevelRewards?.find(
      (entry) => entry.id === input.rewardId,
    );
    if (!reward) throw new Error('升级奖励不存在或已经领取');
    const now = Date.now();

    if (input.kind === 'equipment') {
      if (reward.equipmentClaimed) throw new Error('装备奖励已经处理');
      if (input.choiceId) {
        if (!reward.equipmentIds.includes(input.choiceId)) {
          throw new Error('装备不在候选列表中');
        }
        const definition = this.equipment[input.choiceId];
        if (!definition) throw new Error('装备定义不存在');
        const stars = 2;
        await this.db.equipmentInstances.add({
          id: `${profileId}:${definition.id}:level:${reward.level}:${now}`,
          profileId,
          baseId: definition.id,
          name: `${definition.name} ${'★'.repeat(stars)}`,
          slot: definition.slot,
          rarity: definition.rarity,
          stars,
          stats: scaleEquipmentStatsByStars(definition.stats, stars),
          description: `${definition.description}（升级奖励）`,
          updatedAt: now,
        });
      }
      reward.equipmentClaimed = true;
    } else {
      if (reward.relicClaimed) throw new Error('藏品奖励已经处理');
      if (input.choiceId) {
        if (!reward.relicIds.includes(input.choiceId)) {
          throw new Error('藏品不在候选列表中');
        }
        if (!this.relics[input.choiceId]) throw new Error('藏品定义不存在');
        const id = `${profileId}:${input.choiceId}`;
        if (!(await this.db.ownedRelics.get(id))) {
          const carried =
            (await this.db.ownedRelics
              .where('profileId')
              .equals(profileId)
              .filter((entry) => entry.carried)
              .count()) < 5;
          await this.db.ownedRelics.add({
            id,
            profileId,
            relicId: input.choiceId,
            carried,
            acquiredAt: now,
            updatedAt: now,
          });
        }
      }
      reward.relicClaimed = true;
    }

    this.removeCompletedLevelRewards(player);
    player.updatedAt = now;
    await this.db.playerStates.put(player);
  }

  private removeCompletedLevelRewards(player: PlayerRecord): void {
    player.pendingLevelRewards = (player.pendingLevelRewards ?? []).filter(
      (entry) => !entry.equipmentClaimed || !entry.relicClaimed,
    );
  }

  private sample<T>(values: T[], limit: number): T[] {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const selected = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[selected]] = [
        shuffled[selected]!,
        shuffled[index]!,
      ];
    }
    return shuffled.slice(0, limit);
  }

  private addStat(
    player: PlayerRecord,
    allocations: StatAllocationRecord,
    stat: AllocatableStat,
    equipmentBonus: ReturnType<typeof aggregateEquipmentStats>,
  ): void {
    const cost =
      stat === 'lifesteal'
        ? LIFESTEAL_STAT_POINT_COST
        : stat === 'actionPointsPerTurn'
        ? player.actionPointsPerTurn <= 10
          ? 2
          : 3
        : 1;
    if (stat === 'lifesteal' && player.lifesteal >= LIFESTEAL_CAP) {
      throw new Error(`吸血最高为 ${LIFESTEAL_CAP}%`);
    }
    if (player.statPoints < cost) throw new Error('可分配属性点不足');
    player.statPoints -= cost;
    allocations[stat] += 1;

    if (stat === 'hpMax') {
      player.hpMax += 5;
      player.hp = Math.min(
        Math.max(1, player.hpMax + equipmentBonus.hpMax),
        player.hp + 5,
      );
    } else if (stat === 'mpMax') {
      player.mpMax += 5;
      player.mp = Math.min(
        Math.max(0, player.mpMax + equipmentBonus.mpMax),
        player.mp + 5,
      );
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
    equipmentBonus: ReturnType<typeof aggregateEquipmentStats>,
  ): void {
    if (allocations[stat] <= 0) throw new Error('该属性没有可返还的投入点');
    allocations[stat] -= 1;
    let refund = stat === 'lifesteal' ? LIFESTEAL_STAT_POINT_COST : 1;

    if (stat === 'hpMax') {
      player.hpMax = Math.max(1, player.hpMax - 5);
      player.hp = Math.min(
        player.hp,
        Math.max(1, player.hpMax + equipmentBonus.hpMax),
      );
    } else if (stat === 'mpMax') {
      player.mpMax = Math.max(0, player.mpMax - 5);
      player.mp = Math.min(
        player.mp,
        Math.max(0, player.mpMax + equipmentBonus.mpMax),
      );
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
    const customProfession = readWorkshopPacks()
      .flatMap((pack) => pack.classes)
      .find((entry) => entry.id === subclass);
    const grantedCards =
      customProfession?.cardPool ?? getProfessionCardPool(subclass) ?? starterDeck;
    const counts = grantedCards.reduce<Record<string, number>>((result, cardId) => {
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
      .filter(
        (entry) =>
          entry.passiveId.startsWith('custom_passive_') ||
          entry.passiveId.startsWith('pas_'),
      )
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
    } else {
      const passiveId = STANDARD_PASSIVE_BY_SUBCLASS[subclass] ?? 'pas_tough';
      const passive = this.passives?.[passiveId];
      if (passive) {
        await this.db.passiveTalents.put({
          id: `${profileId}:${passiveId}`,
          profileId,
          passiveId,
          name: passive.name,
          description: passive.description,
          updatedAt: now,
        });
      }
    }
  }
}
