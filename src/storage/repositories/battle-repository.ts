import {
  loadBattleRules,
  loadMonsterCatalog,
  loadPassiveCatalog,
  type BattleRules,
  type MonsterDefinition,
  type MonsterSkillDefinition,
  type PassiveDefinition,
} from '@/content/catalogs/battle';
import {
  loadBattleItems,
  loadEquipmentDefinitions,
  loadRelics,
} from '@/content/catalogs/inventory';
import {
  loadCardCatalog,
  normalizeBuiltInCardEffect,
} from '@/content/catalogs/cards';
import {
  MAGICIAN_BLANK_CARD_ID,
  MAGICIAN_BLANK_LIMIT,
} from '@/content/catalogs/magician';
import type {
  BattleItemDefinition,
  CardDefinition,
  CardEffect,
  EquipmentDefinition,
  RelicDefinition,
} from '@/content/types';
import {
  canApplyBattleConsumable,
  childEffects,
  isBattleUsableEffect,
} from '@/battle/consumables';
import { cardNameHistoryKey } from '@/battle/card-history';
import { createCaelianCompanion } from '@/battle/caelian-companion';
import { safeCardEffectHits } from '@/battle/execution-limits';
import {
  bloodBurnAction,
  bloodBurnCardUnavailableReason,
  cardHealsPlayerBeforeBloodBurn,
  type BloodBurnAction,
} from '@/battle/blood-burn';
import {
  aggregateEquipmentStats,
  scaleEquipmentStatsByStars,
} from '@/equipment-stats';
import type {
  BattleAnimationEvent,
  BattleCompanionState,
  BattleEnemyState,
  BattleFriendlyTargetId,
  BattleIntent,
  BattleLogEntry,
  BattlePlayerState,
  BattleRewards,
  BattleSessionRecord,
  BattleSummonState,
  BattleTimedEffect,
  BattleTimedEffectInstance,
  LocalBattleState,
  PlayerRecord,
} from '@/domain/types';
import type { CaelianDatabase } from '@/storage/database';
import {
  grantPlayerExperience,
  LIFESTEAL_CAP,
  LIFESTEAL_STAT_POINT_COST,
  STAT_POINTS_PER_LEVEL,
} from '@/player/progression';
import { updateGuildRank } from '@/guild-progression';
import {
  readWorkshopPacks,
  readWorkshopTestCandidate,
} from '@/workshop';
import { huntingAnimal, rollHuntingRewards } from '@/content/cooking';
import {
  evaluateWorkshopCondition,
  evaluateWorkshopFormula,
  isWorkshopScriptMechanism,
  normalizeWorkshopScriptResult,
  readWorkshopMechanisms,
  workshopStatusKey,
  type WorkshopMechanismAction,
  type WorkshopMechanismManifest,
  type WorkshopMechanismResource,
  type WorkshopMechanismStatus,
  type WorkshopMechanismStatusEffect,
  type WorkshopMechanismRule,
  type WorkshopMechanismTrigger,
} from '@/workshop-mechanisms';
import {
  executeWorkshopScriptMechanism,
  prepareWorkshopScriptRuntime,
  type WorkshopScriptBattleSnapshot,
} from '@/workshop-script-runtime';

const DIFFICULTY_SCALE = {
  easy: 0.8,
  normal: 1,
  hard: 1.5,
  hell: 2,
} as const;

const CLASS_RESOURCE_OWNERS: Record<string, string> = {
  holy_sigil: 'holy_knight',
  dragon_soul: 'dragon_knight',
  element_resonance: 'elementalist',
  ember_echo: 'fire_mage',
  wind_mark: 'wind_mage',
  thunder_charge: 'thunder_mage',
  growth: 'wood_mage',
  furnace_heat: 'blacksmith',
  parts: 'mechanic',
  abyss_echo: 'dark_mage',
  hunter_prepare: 'vampire_hunter',
};

const MONSTER_SCALE: Record<
  string,
  { hp: number; attack: number; defense: number }
> = {
  easy: { hp: 1.3, attack: 1.24, defense: 1.1 },
  normal: { hp: 1.48, attack: 1.4, defense: 1.18 },
  hard: { hp: 1.7, attack: 1.58, defense: 1.3 },
  nightmare: { hp: 1.98, attack: 1.78, defense: 1.44 },
};

const REGION_SCALE: Record<
  string,
  { hp: number; attack: number; defense: number }
> = {
  圣德里安学院: { hp: 0.92, attack: 0.9, defense: 0.95 },
  伊拉亚城: { hp: 1, attack: 1, defense: 1 },
  索拉维亚: { hp: 1.1, attack: 1.08, defense: 1.06 },
  索拉姆城: { hp: 1.1, attack: 1.08, defense: 1.06 },
  艾瑟拉森林: { hp: 1.14, attack: 1.12, defense: 1.04 },
  奈亚索斯: { hp: 1.18, attack: 1.14, defense: 1.06 },
  奈亚索斯城: { hp: 1.18, attack: 1.14, defense: 1.06 },
  阿必塞海: { hp: 1.32, attack: 1.24, defense: 1.12 },
  炉心城: { hp: 1.25, attack: 1.18, defense: 1.18 },
  银月之城: { hp: 1.28, attack: 1.22, defense: 1.1 },
};

const MONSTER_VARIANCE: Record<string, [number, number]> = {
  easy: [0.86, 1.18],
  normal: [0.84, 1.24],
  hard: [0.88, 1.34],
  nightmare: [0.92, 1.46],
};

interface EnemyInstanceAffix {
  id: string;
  name: string;
  chance: number;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  buff?: {
    key: string;
    value: number;
    turns: number;
    undispellable?: boolean;
  };
  onHitDebuff?: string;
}

const ENEMY_INSTANCE_AFFIXES: EnemyInstanceAffix[] = [
  {
    id: 'swift',
    name: '迅捷',
    chance: 12,
    hp: 0.94,
    attack: 1.04,
    defense: 0.95,
    speed: 1.28,
    buff: { key: 'agility', value: 8, turns: 2 },
  },
  {
    id: 'thick_hide',
    name: '厚皮',
    chance: 12,
    hp: 1.16,
    attack: 0.96,
    defense: 1.24,
    speed: 0.92,
    buff: {
      key: 'damage_resist',
      value: 12,
      turns: 2,
      undispellable: true,
    },
  },
  {
    id: 'bloodthirsty',
    name: '嗜血',
    chance: 10,
    hp: 0.98,
    attack: 1.18,
    defense: 0.95,
    speed: 1.04,
    buff: { key: 'strength', value: 2, turns: 2 },
  },
  {
    id: 'cursed',
    name: '咒蚀',
    chance: 8,
    hp: 1.04,
    attack: 1.08,
    defense: 1,
    speed: 1,
    onHitDebuff: 'curse_mark',
  },
  {
    id: 'armored',
    name: '装甲',
    chance: 8,
    hp: 1.08,
    attack: 0.98,
    defense: 1.34,
    speed: 0.86,
    buff: {
      key: 'fortitude',
      value: 2,
      turns: 3,
      undispellable: true,
    },
  },
  {
    id: 'unstable',
    name: '异变',
    chance: 6,
    hp: 1.22,
    attack: 1.16,
    defense: 1.08,
    speed: 1.08,
    buff: {
      key: 'monster_frenzy',
      value: 12,
      turns: 3,
      undispellable: true,
    },
  },
];

type Combatant = {
  name?: string;
  hp: number;
  hpMax: number;
  shield: number;
  attack: number;
  defense: number;
  speed: number;
  lifesteal?: number;
  buffs: Record<string, BattleTimedEffect>;
  debuffs: Record<string, BattleTimedEffect>;
  onHitDebuff?: string;
};

type PlayerSummonCombatant = BattleSummonState &
  Combatant & {
    hp: number;
    hpMax: number;
    shield: number;
    attack: number;
    defense: number;
    speed: number;
    buffs: Record<string, BattleTimedEffect>;
    debuffs: Record<string, BattleTimedEffect>;
  };

interface DamageOptions {
  ignoreDefense?: boolean;
  ignoreAgility?: boolean;
  ignoreImmunity?: boolean;
  ignoreWeak?: boolean;
  ignoreStrength?: boolean;
  ignoreVulnerable?: boolean;
  ignoreResist?: boolean;
  ignoreDamageHalve?: boolean;
  origin?: 'attack' | 'defense_reflect' | 'counterattack' | 'effect';
  fixedAmount?: boolean;
}

interface WorkshopTestInput {
  professionId: string;
  deckIds?: string[];
  opponentMode?: 'dummy' | 'random-single' | 'random-multi';
  randomTier?: 'low' | 'high' | 'mixed';
  randomSeed?: number;
  enemyScale?: number;
  mechanismIds: string[];
  dummyCount: number;
  dummyHp: number;
  dummyAttack: number;
  dummyDefense: number;
  dummyInvincible: boolean;
  dummyAttackEnabled: boolean;
  autoRespawn: boolean;
  playerInvincible: boolean;
  attributes: {
    hpMax: number;
    mpMax: number;
    attack: number;
    defense: number;
    speed: number;
    actionPointsPerTurn: number;
    lifesteal?: number;
  };
}

export class BattleRepository {
  private cards?: Record<string, CardDefinition>;
  private monsters?: Record<string, MonsterDefinition>;
  private rules?: BattleRules;
  private passives?: Record<string, PassiveDefinition>;
  private battleItems?: Record<string, BattleItemDefinition>;
  private relics?: Record<string, RelicDefinition>;
  private equipment?: Record<string, EquipmentDefinition>;
  private animationSequence = 0;
  private mechanismDepth = 0;
  private mechanismSteps = 0;
  private reactionDepth = 0;
  private activeMechanismCard?: {
    id: string;
    name: string;
    type: string;
    tags: string[];
  };
  private activeDarkPriestRedirect = false;
  private resolvingPlayerSummonEffect = false;
  private activePlayerSummon?: BattleSummonState;

  constructor(
    private readonly db: CaelianDatabase,
    private readonly random: () => number = Math.random,
  ) {}

  async prepare(): Promise<void> {
    if (
      !this.cards ||
      !this.monsters ||
      !this.rules ||
      !this.passives ||
      !this.battleItems ||
      !this.relics ||
      !this.equipment
    ) {
      [
        this.cards,
        this.monsters,
        this.rules,
        this.passives,
        this.battleItems,
        this.relics,
        this.equipment,
      ] = await Promise.all([
        loadCardCatalog(),
        loadMonsterCatalog(),
        loadBattleRules(),
        loadPassiveCatalog(),
        loadBattleItems(),
        loadRelics(),
        loadEquipmentDefinitions(),
      ]);
    }
    const scriptMechanisms = readWorkshopMechanisms();
    if (scriptMechanisms.some(isWorkshopScriptMechanism)) {
      await prepareWorkshopScriptRuntime();
    }
  }

  async start(
    profileId: string,
    input: {
      monsterId?: string;
      count?: number;
      source?: string;
      storyTriggered?: boolean;
      companionPresent?: boolean;
      relatedQuestId?: string;
      huntingAnimalId?: string;
      huntingToken?: string;
      workshopTest?: WorkshopTestInput;
    },
  ): Promise<void> {
    this.assertPrepared();
    const existing = await this.db.battleSessions
      .where('profileId')
      .equals(profileId)
      .filter((session) => session.active)
      .first();
    if (existing) {
      throw new Error('请先结束或关闭当前战斗');
    }
    const pendingHunt = input.huntingAnimalId
      ? await this.pendingHuntingEncounter(profileId, input)
      : undefined;

    const [
      player,
      deck,
      loadout,
      equipment,
      settings,
      ownedPassives,
      world,
      ownedRelics,
      ownedCards,
    ] = await Promise.all([
        this.db.playerStates.get(profileId),
        this.db.decks
          .where('profileId')
          .equals(profileId)
          .filter((entry) => entry.active)
          .first(),
        this.db.equipmentLoadouts.get(profileId),
        this.db.equipmentInstances
          .where('profileId')
          .equals(profileId)
          .toArray(),
        this.db.settings.get(profileId),
        this.db.passiveTalents.where('profileId').equals(profileId).toArray(),
        this.db.worldStates.get(profileId),
        this.db.ownedRelics.where('profileId').equals(profileId).toArray(),
        this.db.ownedCards.where('profileId').equals(profileId).toArray(),
      ]);
    if (!player) throw new Error('玩家档案不存在');
    if (input.workshopTest) {
      await this.startWorkshopTest(profileId, player, input.workshopTest);
      return;
    }
    if (!deck || deck.cardIds.length === 0) {
      throw new Error('请先准备至少一张卡牌的出战牌组');
    }
    this.assertOwnedDeck(deck.cardIds, ownedCards);
    const region = world?.region || '伊拉亚城';
    const resolvedMonsterId = input.monsterId
      ? this.resolveMonsterId(input.monsterId)
      : undefined;
    if (input.monsterId && !resolvedMonsterId) {
      throw new Error(`找不到剧情指定的怪物：${input.monsterId}`);
    }
    const encounter = resolvedMonsterId
      ? [resolvedMonsterId, this.monsters?.[resolvedMonsterId]] as const
      : this.chooseEncounter(region, player.level);
    const [monsterId, monster] = encounter;
    if (!monster) throw new Error('找不到要挑战的怪物');

    const battleId = `battle:${profileId}:${Date.now()}:${Math.floor(
      this.random() * 1_000_000,
    )}`;
    const battlePlayer = this.makePlayer(
      player,
      deck.cardIds,
      loadout
        ? equipment.filter((item) =>
            [loadout.weaponId, loadout.armorId, loadout.accessoryId].includes(
              item.id,
            ),
          )
        : [],
    );
    const difficulty = settings?.battleDifficulty ?? 'normal';
    const requestedCount = input.monsterId
      ? input.count ?? 1
      : this.explorationCount(monster, difficulty);
    const enemyCount = this.isBossMonster(monster)
      ? 1
      : Math.max(1, Math.min(12, Math.floor(requestedCount)));
    const packScale = this.packStrengthMultiplier(enemyCount);
    const encounterPack = resolvedMonsterId
      ? Array.from(
          { length: enemyCount },
          () => [monsterId, monster] as const,
        )
      : this.chooseEncounterPack(
          region,
          player.level,
          [monsterId, monster],
          enemyCount,
        );
    const enemies = encounterPack.map(
      ([definitionId, definition], index) =>
        this.makeEnemy(
          definitionId,
          definition,
          player.level,
          difficulty,
          region,
          battlePlayer,
          packScale,
          index,
        ),
    );
    const state: LocalBattleState = {
      schemaVersion: 1,
      difficulty,
      status: 'ongoing',
      phase: 'player',
      turn: 1,
      selectedTarget: 0,
      player: battlePlayer,
      companion: input.companionPresent
        ? createCaelianCompanion(player.level, this.random, battlePlayer.lifesteal)
        : undefined,
      enemies,
      rewards: null,
      ...(pendingHunt
        ? {
            huntingContext: {
              animalId: pendingHunt.animalId,
              animalName: pendingHunt.animalName,
            },
          }
        : {}),
      bossMechanic: this.createBossMechanic(monster),
      log: [],
      animations: [],
    };

    this.initializeWorkshopMechanisms(state, player.subclass);

    this.applyPreparedBattleEffects(state, player.pendingBattleEffects ?? []);
    if (player.pendingBattleEffects?.length) {
      player.pendingBattleEffects = [];
      player.updatedAt = Date.now();
      await this.db.playerStates.put(player);
    }
    this.drawCards(state, battlePlayer.initialDraw);
    this.applyBattleStartPassives(
      state,
      ownedPassives.map((entry) => entry.passiveId),
    );
    this.applyCarriedRelicEffects(
      state,
      ownedRelics
        .filter((entry) => entry.carried)
        .map((entry) => entry.relicId),
    );
    this.syncInheritedLifesteal(state);
    this.runWorkshopMechanisms(state, 'battle_start');
    for (const enemy of enemies) {
      const definition = this.monsters?.[enemy.definitionId];
      enemy.intent = definition
        ? this.chooseIntent(definition, enemy, enemies)
        : null;
    }
    const encounterNames = [
      ...new Set(encounterPack.map(([, definition]) => definition.name)),
    ].join('、');
    this.log(
      state,
      'system',
      `在${region}遭遇 ${enemyCount > 1 ? `${enemyCount} 只怪物：` : ''}${encounterNames}。抽取 ${battlePlayer.hand.length} 张起始手牌。`,
    );
    if (state.companion) {
      this.log(
        state,
        'system',
        '凯利安以圣辉龙骑身份加入战斗，并召唤特莱奥协同作战。',
      );
    }
    const now = Date.now();
    const session: BattleSessionRecord = {
      id: battleId,
      profileId,
      active: true,
      source:
        input.source?.trim() ||
        `${world?.location || region} · ${enemyCount > 1 ? `混合群体遭遇（${encounterNames}）` : monster.name}`,
      storyTriggered: input.storyTriggered === true,
      relatedQuestId: input.relatedQuestId?.trim() || '',
      turn: state.turn,
      phase: state.phase,
      state,
      updatedAt: now,
    };
    if (pendingHunt) {
      await this.db.transaction(
        'rw',
        [this.db.battleSessions, this.db.gatheringStates],
        async () => {
          const current = await this.db.gatheringStates.get(
            `${profileId}:hunting-pending`,
          );
          if (
            current?.pendingHunt?.token !== pendingHunt.token ||
            current.pendingHunt.animalId !== pendingHunt.animalId
          ) {
            throw new Error('本次打猎遭遇凭证已失效，请重新打猎');
          }
          await this.db.battleSessions.add(session);
          await this.db.gatheringStates.delete(current.id);
        },
      );
    } else {
      await this.db.battleSessions.add(session);
    }
    const specialVictory = await this.applyBattleStartRelics(
      profileId,
      state,
      ownedRelics
        .filter((entry) => entry.carried)
        .map((entry) => entry.relicId),
    );
    if (specialVictory) {
      await this.finishBattle(session, 'victory');
    } else {
      await this.save(session);
    }
  }

  private async pendingHuntingEncounter(
    profileId: string,
    input: { huntingAnimalId?: string; huntingToken?: string },
  ) {
    const animal = huntingAnimal(String(input.huntingAnimalId ?? ''));
    const pending = (
      await this.db.gatheringStates.get(`${profileId}:hunting-pending`)
    )?.pendingHunt;
    if (
      !animal ||
      !input.huntingToken ||
      pending?.token !== input.huntingToken ||
      pending.animalId !== animal.id
    ) {
      throw new Error('打猎遭遇来源无效，请先在采集系统完成判定');
    }
    return pending;
  }

  async playCard(
    profileId: string,
    input: {
      battleId: string;
      handIndex: number;
      targetIndex?: number;
      allyTargetId?: BattleFriendlyTargetId;
    },
  ): Promise<void> {
    this.assertPrepared();
    const session = await this.getOngoing(profileId, input.battleId);
    const state = session.state;
    this.assertPlayerPhase(state);
    this.assertNoPendingCardChoice(state);
    const cardInstance = state.player.hand[input.handIndex];
    if (!cardInstance) throw new Error('这张手牌已经不存在');
    const card = this.cardDefinition(state, cardInstance.cardId);
    if (!card) throw new Error('卡牌数据不存在');
    if (card.unplayable === true) {
      throw new Error('空白牌无法打出，只有「真相揭晓」可以将其揭晓');
    }
    if (state.player.debuffs.freeze && !this.isCleanseCard(card)) {
      throw new Error('冰冻中：只能使用净化类卡牌');
    }
    if (state.player.debuffs.entangle && card.type === 'attack') {
      throw new Error('缠绕中：无法使用攻击类卡牌');
    }
    if (
      state.player.subclass === 'arcane_mage' &&
      state.player.chants.length >= 3 &&
      this.cardHasNestedEffect(
        card.effects ?? [],
        (effect) => effect.type === 'chant' || effect.type === 'copy_chant',
      )
    ) {
      throw new Error('吟诵队列已满（3/3）');
    }
    this.assertCardDiscardCosts(state, card, cardInstance.instanceId);
    this.assertCardResourceCosts(state, cardInstance.cardId);
    this.assertCardSummonCosts(state, card);

    const targetIndex = this.resolveTargetIndex(
      state,
      input.targetIndex ?? state.selectedTarget,
    );
    const allyTargetId = input.allyTargetId ?? 'player';
    const healBeforeBloodBurn = cardHealsPlayerBeforeBloodBurn(
      card,
      allyTargetId,
    );
    const cardTags = Array.isArray(card.tags) ? card.tags.map(String) : [];
    this.activeMechanismCard = {
      id: cardInstance.cardId,
      name: card.name,
      type: card.type,
      tags: cardTags,
    };
    let cost = this.cardCost(card, state, targetIndex);
    let mpCost = this.cardMpCost(card, state);
    try {
      const beforeCard = this.runWorkshopMechanisms(state, 'before_card', {
        cardId: cardInstance.cardId,
        cardName: card.name,
        cardType: card.type,
        cardTags,
        cardCost: cost,
        mpCost,
      });
      cost = this.clamp(this.number(beforeCard.cardCost, cost), 0, 10);
      mpCost = this.clamp(this.number(beforeCard.mpCost, mpCost), 0, 999_999);
      if (state.player.ap < cost) throw new Error('行动点不足');
      if (state.player.mp < mpCost) throw new Error('魔力不足');
      const pendingBloodBurn = bloodBurnAction(state.player);
      const bloodBurnUnavailable = bloodBurnCardUnavailableReason(
        state.player,
        card,
        allyTargetId,
      );
      if (bloodBurnUnavailable) throw new Error(bloodBurnUnavailable);

      state.player.ap -= cost;
      state.player.mp -= mpCost;
      this.spendCardCostBuffs(state, card);
      state.selectedTarget = targetIndex;
      state.player.hand.splice(input.handIndex, 1);
      state.player.discardPile.push(cardInstance);
      this.log(state, 'player', `使用「${card.name}」`);
      const cardTarget = this.cardUsesFriendlyTarget(card)
        ? this.cardFriendlyTargets(state, 'ally', allyTargetId)[0]
        : undefined;
      const cardTargetIdentity = cardTarget
        ? this.combatantIdentity(state, cardTarget)
        : undefined;
      this.animation(state, {
        kind: 'card',
        sourceSide: 'player',
        targetSide: cardTargetIdentity?.side ?? 'enemy',
        targetId: cardTargetIdentity?.id ?? state.enemies[targetIndex]?.id,
        apAfter: state.player.ap,
        mpAfter: state.player.mp,
        cardInstanceId: cardInstance.instanceId,
        label: card.name,
      });
      if (!healBeforeBloodBurn) {
        this.triggerBloodBurnAction(
          state,
          state.player,
          '打牌',
          pendingBloodBurn,
        );
        if (state.player.hp <= 0) {
          await this.finishBattle(session, 'defeat');
          return;
        }
      }
      if (
        state.player.subclass === 'vampire_hunter' &&
        card.type === 'attack' &&
        state.player.buffs.blood_moon
      ) {
        this.directHpLoss(
          state,
          state.player,
          Math.max(1, Math.ceil(state.player.hpMax * 0.06)),
          '血月猎杀',
        );
        if (state.player.hp <= 0) {
          await this.finishBattle(session, 'defeat');
          return;
        }
      }
      this.activeDarkPriestRedirect =
        state.player.subclass === 'dark_priest' &&
        card.type === 'attack' &&
        (state.player.sanity ?? 100) <= 0 &&
        this.random() < 0.5;
      this.applyCardEffects(
        state,
        card,
        targetIndex,
        allyTargetId,
      );
      if (healBeforeBloodBurn) {
        this.triggerBloodBurnAction(
          state,
          state.player,
          '打牌',
          pendingBloodBurn,
        );
      }
      this.updateClassResourcesAfterCard(state, card, cardInstance.cardId);
      this.recordBossMechanicCard(state, card.type);
      this.runWorkshopMechanisms(state, 'after_card', {
        cardId: cardInstance.cardId,
        cardName: card.name,
        cardType: card.type,
        cardTags,
        cardCost: cost,
        mpCost,
      });
    } finally {
      this.activeMechanismCard = undefined;
      this.activeDarkPriestRedirect = false;
    }
    if (state.player.hp <= 0) {
      await this.finishBattle(session, 'defeat');
      return;
    }
    this.stabilizeWorkshopTest(state);

    if (state.status === 'surrendered') {
      if (!state.workshopTest) await this.persistBattlePlayer(profileId, state);
      await this.save(session);
      return;
    }

    if (this.aliveEnemies(state).length === 0) {
      await this.finishBattle(session, 'victory');
      return;
    }
    await this.save(session);
  }

  async chooseAstrologyCard(
    profileId: string,
    input: { battleId: string; choiceIndex: number },
  ): Promise<void> {
    this.assertPrepared();
    const session = await this.getOngoing(profileId, input.battleId);
    const state = session.state;
    this.assertPlayerPhase(state);
    const pending = state.player.pendingCardChoice;
    if (!pending || pending.type !== 'astrology') {
      throw new Error('当前没有等待选择的占星牌');
    }
    if (
      input.choiceIndex < 0 ||
      input.choiceIndex >= pending.choices.length ||
      pending.picked.includes(input.choiceIndex)
    ) {
      throw new Error('这张占星候选牌不可选择');
    }
    const cardId = pending.choices[input.choiceIndex];
    if (!cardId) throw new Error('占星候选牌数据不存在');
    const card = this.cardDefinition(state, cardId);
    if (!card) throw new Error('占星候选牌数据不存在');

    const instance = {
      instanceId: `${cardId}:astrology:${Date.now()}:${this.animationSequence++}`,
      cardId,
    };
    const addedToHand = state.player.hand.length < state.player.handLimit;
    if (addedToHand) state.player.hand.push(instance);
    else state.player.discardPile.push(instance);
    pending.picked.push(input.choiceIndex);
    this.log(
      state,
      'player',
      addedToHand
        ? `${pending.title}选择了「${card.name}」，临时加入本场手牌`
        : `手牌已满，「${card.name}」已临时加入弃牌堆`,
    );
    this.animation(state, {
      kind: 'draw',
      sourceSide: 'system',
      targetSide: 'player',
      targetId: 'player',
      amount: 1,
      label: `${pending.title} · ${card.name}`,
    });
    if (pending.picked.length >= pending.pick) {
      delete state.player.pendingCardChoice;
    }
    await this.save(session);
  }

  async discardHand(profileId: string, battleId: string): Promise<void> {
    const session = await this.getOngoing(profileId, battleId);
    const state = session.state;
    this.assertPlayerPhase(state);
    this.assertNoPendingCardChoice(state);
    if (state.player.manualDiscardTurn === state.turn) {
      throw new Error('本回合已使用过一次主动弃牌');
    }
    if (state.player.ap < 1) throw new Error('弃牌重抽需要 1 点行动点');
    const discarded = this.takeDiscardableCards(
      state,
      Number.POSITIVE_INFINITY,
    );
    if (discarded.length === 0) throw new Error('当前没有可弃置的非空白手牌');
    const count = discarded.length;
    state.player.ap -= 1;
    state.player.manualDiscardTurn = state.turn;
    state.player.discardPile.push(...discarded);
    this.drawCards(state, 3);
    this.log(state, 'player', `弃置 ${count} 张手牌，重新抽取 3 张`);
    this.triggerBloodBurnAction(state, state.player, '弃牌');
    if (state.player.hp <= 0) {
      await this.finishBattle(session, 'defeat');
      return;
    }
    await this.save(session);
  }

  async useItem(
    profileId: string,
    input: { battleId: string; itemId: string; targetIndex?: number },
  ): Promise<void> {
    this.assertPrepared();
    const session = await this.getOngoing(profileId, input.battleId);
    const state = session.state;
    this.assertPlayerPhase(state);
    this.assertNoPendingCardChoice(state);
    const stackId = `${profileId}:${input.itemId}`;
    const stack = await this.db.inventoryStacks.get(stackId);
    if (!stack || stack.quantity <= 0) throw new Error('背包中没有这个物品');
    const definition =
      this.battleItems?.[stack.itemId] ?? this.battleItems?.[stack.name];
    const effect = definition?.effect;
    if (!effect || !isBattleUsableEffect(effect)) {
      throw new Error('这个物品不能在当前战斗中即时使用');
    }
    if (
      !canApplyBattleConsumable(effect, {
        player: state.player,
        hasLivingEnemy: this.aliveEnemies(state).length > 0,
      })
    ) {
      throw new Error('这个物品在当前状态下不会产生效果');
    }

    this.log(state, 'player', `使用消耗品「${definition.name}」`);
    this.applyConsumableEffect(
      state,
      definition.name,
      effect,
      input.targetIndex ?? state.selectedTarget,
    );
    if (!state.workshopTest) {
      if (stack.quantity === 1) {
        await this.db.inventoryStacks.delete(stackId);
      } else {
        await this.db.inventoryStacks.put({
          ...stack,
          quantity: stack.quantity - 1,
          updatedAt: Date.now(),
        });
      }
    }

    this.stabilizeWorkshopTest(state);
    if (this.aliveEnemies(state).length === 0) {
      await this.finishBattle(session, 'victory');
      return;
    }
    await this.save(session);
  }

  async prepareItem(profileId: string, itemId: string): Promise<void> {
    this.assertPrepared();
    const active = await this.db.battleSessions
      .where('profileId')
      .equals(profileId)
      .filter((session) => session.active)
      .first();
    if (active) throw new Error('战斗进行中不能配置战前药剂');
    const stackId = `${profileId}:${itemId}`;
    const [stack, player, loadout, equipment] = await Promise.all([
      this.db.inventoryStacks.get(stackId),
      this.db.playerStates.get(profileId),
      this.db.equipmentLoadouts.get(profileId),
      this.db.equipmentInstances
        .where('profileId')
        .equals(profileId)
        .toArray(),
    ]);
    if (!stack || stack.quantity <= 0) throw new Error('背包中没有这个物品');
    if (!player?.created) throw new Error('玩家档案不存在');
    const definition =
      this.battleItems?.[stack.itemId] ?? this.battleItems?.[stack.name];
    if (!definition?.effect) throw new Error('该物品没有可用效果');
    const effects =
      definition.effect.type === 'multi'
        ? childEffects(definition.effect)
        : [definition.effect];
    const prepared = effects.filter((effect) =>
      ['next_battle_buff', 'next_battle_shield', 'next_battle_draw', 'next_battle_ap'].includes(
        effect.type,
      ),
    );
    const immediate = effects.filter((effect) =>
      ['heal', 'gain_mp', 'heal_mp'].includes(effect.type),
    );
    if (prepared.length === 0) throw new Error('该物品不是战前准备道具');
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
    const effectiveHpMax = Math.max(1, player.hpMax + equipmentBonus.hpMax);
    const effectiveMpMax = Math.max(0, player.mpMax + equipmentBonus.mpMax);
    for (const effect of immediate) {
      if (effect.type === 'heal') {
        player.hp = Math.min(effectiveHpMax, player.hp + this.number(effect.value));
      } else if (effect.type === 'gain_mp') {
        player.mp = Math.min(effectiveMpMax, player.mp + this.number(effect.value));
      } else {
        player.hp = Math.min(effectiveHpMax, player.hp + this.number(effect.heal));
        player.mp = Math.min(effectiveMpMax, player.mp + this.number(effect.mp));
      }
    }
    player.pendingBattleEffects = [
      ...(player.pendingBattleEffects ?? []),
      ...prepared,
    ];
    player.updatedAt = Date.now();
    await this.db.playerStates.put(player);
    if (stack.quantity === 1) await this.db.inventoryStacks.delete(stackId);
    else {
      stack.quantity -= 1;
      stack.updatedAt = Date.now();
      await this.db.inventoryStacks.put(stack);
    }
  }

  async endTurn(profileId: string, battleId: string): Promise<void> {
    this.assertPrepared();
    const session = await this.getOngoing(profileId, battleId);
    const state = session.state;
    this.assertPlayerPhase(state);
    this.assertNoPendingCardChoice(state);
    this.runWorkshopMechanisms(state, 'turn_end');
    this.log(state, 'system', '结束玩家回合');
    this.applyPlayerEndTurnEffects(state);

    this.resolveSummons(state);
    if (state.companion) {
      state.phase = 'companion';
      this.applyStartOfTurnEffects(state, state.companion);
      for (const summon of state.companion.summons) {
        if (summon.hp > 0) this.applyStartOfTurnEffects(state, summon);
      }
      this.stabilizeCompanion(state);
      this.animation(state, {
        kind: 'turn',
        sourceSide: 'system',
        phaseAfter: 'companion',
        turnAfter: state.turn,
        label: state.companion.injured ? '凯利安重伤' : '凯利安行动',
      });
      this.resolveCaelianActions(state);
      this.resolveTrelioSummon(state);
    }
    state.phase = 'enemy';
    this.animation(state, {
      kind: 'turn',
      sourceSide: 'system',
      phaseAfter: 'enemy',
      turnAfter: state.turn,
      label: '敌方行动',
    });
    this.resolveBossMechanicTurn(state);
    this.runWorkshopMechanisms(state, 'before_enemy_turn');
    if (this.aliveEnemies(state).length === 0) {
      await this.finishBattle(session, 'victory');
      return;
    }

    if (
      state.workshopTest?.opponentMode === 'dummy' &&
      !state.workshopTest.dummyAttackEnabled
    ) {
      this.log(state, 'system', '测试木桩已设置为不主动攻击。');
    } else {
      for (const enemy of this.enemyTurnOrder(state)) {
        const monster = this.monsters?.[enemy.definitionId];
        this.applyStartOfTurnEffects(state, enemy);
        this.stabilizeWorkshopTest(state);
        if (enemy.hp <= 0) continue;
        if (enemy.debuffs.freeze) {
          this.log(state, 'enemy', `${enemy.name} 被冰冻，跳过行动`);
          this.animation(state, {
            kind: 'status',
            sourceSide: 'enemy',
            sourceId: enemy.id,
            targetSide: 'enemy',
            targetId: enemy.id,
            label: '冰冻',
          });
          continue;
        }
        this.resolveEnemyAction(state, enemy, monster);
        this.stabilizeWorkshopTest(state);
        if (state.player.hp <= 0) {
          await this.finishBattle(session, 'defeat');
          return;
        }
      }
    }
    this.runWorkshopMechanisms(state, 'after_enemy_turn');

    this.tickEffects(state.player);
    for (const summon of state.player.summons) {
      this.tickEffects(this.normalizePlayerSummon(summon));
    }
    if (state.companion) {
      this.tickEffects(state.companion);
      for (const summon of state.companion.summons) this.tickEffects(summon);
      this.stabilizeCompanion(state);
    }
    for (const enemy of this.aliveEnemies(state)) this.tickEffects(enemy);
    if (state.player.hp <= 0) {
      await this.finishBattle(session, 'defeat');
      return;
    }
    if (this.aliveEnemies(state).length === 0) {
      await this.finishBattle(session, 'victory');
      return;
    }

    state.turn += 1;
    state.phase = 'player';
    state.player.cardsPlayedThisTurn = {};
    state.player.cardNamesPlayedThisTurn = {};
    if (state.player.subclass === 'arcane_mage') this.resolveChants(state);
    this.syncAbyssEcho(state);
    if (state.player.subclass === 'blacksmith') {
      const heat = this.classResource(state, 'furnace_heat');
      if (heat > 0) this.setClassResource(state, 'furnace_heat', heat - 1);
    }
    if (
      state.player.subclass === 'vampire_hunter' &&
      state.turn >= 5 &&
      !state.player.buffs.blood_moon
    ) {
      this.addTimedEffect(state.player.buffs, 'blood_moon', 1, 99, {
        undispellable: true,
      });
      this.setClassResource(state, 'hunter_prepare', 0);
    }
    state.player.ap = state.player.apMax;
    const mpRegen =
      (this.rules?.mpRegenBase ?? 3) +
      Math.floor(state.player.mpMax / (this.rules?.mpRegenDivisor ?? 30));
    state.player.mp = Math.min(state.player.mpMax, state.player.mp + mpRegen);
    this.applyStartOfTurnEffects(state, state.player);
    this.stabilizeWorkshopTest(state);
    if (state.player.hp <= 0) {
      await this.finishBattle(session, 'defeat');
      return;
    }
    this.applyTurnStartPassives(state, profileId);
    this.triggerBlankGenerators(state);
    this.drawCards(state, state.player.drawPerTurn);
    this.runWorkshopMechanisms(state, 'turn_start');
    const aliveEnemies = this.aliveEnemies(state);
    for (const enemy of aliveEnemies) {
      const monster = this.monsters?.[enemy.definitionId];
      enemy.intent = monster
        ? this.chooseIntent(monster, enemy, aliveEnemies)
        : null;
    }
    this.log(
      state,
      'system',
      `第 ${state.turn} 回合：回复 ${mpRegen} MP，抽取手牌`,
    );
    this.animation(state, {
      kind: 'turn',
      sourceSide: 'system',
      targetSide: 'player',
      targetId: 'player',
      apAfter: state.player.ap,
      mpAfter: state.player.mp,
      phaseAfter: 'player',
      turnAfter: state.turn,
      label: `第 ${state.turn} 回合`,
    });
    await this.save(session);
  }

  async surrender(profileId: string, battleId: string): Promise<void> {
    const session = await this.getOngoing(profileId, battleId);
    if (session.state.workshopTest) {
      session.state.status = 'surrendered';
      session.state.phase = 'ended';
      this.log(session.state, 'system', '已结束创意工坊测试；正式角色数据未发生变化。');
      await this.save(session);
      return;
    }
    const player = await this.db.playerStates.get(profileId);
    if (!player) throw new Error('玩家档案不存在');
    const hpLossRate = 0.15 + this.random() * 0.3;
    const goldLossRate = 0.1 + this.random() * 0.7;
    const hpLoss = Math.max(1, Math.round(session.state.player.hp * hpLossRate));
    const goldLoss = Math.min(player.gold, Math.round(player.gold * goldLossRate));
    session.state.player.hp = Math.max(1, session.state.player.hp - hpLoss);
    player.hp = this.clamp(
      session.state.player.hp,
      1,
      session.state.player.hpMax,
    );
    player.mp = this.clamp(
      session.state.player.mp,
      0,
      session.state.player.mpMax,
    );
    player.gold -= goldLoss;
    session.state.player.gold = player.gold;
    player.updatedAt = Date.now();
    await this.db.playerStates.put(player);
    session.state.status = 'surrendered';
    session.state.phase = 'ended';
    this.log(
      session.state,
      'system',
      `撤退成功：损失 ${hpLoss} HP 与 ${goldLoss} 金币`,
    );
    await this.save(session);
  }

  async finish(profileId: string, battleId: string): Promise<void> {
    const session = await this.db.battleSessions.get(battleId);
    if (!session || session.profileId !== profileId) throw new Error('战斗不存在');
    if (session.state.status === 'ongoing') {
      throw new Error('进行中的战斗不能直接关闭');
    }
    await this.db.battleSessions.update(battleId, {
      active: false,
      updatedAt: Date.now(),
    });
  }

  async claimReward(
    profileId: string,
    input: {
      battleId: string;
      kind: 'card' | 'equipment' | 'relic';
      choiceId?: string;
    },
  ): Promise<void> {
    this.assertPrepared();
    const session = await this.db.battleSessions.get(input.battleId);
    if (
      !session ||
      session.profileId !== profileId ||
      !session.active ||
      session.state.status !== 'victory'
    ) {
      throw new Error('可领取奖励的战斗不存在');
    }
    const choices = session.state.rewardChoices;
    if (!choices) throw new Error('本场战斗没有额外奖励');
    const now = Date.now();
    if (input.kind === 'card') {
      if (choices.cardClaimed) throw new Error('卡牌奖励已经处理');
      if (input.choiceId) {
        if (!choices.cardIds.includes(input.choiceId)) throw new Error('卡牌不在候选列表中');
        const id = `${profileId}:${input.choiceId}`;
        const current = await this.db.ownedCards.get(id);
        await this.db.ownedCards.put({
          id,
          profileId,
          cardId: input.choiceId,
          quantity: (current?.quantity ?? 0) + 1,
          source: current?.source ?? 'battle-reward',
          updatedAt: now,
        });
      }
      choices.cardClaimed = true;
    } else if (input.kind === 'equipment') {
      if (choices.equipmentClaimed) throw new Error('装备奖励已经处理');
      if (input.choiceId) {
        if (!choices.equipmentIds.includes(input.choiceId)) throw new Error('装备不在候选列表中');
        const definition = this.equipment?.[input.choiceId];
        if (!definition) throw new Error('装备定义不存在');
        const stars = choices.levelsGained > 0 ? 2 : 1;
        await this.db.equipmentInstances.add({
          id: `${profileId}:${definition.id}:battle:${now}:${Math.floor(this.random() * 1_000_000)}`,
          profileId,
          baseId: definition.id,
          name: `${definition.name} ${'★'.repeat(stars)}`,
          slot: definition.slot,
          rarity: definition.rarity,
          stars,
          stats: scaleEquipmentStatsByStars(definition.stats, stars),
          description: `${definition.description}（战斗奖励）`,
          updatedAt: now,
        });
      }
      choices.equipmentClaimed = true;
    } else {
      if (choices.relicClaimed) throw new Error('藏品奖励已经处理');
      if (input.choiceId) {
        if (!choices.relicIds.includes(input.choiceId)) throw new Error('藏品不在候选列表中');
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
      choices.relicClaimed = true;
    }
    if (input.kind !== 'card') {
      await this.syncClaimedLevelReward(profileId, choices);
    }
    await this.save(session);
  }

  private async startWorkshopTest(
    profileId: string,
    player: PlayerRecord,
    input: WorkshopTestInput,
  ): Promise<void> {
    if (!player.created) throw new Error('请先创建角色，再进入创意工坊测试场');
    const candidate = readWorkshopTestCandidate(input.professionId);
    const profession = candidate?.profession;
    if (!candidate || !profession) {
      throw new Error('请选择一个已经保存到本地的自制职业');
    }
    const candidateCards = Object.fromEntries(
      profession.cards.map((card) => [card.id, structuredClone(card)]),
    );
    const deckIds = [...(input.deckIds ?? profession.starterDeck)];
    if (deckIds.length !== 15) {
      throw new Error('创意工坊测试牌组必须正好包含 15 张卡牌');
    }
    if (deckIds.some((cardId) => !candidateCards[cardId])) {
      throw new Error('该职业的测试牌组不完整，请重新校验并保存职业');
    }
    const poolCounts = profession.cardPool.reduce<Record<string, number>>(
      (counts, cardId) => {
        counts[cardId] = (counts[cardId] ?? 0) + 1;
        return counts;
      },
      {},
    );
    const deckCounts = deckIds.reduce<Record<string, number>>(
      (counts, cardId) => {
        counts[cardId] = (counts[cardId] ?? 0) + 1;
        return counts;
      },
      {},
    );
    if (
      Object.entries(deckCounts).some(
        ([cardId, count]) => count > (poolCounts[cardId] ?? 0),
      )
    ) {
      throw new Error('创意工坊测试牌组数量不能超过候选职业卡池持有数');
    }

    const attributeBudget = 99 * STAT_POINTS_PER_LEVEL;
    const apCount = Math.max(0, Math.floor(input.attributes.actionPointsPerTurn));
    const apCost = Math.min(apCount, 6) * 2 + Math.max(0, apCount - 6) * 3;
    const attributeSpent =
      Math.max(0, Math.floor(input.attributes.hpMax)) +
      Math.max(0, Math.floor(input.attributes.mpMax)) +
      Math.max(0, Math.floor(input.attributes.attack)) +
      Math.max(0, Math.floor(input.attributes.defense)) +
      Math.max(0, Math.floor(input.attributes.speed)) +
      Math.max(0, Math.floor(input.attributes.lifesteal ?? 0)) *
        LIFESTEAL_STAT_POINT_COST +
      apCost;
    if (attributeSpent > attributeBudget) {
      throw new Error(`满级测试角色最多可分配 ${attributeBudget} 点属性`);
    }

    const requestedMechanisms = [
      ...new Set([...(profession.mechanismIds ?? []), ...input.mechanismIds]),
    ];
    const mechanismCatalog = new Map(
      [
        ...readWorkshopMechanisms(),
        ...candidate.mechanisms,
      ].map((entry) => [entry.id, entry]),
    );
    const missingMechanisms = requestedMechanisms.filter(
      (id) => !mechanismCatalog.has(id),
    );
    if (missingMechanisms.length) {
      throw new Error(`缺少职业依赖的底层机制：${missingMechanisms.join('、')}`);
    }
    const candidateMechanisms = requestedMechanisms.flatMap((id) => {
      const mechanism = mechanismCatalog.get(id);
      return mechanism ? [structuredClone(mechanism)] : [];
    });
    const testPlayerRecord: PlayerRecord = {
      ...player,
      name: `${player.name} · 测试`,
      classMain: profession.main,
      subclass: profession.id,
      level: 100,
      experience: 0,
      experienceToNext: 5050,
      hp: 80 + input.attributes.hpMax * 5,
      hpMax: 80 + input.attributes.hpMax * 5,
      mp: 30 + input.attributes.mpMax * 5,
      mpMax: 30 + input.attributes.mpMax * 5,
      attack: 8 + input.attributes.attack,
      defense: 5 + input.attributes.defense,
      speed: 5 + input.attributes.speed,
      actionPointsPerTurn: 5 + apCount,
      drawPerTurn: 5,
      lifesteal: this.clamp(
        input.attributes.lifesteal ?? 0,
        0,
        LIFESTEAL_CAP,
      ),
      statPoints: attributeBudget - attributeSpent,
      gold: 0,
      pendingBattleEffects: [],
    };
    const battlePlayer = this.makePlayer(testPlayerRecord, deckIds, []);
    const opponentMode = input.opponentMode ?? 'dummy';
    const dummyCount = this.clamp(Math.floor(input.dummyCount), 1, 8);
    const dummyHp = this.clamp(Math.floor(input.dummyHp), 1, 1_000_000);
    const dummyAttack = this.clamp(Math.floor(input.dummyAttack), 0, 100_000);
    const dummyDefense = this.clamp(Math.floor(input.dummyDefense), 0, 100_000);
    const enemies: BattleEnemyState[] =
      opponentMode === 'dummy'
        ? Array.from({ length: dummyCount }, (_, index) => ({
        id: `workshop_dummy:${index}:${Math.floor(this.random() * 1_000_000)}`,
        definitionId: 'workshop_dummy',
        name: dummyCount > 1 ? `测试木桩 ${index + 1}` : '测试木桩',
        hp: dummyHp,
        hpMax: dummyHp,
        shield: 0,
        attack: dummyAttack,
        defense: dummyDefense,
        speed: 0,
        difficulty: 'test',
        tags: ['workshop-test', 'dummy'],
        xp: 0,
        gold: [0, 0],
        loot: [],
        buffs: {},
        debuffs: {},
        intent: input.dummyAttackEnabled
          ? {
              skillId: 'workshop-test-hit',
              name: '测试攻击',
              kind: 'attack',
              description: '由创意工坊测试场生成的攻击。',
              amount: dummyAttack,
              hits: 1,
            }
          : null,
          }))
        : this.makeWorkshopRandomEnemies(
            battlePlayer,
            opponentMode,
            input.randomTier ?? 'mixed',
            dummyCount,
            input.enemyScale ?? 1,
            input.randomSeed,
          );
    const state: LocalBattleState = {
      schemaVersion: 1,
      difficulty: 'normal',
      status: 'ongoing',
      phase: 'player',
      turn: 1,
      selectedTarget: 0,
      player: battlePlayer,
      enemies,
      rewards: null,
      workshopTest: {
        professionId: profession.id,
        opponentMode,
        candidateCards,
        candidateTalent: {
          name: profession.talent.name || `${profession.name}天赋`,
          effects: structuredClone(profession.talent.effects),
        },
        candidateMechanisms,
        dummyInvincible: input.dummyInvincible,
        dummyAttackEnabled: input.dummyAttackEnabled,
        autoRespawn: input.autoRespawn,
        playerInvincible: input.playerInvincible,
        respawns: 0,
        attributeBudget,
        attributeSpent,
      },
      log: [],
      animations: [],
    };
    this.initializeWorkshopMechanisms(
      state,
      profession.id,
      requestedMechanisms,
    );
    this.drawCards(state, battlePlayer.initialDraw);
    this.applyBattleStartEffectList(
      state,
      profession.talent.name || `${profession.name}天赋`,
      profession.talent.effects,
    );
    this.runWorkshopMechanisms(state, 'battle_start');
    if (opponentMode !== 'dummy') {
      for (const enemy of enemies) {
        const definition = this.monsters?.[enemy.definitionId];
        enemy.intent = definition
          ? this.chooseIntent(definition, enemy, enemies)
          : null;
      }
    }
    this.log(
      state,
      'system',
      opponentMode === 'dummy'
        ? `创意工坊测试开始：Lv.100 ${profession.name}，${dummyCount} 个测试木桩。`
        : `创意工坊实战测试开始：Lv.100 ${profession.name}，对手为${enemies
            .map((enemy) => enemy.name)
            .join('、')}。`,
    );
    const now = Date.now();
    const session: BattleSessionRecord = {
      id: `battle:${profileId}:workshop:${now}:${Math.floor(this.random() * 1_000_000)}`,
      profileId,
      active: true,
      source: `创意工坊测试场 · ${profession.name}`,
      storyTriggered: false,
      relatedQuestId: '',
      turn: 1,
      phase: 'player',
      state,
      updatedAt: now,
    };
    await this.db.battleSessions.add(session);
  }

  private makeWorkshopRandomEnemies(
    player: BattlePlayerState,
    mode: 'random-single' | 'random-multi',
    tier: 'low' | 'high' | 'mixed',
    requestedCount: number,
    rawScale: number,
    seed?: number,
  ): BattleEnemyState[] {
    const random = this.seededWorkshopRandom(seed);
    const entries = Object.entries(this.monsters ?? {}).filter(
      (entry): entry is [string, MonsterDefinition] =>
        Boolean(entry[1]) &&
        !this.isBossMonster(entry[1]) &&
        Object.keys(entry[1].skills ?? {}).length > 0,
    );
    const low = entries.filter(([, monster]) =>
      ['easy', 'normal'].includes(String(monster.difficulty ?? 'normal')),
    );
    const high = entries.filter(([, monster]) =>
      ['hard', 'nightmare'].includes(String(monster.difficulty ?? 'normal')),
    );
    const count = mode === 'random-single'
      ? 1
      : this.clamp(Math.floor(requestedCount), 2, 5);
    const selected: Array<[string, MonsterDefinition]> = [];
    const take = (source: Array<[string, MonsterDefinition]>): void => {
      const available = source.filter(
        ([id]) => !selected.some(([selectedId]) => selectedId === id),
      );
      const pool = available.length ? available : source;
      if (!pool.length) return;
      selected.push(pool[Math.floor(random() * pool.length)]!);
    };

    if (mode === 'random-multi' && tier === 'mixed') {
      take(low);
      take(high);
    }
    while (selected.length < count) {
      const pool =
        tier === 'low'
          ? low
          : tier === 'high'
            ? high
            : random() < 0.5
              ? low
              : high;
      take(pool.length ? pool : entries);
    }
    if (!selected.length) throw new Error('当前怪物目录没有可用于测试的普通怪物');

    const scale = this.clamp(rawScale, 0.5, 2.5);
    const packScale = this.packStrengthMultiplier(selected.length);
    return selected.map(([id, monster], index) => {
      const enemy = this.makeEnemy(
        id,
        monster,
        100,
        'normal',
        '伊拉亚城',
        player,
        packScale,
        index,
      );
      enemy.hpMax = Math.max(1, Math.round(enemy.hpMax * scale));
      enemy.hp = enemy.hpMax;
      enemy.attack = Math.max(1, Math.round(enemy.attack * scale));
      enemy.defense = Math.max(0, Math.round(enemy.defense * scale));
      return enemy;
    });
  }

  private seededWorkshopRandom(seed?: number): () => number {
    if (!Number.isFinite(seed)) return this.random;
    let state = (Math.floor(seed ?? 0) >>> 0) || 0x9e3779b9;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0x1_0000_0000;
    };
  }

  private makePlayer(
    player: PlayerRecord,
    cardIds: string[],
    equipment: Array<{ stats: Record<string, number> }>,
  ): BattlePlayerState {
    const bonus = aggregateEquipmentStats(equipment);
    const hpMax = Math.max(1, player.hpMax + bonus.hpMax);
    const mpMax = Math.max(0, player.mpMax + bonus.mpMax);
    const instances = this.shuffle(
      cardIds.map((cardId, index) => ({
        instanceId: `${cardId}:${index}:${Math.floor(this.random() * 1_000_000)}`,
        cardId,
      })),
    );
    return {
      name: player.name,
      subclass: player.subclass,
      hp: Math.min(hpMax, player.hp),
      hpMax,
      mp: Math.min(mpMax, player.mp),
      mpMax,
      shield: 0,
      attack: Math.max(0, player.attack + bonus.attack),
      defense: Math.max(0, player.defense + bonus.defense),
      speed: Math.max(0, player.speed + bonus.speed),
      ap: Math.max(
        1,
        player.actionPointsPerTurn + bonus.actionPointsPerTurn,
      ),
      apMax: Math.max(
        1,
        player.actionPointsPerTurn + bonus.actionPointsPerTurn,
      ),
      initialDraw: this.rules?.initialDraw ?? 5,
      drawPerTurn:
        (this.rules?.baseDrawPerTurn ?? 3) + bonus.drawPerTurn,
      handLimit: this.rules?.handLimit ?? 10,
      drawPile: instances,
      discardPile: [],
      hand: [],
      buffs: {},
      debuffs: {},
      summons: [],
      chants: [],
      passiveEffects: [],
      gold: player.gold,
      classResources: {},
      sanity: 100,
      abyssEcho: 0,
      // The 30% limit belongs to allocated/base stats only. Equipment is an
      // external source and may raise the effective battle value above it.
      lifesteal:
        this.clamp(player.lifesteal, 0, LIFESTEAL_CAP) +
        Math.max(0, bonus.lifesteal),
      cardsPlayedThisTurn: {},
      cardNamesPlayedThisTurn: {},
      abyssEchoBatches: [],
      lastElementalistElement: '',
      summonsLost: 0,
    };
  }

  private chooseEncounter(
    region: string,
    playerLevel: number,
  ): readonly [string, MonsterDefinition | undefined] {
    const all = Object.entries(this.monsters ?? {});
    const regional = all.filter(([, monster]) =>
      monster.regions?.includes(region),
    );
    const pool = regional.length > 0 ? regional : all;
    const difficultyWeight: Record<string, number> = {
      easy: 1.4,
      normal: 1,
      hard: 0.75,
      nightmare: 0.55,
    };
    const chosen = this.weightedChoice(pool, ([, monster]) => {
      const minimumLevel = this.number(monster.level_range?.[0], 1);
      const levelGap = Math.max(0, minimumLevel - playerLevel);
      const difficulty =
        difficultyWeight[String(monster.difficulty ?? 'normal')] ?? 1;
      return Math.max(1, Math.round((30 * difficulty) / (1 + levelGap * 0.9)));
    });
    return chosen ?? all[0] ?? ['', undefined];
  }

  private assertOwnedDeck(
    cardIds: string[],
    ownedCards: Array<{ cardId: string; quantity: number }>,
  ): void {
    const ownedCounts = ownedCards.reduce<Map<string, number>>((counts, entry) => {
      counts.set(entry.cardId, (counts.get(entry.cardId) ?? 0) + entry.quantity);
      return counts;
    }, new Map());
    const requestedCounts = cardIds.reduce<Map<string, number>>((counts, cardId) => {
      counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
      return counts;
    }, new Map());
    for (const [cardId, requested] of requestedCounts) {
      const owned = Math.max(0, ownedCounts.get(cardId) ?? 0);
      if (requested > owned) {
        throw new Error(
          owned > 0
            ? `牌组中的 ${cardId} 需要 ${requested} 张，当前仅持有 ${owned} 张`
            : `尚未拥有牌组中的 ${cardId}`,
        );
      }
    }
  }

  private chooseEncounterPack(
    region: string,
    playerLevel: number,
    lead: readonly [string, MonsterDefinition],
    count: number,
  ): Array<readonly [string, MonsterDefinition]> {
    const pack: Array<readonly [string, MonsterDefinition]> = [lead];
    if (count <= 1 || this.isBossMonster(lead[1])) return pack;

    const all = Object.entries(this.monsters ?? {}).filter(
      (entry): entry is [string, MonsterDefinition] =>
        Boolean(entry[1]) && !this.isBossMonster(entry[1]),
    );
    const regional = all.filter(([, monster]) =>
      monster.regions?.includes(region),
    );
    const levelCompatible = regional.filter(([, monster]) => {
      const minimum = this.number(monster.level_range?.[0], 1);
      const maximum = this.number(monster.level_range?.[1], 99);
      return minimum <= playerLevel + 3 && maximum >= Math.max(1, playerLevel - 8);
    });
    const candidates =
      levelCompatible.length > 0
        ? levelCompatible
        : regional.length > 0
          ? regional
          : all;
    const used = new Set([lead[0]]);

    while (pack.length < count) {
      const unused = candidates.filter(([id]) => !used.has(id));
      const pool = unused.length > 0 ? unused : candidates;
      const chosen = this.weightedChoice(pool, ([, monster]) => {
        const minimum = this.number(monster.level_range?.[0], 1);
        const levelGap = Math.abs(minimum - playerLevel);
        const roleBonus = Object.values(monster.skills ?? {}).some((skill) =>
          skill.effects?.some(
            (effect) =>
              effect.target === 'all_enemies' || effect.type === 'cleanse',
          ),
        )
          ? 1.45
          : 1;
        return Math.max(1, Math.round((28 * roleBonus) / (1 + levelGap * 0.24)));
      });
      if (!chosen) {
        pack.push(lead);
        continue;
      }
      pack.push(chosen);
      used.add(chosen[0]);
    }
    return pack;
  }

  private resolveMonsterId(input: string): string | undefined {
    const value = input.trim();
    if (this.monsters?.[value]) return value;
    const normalized = value.replace(/[\s·・_\-—]+/g, '').toLowerCase();
    return Object.entries(this.monsters ?? {}).find(([id, monster]) =>
      [id, monster.name].some(
        (candidate) =>
          candidate.replace(/[\s·・_\-—]+/g, '').toLowerCase() === normalized,
      ),
    )?.[0];
  }

  private explorationCount(
    monster: MonsterDefinition,
    difficulty: keyof typeof DIFFICULTY_SCALE,
  ): number {
    if (this.isBossMonster(monster)) return 1;
    const groupChance = {
      easy: 0.18,
      normal: 0.32,
      hard: 0.46,
      hell: 0.58,
    }[difficulty];
    const monsterModifier =
      monster.difficulty === 'nightmare'
        ? 0.42
        : monster.difficulty === 'hard'
          ? 0.7
          : 1;
    if (this.random() > groupChance * monsterModifier) return 1;
    if (difficulty === 'hell' && this.random() < 0.18) return 4;
    return this.random() < 0.36 ? 3 : 2;
  }

  private isBossMonster(monster: MonsterDefinition): boolean {
    const data = monster as Record<string, unknown>;
    const text = [
      monster.id,
      monster.name,
      ...(monster.tags ?? []),
      data.type,
      data.rank,
      data.category,
    ]
      .map((value) => String(value ?? ''))
      .join(' ')
      .toLowerCase();
    return (
      data.boss === true ||
      data.is_boss === true ||
      Boolean(data.boss_mechanic) ||
      /boss|首领|领主|魔王|君主|灾厄|最终|深渊之主/.test(text)
    );
  }

  private packStrengthMultiplier(count: number): number {
    if (count <= 1) return 1;
    if (count === 2) return 0.92;
    if (count === 3) return 0.84;
    if (count <= 5) return 0.74;
    if (count <= 8) return 0.64;
    return 0.58;
  }

  private makeEnemy(
    definitionId: string,
    monster: MonsterDefinition,
    playerLevel: number,
    userDifficulty: keyof typeof DIFFICULTY_SCALE,
    region: string,
    player: BattlePlayerState,
    packScale: number,
    instanceIndex: number,
  ): BattleEnemyState {
    const affix = this.pickEnemyAffix(monster, packScale);
    const intrinsic =
      MONSTER_SCALE[String(monster.difficulty ?? 'normal')] ??
      MONSTER_SCALE.normal!;
    const minLevel = this.number(monster.level_range?.[0], 1);
    const maxLevel = this.number(monster.level_range?.[1], 20);
    const targetLevel = Math.max(minLevel, Math.min(maxLevel, playerLevel));
    const levelDelta = Math.max(0, targetLevel - 1);
    const userScale = DIFFICULTY_SCALE[userDifficulty];
    const regionScale = REGION_SCALE[region] ?? {
      hp: 1,
      attack: 1,
      defense: 1,
    };
    const hpReference = this.clamp(player.hpMax / 80, 0.75, 2.4);
    const attackReference = this.clamp(player.attack / 8, 0.75, 2.5);
    const defenseReference = this.clamp(player.defense / 5, 0.75, 2.5);
    const speedReference = this.clamp(player.speed / 5, 0.75, 2.2);
    const powerScale = this.clamp(
      0.92 +
        (hpReference * 0.24 +
          attackReference * 0.34 +
          defenseReference * 0.24 +
          speedReference * 0.18 -
          1) *
          0.22,
      0.86,
      1.3,
    );
    const configuredVariance = Array.isArray(monster.stat_variance)
      ? monster.stat_variance
      : undefined;
    const [varianceMin, varianceMax] =
      configuredVariance && configuredVariance.length >= 2
        ? [
            this.number(configuredVariance[0], 0.86),
            this.number(configuredVariance[1], 1.18),
          ]
        : MONSTER_VARIANCE[String(monster.difficulty ?? 'normal')] ??
          MONSTER_VARIANCE.normal!;
    const variance =
      varianceMin + this.random() * Math.max(0, varianceMax - varianceMin);
    const hpMax = Math.max(
      1,
      Math.round(
        this.number(monster.hp, 1) *
          (1 + levelDelta * 0.105) *
          intrinsic.hp *
          userScale *
          regionScale.hp *
          powerScale *
          packScale *
          variance *
          (affix?.hp ?? 1),
      ),
    );
    const gold = Array.isArray(monster.gold)
      ? [
          this.number(monster.gold[0]),
          this.number(monster.gold[1], this.number(monster.gold[0])),
        ]
      : [this.number(monster.gold), this.number(monster.gold)];
    const enemy: BattleEnemyState = {
      id: `${definitionId}:${instanceIndex}:${Math.floor(this.random() * 1_000_000)}`,
      definitionId,
      name: `${affix?.name ?? ''}${monster.name}${
        instanceIndex > 0 ? ` ${instanceIndex + 1}` : ''
      }`,
      level: targetLevel,
      hp: hpMax,
      hpMax,
      shield: 0,
      attack: Math.max(
        1,
        Math.round(
          this.number(monster.attack, 1) *
            (1 + levelDelta * 0.08) *
            intrinsic.attack *
            userScale *
            regionScale.attack *
            powerScale *
            packScale *
            variance *
            (affix?.attack ?? 1),
        ),
      ),
      defense: Math.max(
        0,
        Math.round(
          this.number(monster.defense) *
            (1 + levelDelta * 0.06) *
            intrinsic.defense *
            userScale *
            regionScale.defense *
            Math.sqrt(powerScale) *
            packScale *
            variance *
            (affix?.defense ?? 1),
        ),
      ),
      speed: Math.max(
        0,
        Math.round(
          this.number(monster.speed) *
            Math.sqrt(userScale) *
            Math.sqrt(powerScale) *
            variance *
            (affix?.speed ?? 1),
        ),
      ),
      difficulty: String(monster.difficulty ?? 'normal'),
      tags: monster.tags?.map(String) ?? [],
      xp: Math.max(
        0,
        Math.round(
          this.number(monster.xp) *
            (1 + levelDelta * 0.05) *
            userScale *
            packScale *
            (affix ? 1.12 : 1),
        ),
      ),
      gold: [
        Math.max(
          0,
          Math.round(
            Math.min(gold[0]!, gold[1]!) *
              (1 + levelDelta * 0.04) *
              userScale *
              packScale *
              (affix ? 1.1 : 1),
          ),
        ),
        Math.max(
          0,
          Math.round(
            Math.max(gold[0]!, gold[1]!) *
              (1 + levelDelta * 0.04) *
              userScale *
              packScale *
              (affix ? 1.1 : 1),
          ),
        ),
      ],
      loot: (monster.loot ?? []).map((item) => ({
        id: String(item.id ?? item.name ?? 'unknown-loot'),
        name: String(item.name ?? item.id ?? '未知战利品'),
        chance: Math.max(0, Math.min(1, this.number(item.chance))),
      })),
      buffs: {},
      debuffs: {},
      ...(affix
        ? {
            affix: affix.id,
            affixName: affix.name,
            ...(affix.onHitDebuff ? { onHitDebuff: affix.onHitDebuff } : {}),
          }
        : {}),
      patternIndex: 0,
      nonDamageActionStreak: 0,
      intent: null,
    };
    this.applyEnemyInitialStatuses(enemy, monster, affix);
    return enemy;
  }

  private pickEnemyAffix(
    monster: MonsterDefinition,
    packScale: number,
  ): EnemyInstanceAffix | undefined {
    if (this.isBossMonster(monster)) return undefined;
    const difficulty = String(monster.difficulty ?? 'normal');
    const baseChance =
      (packScale < 1 ? 0.34 : 0.24) +
      (difficulty === 'nightmare' ? 0.12 : difficulty === 'hard' ? 0.07 : 0);
    if (this.random() > baseChance) return undefined;
    return this.weightedChoice(ENEMY_INSTANCE_AFFIXES, (entry) =>
      Math.max(1, entry.chance),
    );
  }

  private applyEnemyInitialStatuses(
    enemy: BattleEnemyState,
    monster: MonsterDefinition,
    affix?: EnemyInstanceAffix,
  ): void {
    for (const buff of monster.battle_start_buffs ?? []) {
      this.addTimedEffect(
        enemy.buffs,
        String(buff.buff ?? buff.key ?? 'strength'),
        this.number(buff.value),
        this.number(buff.turns, 1),
        {
          charges: this.optionalPositiveNumber(buff.charges),
          undispellable: buff.undispellable === true,
        },
      );
    }
    for (const debuff of monster.battle_start_debuffs ?? []) {
      this.addTimedEffect(
        enemy.debuffs,
        String(debuff.debuff ?? debuff.key ?? 'weak'),
        this.number(debuff.value),
        this.number(debuff.turns, 1),
        {
          charges: this.optionalPositiveNumber(debuff.charges),
          uncleanseable: debuff.uncleanseable === true,
        },
      );
    }
    if (affix?.buff) {
      this.addTimedEffect(
        enemy.buffs,
        affix.buff.key,
        affix.buff.value,
        affix.buff.turns,
        { undispellable: affix.buff.undispellable === true },
      );
    }
  }

  private chooseIntent(
    monster: MonsterDefinition,
    enemy: BattleEnemyState,
    allies: BattleEnemyState[] = [enemy],
  ): BattleIntent | null {
    const lowHpReady =
      enemy.lastSpecial !== 'low_hp' &&
      enemy.hp / Math.max(1, enemy.hpMax) < 0.35;
    const skills = Object.entries(monster.skills ?? {}).filter(
      ([skillId, skill]) =>
        (skillId !== 'low_hp' || lowHpReady) &&
        this.enemySkillIsAvailable(skill, enemy, allies),
    );
    if (skills.length === 0) return null;

    const damagingSkills = skills.filter(([, skill]) =>
      this.enemySkillDealsDamage(skill),
    );
    let chosen: [string, MonsterSkillDefinition] | undefined;
    if ((enemy.nonDamageActionStreak ?? 0) >= 2 && damagingSkills.length > 0) {
      chosen = this.chooseWeightedEnemySkill(damagingSkills, enemy);
    }

    const lowHpSkill = skills.find(([skillId]) => skillId === 'low_hp');
    if (
      !chosen &&
      lowHpSkill &&
      lowHpReady
    ) {
      chosen = lowHpSkill;
      enemy.lastSpecial = 'low_hp';
    }

    const actionSkills = skills.filter(([skillId]) =>
      skillId.startsWith('action_'),
    );
    if (!chosen && actionSkills.length > 0) {
      chosen = this.chooseWeightedEnemySkill(actionSkills, enemy);
    }

    if (!chosen && (monster.patterns?.length ?? 0) > 0) {
      const patterns = monster.patterns!;
      const start = Math.max(0, Math.floor(enemy.patternIndex ?? 0));
      let scheduled:
        | { entry: [string, MonsterSkillDefinition]; index: number }
        | undefined;
      for (let offset = 0; offset < patterns.length; offset += 1) {
        const index = (start + offset) % patterns.length;
        const skillId = patterns[index]!;
        const entry = skills.find(([candidateId]) => candidateId === skillId);
        if (entry) {
          scheduled = { entry, index };
          break;
        }
      }
      if (scheduled) {
        const patternIds = new Set(patterns);
        const supplemental = skills.filter(
          ([skillId, skill]) =>
            skillId !== 'low_hp' &&
            !patternIds.has(skillId) &&
            this.enemySkillTargetsTeam(skill),
        );
        chosen = supplemental.length
          ? this.chooseWeightedEnemySkill(
              [scheduled.entry, ...supplemental],
              enemy,
            )
          : scheduled.entry;
        if (chosen?.[0] === scheduled.entry[0]) {
          enemy.patternIndex = (scheduled.index + 1) % patterns.length;
        } else {
          enemy.patternIndex = scheduled.index;
        }
      }
    }

    chosen ??= this.chooseWeightedEnemySkill(
      skills.filter(([skillId]) => skillId !== 'low_hp'),
      enemy,
    );
    if (!chosen) return null;
    const [skillId, skill] = chosen;
    if (skillId === 'low_hp') enemy.lastSpecial = 'low_hp';
    const damageEffect = skill.effects?.find((effect) =>
      ['damage', 'lifesteal_damage', 'true_damage'].includes(effect.type),
    );
    const hits = Math.max(1, this.number(damageEffect?.hits, 1));
    const amount = damageEffect
      ? this.enemyEffectAmount(enemy, damageEffect)
      : this.number(skill.effects?.[0]?.value);
    return {
      skillId,
      name: skill.name,
      kind: skill.intent ?? this.intentKind(skill),
      description: skill.desc ?? '',
      amount,
      hits,
    };
  }

  private chooseWeightedEnemySkill(
    skills: Array<[string, MonsterSkillDefinition]>,
    enemy: BattleEnemyState,
  ): [string, MonsterSkillDefinition] | undefined {
    const enabled = skills.filter(
      ([, skill]) => this.enemySkillWeight(skill) > 0,
    );
    return this.weightedChoice(enabled, ([skillId, skill]) => {
      const repeatScale = enemy.lastSkillId === skillId ? 0.35 : 1;
      return this.enemySkillWeight(skill) * repeatScale;
    });
  }

  private enemySkillWeight(skill: MonsterSkillDefinition): number {
    if (skill.weight === undefined) return 1;
    return typeof skill.weight === 'number' && Number.isFinite(skill.weight)
      ? Math.max(0, skill.weight)
      : 1;
  }

  private enemySkillDealsDamage(skill: MonsterSkillDefinition): boolean {
    return Boolean(
      skill.effects?.some((effect) =>
        [
          'damage',
          'lifesteal_damage',
          'true_damage',
          'hp_percent_damage',
        ].includes(effect.type),
      ),
    );
  }

  private enemySkillTargetsTeam(skill: MonsterSkillDefinition): boolean {
    return Boolean(
      skill.effects?.some(
        (effect) =>
          effect.target === 'all_enemies' || effect.target === 'enemy_team',
      ),
    );
  }

  private enemySkillIsAvailable(
    skill: MonsterSkillDefinition,
    enemy: BattleEnemyState,
    allies: BattleEnemyState[],
  ): boolean {
    const effects = skill.effects ?? [];
    if (effects.length === 0) return false;
    const teamAction = this.enemySkillTargetsTeam(skill);
    if (teamAction && allies.length <= 1) return false;
    const targets = teamAction ? allies.filter((ally) => ally.hp > 0) : [enemy];
    return effects.some((effect) => {
      if (effect.type === 'heal') {
        return targets.some((target) => target.hp < target.hpMax);
      }
      if (effect.type === 'cleanse') {
        return targets.some((target) => Object.keys(target.debuffs).length > 0);
      }
      return true;
    });
  }

  private resolveEnemyAction(
    state: LocalBattleState,
    enemy: BattleEnemyState,
    monster?: MonsterDefinition,
  ): void {
    const friendlyTarget = this.chooseEnemyFriendlyTarget(state);
    const friendlyIdentity = this.combatantIdentity(state, friendlyTarget);
    const skill = enemy.intent
      ? monster?.skills?.[enemy.intent.skillId]
      : undefined;
    if (!skill) {
      if (this.triggerTrap(state, enemy)) return;
      const amount = Math.max(
        1,
        Math.round(enemy.attack * (this.rules?.enemyAttackScale ?? 0.48)),
      );
      this.animation(state, {
        kind: 'enemy-action',
        sourceSide: 'enemy',
        sourceId: enemy.id,
        targetSide: friendlyIdentity.side,
        targetId: friendlyIdentity.id,
        label: enemy.name,
      });
      this.damage(state, enemy, friendlyTarget, amount, 'enemy', enemy.name);
      this.applyOnHitResponses(state, enemy, friendlyTarget);
      enemy.nonDamageActionStreak = 0;
      enemy.lastSkillId = undefined;
      this.stabilizeCompanion(state);
      return;
    }
    const teamAction = skill.effects?.some(
      (effect) =>
        effect.target === 'all_enemies' || effect.target === 'enemy_team',
    );
    this.log(state, 'enemy', `${enemy.name} 使用「${skill.name}」`);
    this.animation(state, {
      kind: 'enemy-action',
      sourceSide: 'enemy',
      sourceId: enemy.id,
      targetSide: teamAction ? 'enemy' : friendlyIdentity.side,
      targetId: teamAction ? enemy.id : friendlyIdentity.id,
      label: skill.name,
    });
    for (const effect of skill.effects ?? []) {
      if (effect.type === 'damage' || effect.type === 'lifesteal_damage') {
        if (this.triggerTrap(state, enemy)) break;
        const hits = Math.max(1, this.number(effect.hits, 1));
        let hpDamage = 0;
        for (let hit = 0; hit < hits; hit += 1) {
          const amount = Math.max(
            1,
            Math.round(
              this.enemyEffectAmount(enemy, effect) *
                (0.9 + this.random() * 0.24),
            ),
          );
          hpDamage += this.damage(
            state,
            enemy,
            friendlyTarget,
            amount,
            'enemy',
            enemy.name,
          );
          if (friendlyTarget.hp <= 0) break;
        }
        if (effect.type === 'lifesteal_damage' && hpDamage > 0 && enemy.hp > 0) {
          const ratio = this.clamp(
            this.number(effect.lifesteal ?? effect.lifesteal_ratio, 0.35),
            0,
            1,
          );
          const restored = Math.floor(hpDamage * ratio);
          if (restored > 0) this.heal(state, enemy, restored, '吸血', false);
        }
        this.applyOnHitResponses(state, enemy, friendlyTarget);
      } else if (effect.type === 'true_damage') {
        if (this.triggerTrap(state, enemy)) break;
        const hits = Math.max(1, this.number(effect.hits, 1));
        for (let hit = 0; hit < hits; hit += 1) {
          this.directHpLoss(
            state,
            friendlyTarget,
            this.enemyEffectAmount(enemy, effect),
            skill.name,
          );
          if (friendlyTarget.hp <= 0) break;
        }
        this.applyOnHitResponses(state, enemy, friendlyTarget);
      } else if (effect.type === 'hp_percent_damage') {
        if (this.triggerTrap(state, enemy)) break;
        const percent = this.clamp(this.number(effect.percent), 0, 100);
        const uncapped = Math.max(
          percent > 0 ? 1 : 0,
          Math.floor((friendlyTarget.hpMax * percent) / 100),
        );
        const cap = Math.max(0, this.number(effect.cap));
        const amount = cap > 0 ? Math.min(uncapped, cap) : uncapped;
        if (amount > 0) {
          this.directHpLoss(state, friendlyTarget, amount, skill.name);
          this.applyOnHitResponses(state, enemy, friendlyTarget);
        }
      } else if (effect.type === 'strip_player_shield') {
        const removed =
          effect.amount === 'all'
            ? friendlyTarget.shield
            : Math.min(
                friendlyTarget.shield,
                Math.max(0, this.number(effect.value ?? effect.amount)),
              );
        friendlyTarget.shield -= removed;
        if (removed > 0) {
          this.log(state, 'enemy', `${enemy.name}击碎了 ${removed} 点玩家护盾`);
          this.animation(state, {
            kind: 'shield',
            sourceSide: 'enemy',
            sourceId: enemy.id,
            targetSide: friendlyIdentity.side,
            targetId: friendlyIdentity.id,
            amount: -removed,
            shieldAfter: friendlyTarget.shield,
            label: skill.name,
          });
        }
      } else if (effect.type === 'heal') {
        for (const target of this.enemyTeamTargets(state, enemy, effect)) {
          this.heal(
            state,
            target,
            this.enemyEffectAmount(enemy, effect),
            skill.name,
          );
        }
      } else if (effect.type === 'shield') {
        const amount = this.enemyEffectAmount(enemy, effect);
        for (const target of this.enemyTeamTargets(state, enemy, effect)) {
          target.shield += amount;
          this.log(state, 'enemy', `${target.name} 获得 ${amount} 点护盾`);
          this.animation(state, {
            kind: 'shield',
            sourceSide: 'enemy',
            sourceId: enemy.id,
            targetSide: 'enemy',
            targetId: target.id,
            amount,
            shieldAfter: target.shield,
            label: '护盾',
          });
        }
      } else if (effect.type === 'buff' || effect.type === 'apply_buff') {
        const effectName = String(effect.buff ?? 'strength');
        for (const target of this.enemyTeamTargets(state, enemy, effect)) {
          this.addTimedEffect(
            target.buffs,
            effectName,
            this.number(effect.value),
            this.number(effect.turns, 1),
            {
              charges: this.optionalPositiveNumber(effect.charges),
              undispellable: effect.undispellable === true,
            },
          );
          this.animation(state, {
            kind: 'status',
            sourceSide: 'enemy',
            sourceId: enemy.id,
            targetSide: 'enemy',
            targetId: target.id,
            amount: this.number(effect.value),
            label: effectName,
          });
        }
      } else if (effect.type === 'cleanse') {
        let removed = 0;
        const targets = this.enemyTeamTargets(state, enemy, effect);
        for (const target of targets) {
          const count = this.removeEffects(target.debuffs, effect.amount);
          removed += count;
          if (count > 0) {
            this.animation(state, {
              kind: 'status',
              sourceSide: 'enemy',
              sourceId: enemy.id,
              targetSide: 'enemy',
              targetId: target.id,
              amount: count,
              label: '净化',
            });
          }
        }
        if (removed > 0) {
          this.log(
            state,
            'enemy',
            `${enemy.name} 为怪物队伍净化了 ${removed} 个减益`,
          );
        }
      } else if (effect.type === 'dispel_player_buff') {
        const target = state.player;
        const targetIdentity = this.combatantIdentity(state, target);
        const removed = this.removeEffects(
          target.buffs,
          effect.amount ?? effect.value ?? 1,
        );
        if (removed > 0) {
          this.log(
            state,
            'enemy',
            `${enemy.name} 驱散了${target.name} ${removed} 个强化`,
          );
          this.animation(state, {
            kind: 'status',
            sourceSide: 'enemy',
            sourceId: enemy.id,
            targetSide: targetIdentity.side,
            targetId: targetIdentity.id,
            amount: removed,
            label: '驱散',
          });
        }
      } else if (effect.type === 'debuff' || effect.type === 'apply_debuff') {
        const effectName = String(effect.debuff ?? 'weak');
        this.tryApplyDebuff(
          state,
          friendlyTarget,
          effectName,
          this.number(effect.value, 1),
          this.number(effect.turns, 1),
          {
            charges: this.optionalPositiveNumber(effect.charges),
            uncleanseable: effect.uncleanseable === true,
          },
        );
        this.animation(state, {
          kind: 'status',
          sourceSide: 'enemy',
          sourceId: enemy.id,
          targetSide: friendlyIdentity.side,
          targetId: friendlyIdentity.id,
          amount: this.number(effect.value, 1),
          label: effectName,
        });
      }
    }
    enemy.lastSkillId = enemy.intent?.skillId;
    enemy.nonDamageActionStreak = this.enemySkillDealsDamage(skill)
      ? 0
      : (enemy.nonDamageActionStreak ?? 0) + 1;
  }

  private cardUsesFriendlyTarget(card: CardDefinition): boolean {
    const friendlyTypes = new Set([
      'shield',
      'heal',
      'heal_overflow_shield',
      'spend_mp_shield',
      'apply_buff',
      'thorns',
      'thorns_debuff',
      'cleanse',
      'cleanse_heal_per',
      'cleanse_specific',
      'shield_from_shield',
    ]);
    const hasFriendly = (effects: CardEffect[]): boolean =>
      effects.some((effect) => {
        if (
          friendlyTypes.has(effect.type) &&
          effect.target !== 'enemy' &&
          effect.target !== 'all_enemies'
        ) {
          return true;
        }
        return ['effects', 'then_effects', 'else_effects'].some((key) =>
          Array.isArray(effect[key])
            ? hasFriendly(effect[key] as CardEffect[])
            : false,
        );
      });
    return hasFriendly(card.effects ?? []);
  }

  private applyCardEffects(
    state: LocalBattleState,
    card: CardDefinition,
    targetIndex: number,
    allyTargetId: BattleFriendlyTargetId,
  ): void {
    const target = state.enemies[targetIndex];
    if (!target) return;
    const bonus = this.cardDamageBonus(card, state, target);
    const multiplier = this.cardDamageMultiplier(card, state, target);
    const weaponMasterBonus = this.weaponMasterComboBonus(card, state);
    let weaponMasterBonusApplied = false;
    const cardId = this.activeMechanismCard?.id ?? '';
    for (const rawEffect of card.effects ?? []) {
      const effect = normalizeBuiltInCardEffect(cardId, rawEffect);
      const effectBonus =
        bonus +
        (effect.type === 'damage' && !weaponMasterBonusApplied
          ? weaponMasterBonus
          : 0);
      this.applyCardEffect(
        state,
        card,
        effect,
        targetIndex,
        effectBonus,
        multiplier,
        allyTargetId,
      );
      if (effect.type === 'damage') weaponMasterBonusApplied = true;
      if (this.aliveEnemies(state).length === 0) break;
    }
    const hasDamage = this.cardHasNestedEffect(
      card.effects ?? [],
      (effect) => effect.type === 'damage',
    );
    const hasHeal = this.cardHasNestedEffect(
      card.effects ?? [],
      (effect) => effect.type === 'heal' || effect.type === 'heal_overflow_shield',
    );
    const hasShield = this.cardHasNestedEffect(
      card.effects ?? [],
      (effect) => effect.type === 'shield' || effect.type === 'shield_from_shield',
    );
    if (hasDamage) {
      for (const key of ['empower', 'next_attack_bonus']) {
        this.spendEffectCharge(state.player.buffs, key);
      }
      if (card.type === 'attack') {
        this.spendEffectCharge(state.player.buffs, 'spell_double');
        this.spendEffectCharge(state.player.buffs, 'poison_coat');
      }
    }
    if (this.isSpellCard(card) && (hasDamage || hasHeal || hasShield)) {
      this.spendEffectCharge(state.player.buffs, 'spell_amp_percent');
    }
    if (this.isSpellCard(card) && (hasHeal || hasShield)) {
      this.spendEffectCharge(
        state.player.buffs,
        'spell_heal_shield_amp',
      );
    }
    if (
      hasDamage &&
      this.isSpellCard(card) &&
      this.cardElement(card) === 'thunder'
    ) {
      this.spendEffectCharge(state.player.buffs, 'thunder_spell_amp');
    }
  }

  private applyCardEffect(
    state: LocalBattleState,
    card: CardDefinition,
    effect: CardEffect,
    targetIndex: number,
    bonus = 0,
    multiplier = 1,
    allyTargetId: BattleFriendlyTargetId = 'player',
  ): void {
    effect = this.resolveWorkshopScaling(state, effect);
    const target = state.enemies[targetIndex];
    if (!target) return;
    const cardId = String(
      (card as CardDefinition & { id?: unknown }).id ??
        this.activeMechanismCard?.id ??
        '',
    );
    const aliveTargets = this.aliveEnemies(state);
    const targets =
      effect.target === 'all_enemies'
        ? aliveTargets
        : effect.target === 'random_enemy'
          ? this.shuffle(aliveTargets).slice(
              0,
              Math.max(1, this.number(effect.target_count, 1)),
            )
          : [target].filter((enemy) => enemy.hp > 0);
    switch (effect.type) {
      case 'damage': {
        let totalDamage = 0;
        let killCount = 0;
        const damageTargets: Combatant[] = this.activeDarkPriestRedirect
          ? [state.player]
          : targets;
        const selectedBaseBonus = this.cardDamageBonus(card, state, target);
        const bonusSupplement = bonus - selectedBaseBonus;
        for (const enemy of damageTargets) {
          const battleEnemy = state.enemies.find((entry) => entry === enemy);
          const resolvedBonus =
            this.activeMechanismCard && battleEnemy
              ? this.cardDamageBonus(card, state, battleEnemy) + bonusSupplement
              : bonus;
          const resolvedMultiplier =
            this.activeMechanismCard && battleEnemy
              ? this.cardDamageMultiplier(card, state, battleEnemy)
              : multiplier;
          const base =
            this.activeSummonEffectValue(effect.value) +
            (card.type === 'attack'
              ? Math.floor(
                  state.player.attack * (this.rules?.playerAttackScale ?? 0.35),
                )
              : 0) +
            resolvedBonus;
          const hits = safeCardEffectHits(effect.hits);
          const beforeHp = enemy.hp;
          for (let hit = 0; hit < hits; hit += 1) {
            if (enemy.hp <= 0) break;
            totalDamage += this.damage(
              state,
              this.activePlayerSummonCombatant() ?? state.player,
              enemy,
              Math.max(0, Math.round(base * resolvedMultiplier)),
              'player',
              card.name,
            );
          }
          if (beforeHp > 0 && enemy.hp <= 0) killCount += 1;
          if (
            card.type === 'attack' &&
            state.player.buffs.poison_coat &&
            enemy.hp > 0 &&
            this.combatantIdentity(state, enemy).side === 'enemy'
          ) {
            this.tryApplyDebuff(
              state,
              enemy,
              'poison',
              this.effectValue(state.player.buffs.poison_coat),
              2,
            );
          }
        }
        const lifesteal = Math.round(
          totalDamage * Math.max(0, this.number(effect.lifesteal_ratio)),
        );
        if (lifesteal > 0) this.heal(state, state.player, lifesteal, card.name);
        if (killCount > 0 && this.number(effect.on_kill_gain_mp) > 0) {
          this.restoreMp(
            state,
            killCount * this.number(effect.on_kill_gain_mp),
            `${card.name}击杀`,
          );
        }
        break;
      }
      case 'shield': {
        const shieldBonus = this.passiveEffectValue(
          state,
          'shield_bonus',
        );
        let baseAmount = this.number(effect.value);
        if (state.player.subclass === 'mechanic' && cardId === 'mc_scrap_shield') {
          baseAmount += this.classResource(state, 'parts') * 2;
        }
        if (state.player.subclass === 'thunder_mage' && cardId === 'th_ion_shield') {
          baseAmount += this.classResource(state, 'thunder_charge') * 2;
        }
        baseAmount = this.amplifiedCardEffectValue(
          state,
          card,
          'shield',
          baseAmount,
        );
        const amount = Math.max(
          0,
          Math.round(baseAmount * (1 + shieldBonus)),
        );
        for (const recipient of this.cardFriendlyTargets(
          state,
          effect.target,
          allyTargetId,
        )) {
          this.grantFriendlyShield(state, recipient, amount, card.name);
        }
        break;
      }
      case 'heal': {
        const amount = this.amplifiedCardEffectValue(
          state,
          card,
          'heal',
          this.number(effect.value),
        );
        for (const recipient of this.cardFriendlyTargets(
          state,
          effect.target,
          allyTargetId,
        )) {
          this.heal(state, recipient, amount, card.name);
        }
        break;
      }
      case 'heal_overflow_shield': {
        const amount = this.amplifiedCardEffectValue(
          state,
          card,
          'heal',
          this.number(effect.value),
        );
        for (const recipient of this.cardFriendlyTargets(
          state,
          effect.target,
          allyTargetId,
        )) {
          if (this.isInjuredCompanion(state, recipient)) continue;
          const missing = recipient.hpMax - recipient.hp;
          this.heal(state, recipient, amount, card.name);
          const overflow = Math.max(0, amount - missing);
          this.grantFriendlyShield(
            state,
            recipient,
            Math.round(overflow * this.number(effect.ratio, 1)),
            card.name,
          );
        }
        break;
      }
      case 'draw':
        if (
          !(
            state.player.subclass === 'fire_mage' &&
            cardId === 'fm_ember_return' &&
            this.classResource(state, 'ember_echo') > 0
          )
        ) this.drawCards(state, this.number(effect.value, 1));
        break;
      case 'gain_mp': {
        let requested = this.number(effect.value);
        if (state.player.subclass === 'thunder_mage' && cardId === 'th_current_draw') {
          requested = this.classResource(state, 'thunder_charge') * Math.max(1, requested);
        } else if (state.player.subclass === 'fire_mage' && cardId === 'fm_ember_return') {
          requested = this.classResource(state, 'ember_echo') > 0 ? requested : 0;
        } else if (state.player.subclass === 'wood_mage' && cardId === 'wood_growth') {
          requested = this.classResource(state, 'growth') > 0 ? requested : 0;
        }
        const before = state.player.mp;
        state.player.mp = Math.min(
          state.player.mpMax,
          state.player.mp + requested,
        );
        const gained = state.player.mp - before;
        if (gained > 0) {
          this.animation(state, {
            kind: 'mp',
            sourceSide: 'player',
            targetSide: 'player',
            targetId: 'player',
            amount: gained,
            mpAfter: state.player.mp,
            label: card.name,
          });
        }
        break;
      }
      case 'gain_ap': {
        const gained = this.number(effect.value);
        state.player.ap += gained;
        this.animation(state, {
          kind: 'ap',
          sourceSide: 'player',
          targetSide: 'player',
          targetId: 'player',
          amount: gained,
          apAfter: state.player.ap,
          label: card.name,
        });
        break;
      }
      case 'gain_class_resource': {
        const resource = this.classResourceKey(effect.resource);
        this.addClassResource(state, resource, this.number(effect.value, 1));
        break;
      }
      case 'workshop_resource_change': {
        const found = this.workshopResource(
          state,
          String(effect.mechanismId ?? ''),
          String(effect.resourceId ?? ''),
        );
        if (!found) {
          this.log(state, 'system', `「${card.name}」引用的自定义资源未启用`);
          break;
        }
        this.changeWorkshopResource(
          state,
          found.manifest,
          found.definition.id,
          effect.mode === 'set' ? 'set' : 'add',
          this.number(effect.value),
        );
        break;
      }
      case 'apply_workshop_status': {
        const found = this.workshopStatusDefinition(
          state,
          String(effect.mechanismId ?? ''),
          String(effect.statusId ?? ''),
        );
        if (!found) {
          this.log(state, 'system', `「${card.name}」引用的自定义状态未启用`);
          break;
        }
        const recipients =
          effect.target === 'enemy' ||
          effect.target === 'all_enemies' ||
          effect.target === 'random_enemy'
            ? targets
            : this.cardFriendlyTargets(
                state,
                effect.target,
                allyTargetId,
                this.number(effect.target_count, 1),
              );
        for (const recipient of recipients) {
          this.applyWorkshopStatus(
            state,
            found.manifest,
            found.status.id,
            recipient,
            Math.max(1, this.number(effect.value, 1)),
            Math.max(1, this.number(effect.turns, 1)),
          );
        }
        break;
      }
      case 'discard_last_drawn': {
        const discarded = this.takeDiscardableCards(
          state,
          Math.max(1, this.number(effect.amount, 1)),
          'back',
        );
        state.player.discardPile.push(...discarded);
        break;
      }
      case 'spend_mp_damage': {
        const mpCost = Math.max(0, this.number(effect.amount));
        if (state.player.mp < mpCost) {
          this.log(state, 'system', `「${card.name}」所需 MP 不足`);
          break;
        }
        state.player.mp -= mpCost;
        const damage = this.number(effect.value) * Math.max(1, mpCost);
        for (const enemy of targets) {
          this.damage(
            state,
            state.player,
            enemy,
            damage,
            'player',
            card.name,
          );
        }
        this.animation(state, {
          kind: 'mp',
          sourceSide: 'player',
          targetSide: 'player',
          targetId: 'player',
          amount: -mpCost,
          mpAfter: state.player.mp,
          label: card.name,
        });
        break;
      }
      case 'spend_mp_shield': {
        const mpCost = Math.max(0, this.number(effect.amount));
        if (state.player.mp < mpCost) {
          this.log(state, 'system', `「${card.name}」所需 MP 不足`);
          break;
        }
        state.player.mp -= mpCost;
        const shield = Math.max(
          0,
          Math.round(
            this.number(effect.value) *
              Math.max(1, mpCost) *
              (1 + this.passiveEffectValue(state, 'shield_bonus')),
          ),
        );
        for (const recipient of this.cardFriendlyTargets(
          state,
          effect.target,
          allyTargetId,
        )) {
          this.grantFriendlyShield(state, recipient, shield, card.name);
        }
        break;
      }
      case 'mp_to_ap': {
        const mpCost = Math.max(0, this.number(effect.amount));
        if (state.player.mp < mpCost) {
          this.log(state, 'system', `「${card.name}」所需 MP 不足`);
          break;
        }
        const gained = Math.max(0, this.number(effect.value));
        state.player.mp -= mpCost;
        state.player.ap += gained;
        this.animation(state, {
          kind: 'ap',
          sourceSide: 'player',
          targetSide: 'player',
          targetId: 'player',
          amount: gained,
          apAfter: state.player.ap,
          label: card.name,
        });
        break;
      }
      case 'self_damage':
        this.directHpLoss(
          state,
          state.player,
          this.number(effect.value),
          card.name,
        );
        break;
      case 'apply_buff':
      case 'thorns': {
        const effectName = String(effect.buff ?? effect.type);
        const resourceKey = this.classResourceKey(effectName);
        if (
          this.resolvingPlayerSummonEffect &&
          CLASS_RESOURCE_OWNERS[resourceKey] === state.player.subclass
        ) {
          const amount = this.number(effect.value, 1);
          this.addClassResource(state, resourceKey, amount);
          this.animation(state, {
            kind: 'status',
            sourceSide: 'summon',
            sourceId: this.activePlayerSummon?.id,
            targetSide: 'player',
            targetId: 'player',
            amount,
            label: resourceKey,
          });
          break;
        }
        const recipients =
          effect.target === 'enemy' || effect.target === 'all_enemies'
            ? targets
            : this.cardFriendlyTargets(state, effect.target, allyTargetId);
        for (const recipient of recipients) {
          if (
            recipient === state.player &&
            CLASS_RESOURCE_OWNERS[resourceKey] === state.player.subclass
          ) {
            const amount = this.number(effect.value, 1);
            this.addClassResource(state, resourceKey, amount);
            const identity = this.combatantIdentity(state, recipient);
            this.animation(state, {
              kind: 'status',
              sourceSide: 'player',
              targetSide: identity.side,
              targetId: identity.id,
              amount,
              label: resourceKey,
            });
            continue;
          }
          this.addTimedEffect(
            recipient.buffs,
            effectName,
            this.number(effect.value, 1),
            this.number(effect.turns, 1),
            {
              charges: this.optionalPositiveNumber(effect.charges),
              undispellable: effect.undispellable === true,
            },
          );
          const identity = this.combatantIdentity(state, recipient);
          this.animation(state, {
            kind: 'status',
            sourceSide: 'player',
            targetSide: identity.side,
            targetId: identity.id,
            amount: this.number(effect.value, 1),
            label: effectName,
          });
        }
        break;
      }
      case 'apply_debuff': {
        const recipients =
          effect.target === 'self'
            ? this.resolvingPlayerSummonEffect && this.activePlayerSummon
              ? [this.normalizePlayerSummon(this.activePlayerSummon)]
              : [state.player]
            : targets;
        let applied = 0;
        for (const recipient of recipients) {
          const chance = this.clamp(this.number(effect.chance, 100), 0, 100);
          if (chance < 100 && this.random() * 100 >= chance) continue;
          const effectName = String(effect.debuff ?? 'weak');
          if (!this.tryApplyDebuff(
            state,
            recipient,
            effectName,
            this.number(effect.value, 1),
            this.number(effect.turns, 1),
            {
              charges: this.optionalPositiveNumber(effect.charges),
              uncleanseable: effect.uncleanseable === true,
            },
          )) continue;
          const identity = this.combatantIdentity(state, recipient);
          this.animation(state, {
            kind: 'status',
            sourceSide: 'player',
            targetSide: identity.side,
            targetId: identity.id,
            amount: this.number(effect.value, 1),
            label: effectName,
          });
          applied += 1;
        }
        if (
          applied > 0 &&
          String(effect.debuff) === 'burn' &&
          effect.target !== 'self'
        ) {
          if (state.player.subclass === 'dragon_knight') {
            this.addClassResource(state, 'dragon_soul');
          } else if (state.player.subclass === 'fire_mage') {
            this.addClassResource(state, 'ember_echo');
          }
        }
        break;
      }
      case 'double_debuff': {
        const debuffName = String(effect.debuff ?? 'poison');
        for (const recipient of targets) {
          const current = this.mutateTimedEffect(
            recipient.debuffs,
            debuffName,
            (instance) => {
              instance.value = Math.max(0, instance.value * 2);
            },
          );
          if (!current) continue;
          this.animation(state, {
            kind: 'status',
            sourceSide: 'player',
            targetSide: 'enemy',
            targetId: recipient.id,
            amount: current.value,
            label: `${debuffName}×2`,
          });
        }
        break;
      }
      case 'thorns_debuff': {
        for (const recipient of this.cardFriendlyTargets(
          state,
          effect.target,
          allyTargetId,
        )) {
          this.addTimedEffect(
            recipient.buffs,
            'thorns_debuff',
            this.number(effect.value),
            this.number(effect.turns, 1),
            { debuff: String(effect.debuff ?? 'freeze') },
          );
        }
        break;
      }
      case 'apply_random_debuff': {
        const pool = Array.isArray(effect.pool) ? effect.pool.map(String) : [];
        const debuff = pool[Math.floor(this.random() * pool.length)];
        if (debuff) {
          this.tryApplyDebuff(
            state,
            target,
            debuff,
            1,
            this.number(effect.turns, 1),
          );
          this.animation(state, {
            kind: 'status',
            sourceSide: 'player',
            targetSide: 'enemy',
            targetId: target.id,
            amount: 1,
            label: debuff,
          });
        }
        break;
      }
      case 'cleanse':
      case 'cleanse_heal_per': {
        for (const recipient of this.cardFriendlyTargets(
          state,
          effect.target,
          allyTargetId,
        )) {
          const removed = this.removeEffects(recipient.debuffs, effect.amount);
          if (effect.type === 'cleanse_heal_per') {
            this.heal(
              state,
              recipient,
              this.amplifiedCardEffectValue(
                state,
                card,
                'heal',
                removed * this.number(effect.value),
              ),
              card.name,
            );
          }
          if (state.player.subclass === 'nun' && removed > 0) {
            this.addTimedEffect(
              state.player.buffs,
              'purified_power',
              Math.max(3, removed * 3),
              1,
            );
          }
        }
        break;
      }
      case 'cleanse_specific':
        for (const recipient of this.cardFriendlyTargets(
          state,
          effect.target,
          allyTargetId,
        )) {
          const key = String(effect.debuff);
          const removed = recipient.debuffs[key] ? 1 : 0;
          delete recipient.debuffs[key];
          if (state.player.subclass === 'nun' && removed > 0) {
            this.addTimedEffect(state.player.buffs, 'purified_power', 3, 1);
          }
        }
        break;
      case 'cleanse_buff':
        delete state.player.buffs[String(effect.buff)];
        break;
      case 'strip_buffs':
      case 'dispel':
      case 'strip_buffs_damage_per':
      case 'strip_buffs_gain_mp_per':
      case 'strip_buffs_heal_per': {
        const removed = this.removeEffects(target.buffs, effect.amount);
        if (effect.type === 'strip_buffs_damage_per') {
          this.damage(
            state,
            state.player,
            target,
            removed * this.number(effect.value),
            'player',
            card.name,
          );
        } else if (effect.type === 'strip_buffs_gain_mp_per') {
          state.player.mp = Math.min(
            state.player.mpMax,
            state.player.mp + removed * this.number(effect.value),
          );
        } else if (effect.type === 'strip_buffs_heal_per') {
          this.heal(
            state,
            state.player,
            this.amplifiedCardEffectValue(
              state,
              card,
              'heal',
              removed * this.number(effect.value),
            ),
            card.name,
          );
        }
        break;
      }
      case 'strip_shield': {
        const recipients = ['enemy', 'all_enemies', 'random_enemy'].includes(
          String(effect.target ?? 'enemy'),
        )
          ? targets
          : this.cardFriendlyTargets(
              state,
              effect.target,
              allyTargetId,
              this.number(effect.target_count, 1),
            );
        for (const recipient of recipients) {
          const removed = recipient.shield;
          recipient.shield = 0;
          if (removed <= 0) continue;
          const identity = this.combatantIdentity(state, recipient);
          this.animation(state, {
            kind: 'shield',
            sourceSide: 'player',
            targetSide: identity.side,
            targetId: identity.id,
            amount: -removed,
            shieldAfter: 0,
            label: '破盾',
          });
        }
        break;
      }
      case 'damage_per_debuff':
        for (const enemy of targets) {
          const debuffCount = this.activeEffectCount(enemy.debuffs);
          let amount =
            debuffCount * this.number(effect.value) +
            Math.floor(state.player.attack * 0.15 * debuffCount);
          if (this.isAbyssSpellCard(card)) {
            amount += this.classResource(state, 'abyss_echo') * 2;
          }
          if (state.player.subclass === 'dark_priest' && amount > 0) {
            const lostSanity =
              100 - this.clamp(state.player.sanity ?? 100, 0, 100);
            amount = Math.ceil(
              amount *
                (1 + Math.min(5, Math.floor(lostSanity / 20)) * 0.08),
            );
          }
          this.damage(
            state,
            state.player,
            enemy,
            amount,
            'player',
            card.name,
          );
        }
        break;
      case 'damage_per_buff':
        for (const recipient of this.activeDarkPriestRedirect
          ? [state.player]
          : targets) {
          this.damage(
            state,
            state.player,
            recipient,
            this.activeEffectCount(recipient.buffs) * this.number(effect.value),
            'player',
            card.name,
          );
        }
        break;
      case 'damage_from_shield':
        for (const enemy of targets) {
          this.damage(
            state,
            state.player,
            enemy,
            Math.round(state.player.shield * this.number(effect.ratio)),
            'player',
            card.name,
          );
        }
        break;
      case 'trap':
        for (const enemy of targets) {
          this.tryApplyDebuff(
            state,
            enemy,
            'trap',
            this.number(effect.value),
            99,
          );
        }
        this.log(state, 'player', `${card.name}设置了陷阱`);
        break;
      case 'on_hit_draw':
        this.addTimedEffect(
          state.player.buffs,
          'on_hit_draw',
          this.number(effect.value, 1),
          1,
          { charges: this.optionalPositiveNumber(effect.charges) },
        );
        break;
      case 'damage_from_enemy_shield':
        this.damage(
          state,
          state.player,
          target,
          Math.round(target.shield * this.number(effect.ratio)),
          'player',
          card.name,
        );
        break;
      case 'shield_from_shield': {
        for (const recipient of this.cardFriendlyTargets(
          state,
          effect.target,
          allyTargetId,
        )) {
          this.grantFriendlyShield(
            state,
            recipient,
            Math.round(recipient.shield * this.number(effect.ratio)),
            card.name,
          );
        }
        break;
      }
      case 'damage_per_summon':
        this.damage(
          state,
          state.player,
          target,
          this.number(effect.base) +
            state.player.summons.length * this.number(effect.value),
          'player',
          card.name,
        );
        break;
      case 'summon':
        this.addSummon(state, effect);
        break;
      case 'discard': {
        const discarded = this.takeDiscardableCards(
          state,
          Math.max(0, this.number(effect.amount, 1)),
        );
        state.player.discardPile.push(...discarded);
        break;
      }
      case 'discard_all_damage': {
        const discarded = this.takeDiscardableCards(
          state,
          Number.POSITIVE_INFINITY,
        );
        state.player.discardPile.push(...discarded);
        const damage = discarded.length * this.number(effect.value);
        for (const enemy of targets) {
          this.damage(
            state,
            state.player,
            enemy,
            damage,
            'player',
            card.name,
          );
        }
        break;
      }
      case 'discard_blank_damage': {
        const blanks = state.player.hand.filter((instance) =>
          this.isBlankCard(state, instance.cardId),
        );
        const blankIds = new Set(blanks.map((instance) => instance.instanceId));
        state.player.hand = state.player.hand.filter(
          (instance) => !blankIds.has(instance.instanceId),
        );
        const damage = blanks.length * this.number(effect.value);
        for (const enemy of targets) {
          this.damage(
            state,
            state.player,
            enemy,
            damage,
            'player',
            card.name,
          );
        }
        this.log(state, 'player', `揭晓并移除 ${blanks.length} 张空白牌`);
        break;
      }
      case 'generate_blank_to_draw':
        this.generateBlankCards(
          state,
          Math.max(0, this.number(effect.value, 1)),
          card.name,
        );
        break;
      case 'blank_regen': {
        state.player.blankGenerators ??= [];
        state.player.blankGenerators.push({
          id: `blank-generator:${Date.now()}:${Math.floor(this.random() * 1_000_000)}`,
          turns: Math.max(1, this.number(effect.turns, 3)),
          amount: Math.max(1, this.number(effect.value, 1)),
        });
        this.log(
          state,
          'player',
          `设置 1 个不竭牌匣，当前共 ${state.player.blankGenerators.length} 个`,
        );
        break;
      }
      case 'destroy_summon': {
        const requested =
          effect.amount === 'all'
            ? state.player.summons.length
            : Math.max(1, this.number(effect.amount, 1));
        const destroyed =
          effect.target === 'all_summons'
            ? [...state.player.summons]
            : this.shuffle(state.player.summons).slice(0, requested);
        const removed = this.removePlayerSummons(state, destroyed, '牺牲');
        this.log(state, 'player', `牺牲 ${removed} 个召唤物`);
        break;
      }
      case 'reveal_intent':
        this.log(state, 'player', '已洞察敌人的行动意图');
        break;
      case 'recover_discard':
      case 'recover_discard_summon': {
        const requested = Math.max(0, this.number(effect.amount, 1));
        let recovered = 0;
        for (
          let index = state.player.discardPile.length - 1;
          index >= 0 &&
          recovered < requested &&
          state.player.hand.length < state.player.handLimit;
          index -= 1
        ) {
          const instance = state.player.discardPile[index];
          const definition = instance
            ? this.cardDefinition(state, instance.cardId)
            : undefined;
          const eligible =
            definition &&
            (effect.type === 'recover_discard_summon'
              ? this.isSummonCard(definition)
              : cardId === 'wm_clear_current'
                ? this.isSpellCard(definition)
                : true);
          if (!instance || !eligible) continue;
          state.player.discardPile.splice(index, 1);
          state.player.hand.push(instance);
          recovered += 1;
        }
        this.log(
          state,
          'player',
          recovered > 0
            ? `${card.name} 从弃牌堆回收了 ${recovered} 张符合条件的牌`
            : `${card.name} 没有可回收的符合条件卡牌，或手牌已满`,
        );
        break;
      }
      case 'chant':
        if (state.player.subclass !== 'arcane_mage') break;
        if (state.player.chants.length >= 3) {
          this.log(state, 'system', '吟诵队列已满（3/3），无法开始新的吟诵');
          break;
        }
        state.player.chants.push({
          id: `chant:${Date.now()}:${Math.floor(this.random() * 1_000_000)}`,
          name: card.name,
          turns: Math.max(1, this.number(effect.turns, 1)),
          effects: Array.isArray(effect.effects) ? effect.effects : [],
          targetIndex,
          multiplier: 1,
        } as LocalBattleState['player']['chants'][number] & {
          targetIndex: number;
          multiplier: number;
        });
        this.log(
          state,
          'player',
          `开始吟诵「${card.name}」（${this.number(effect.turns, 1)} 回合）`,
        );
        break;
      case 'reduce_chant': {
        const selected = effect.target === 'all'
          ? [...state.player.chants]
          : [...state.player.chants]
              .sort((left, right) => left.turns - right.turns)
              .slice(0, 1);
        for (const chant of selected) {
          chant.turns = Math.max(0, chant.turns - this.number(effect.value, 1));
        }
        for (const chant of selected.filter((entry) => entry.turns <= 0)) {
          this.resolveChant(state, chant, 1);
        }
        const resolved = new Set(selected.filter((entry) => entry.turns <= 0));
        state.player.chants = state.player.chants.filter(
          (entry) => !resolved.has(entry),
        );
        break;
      }
      case 'force_chant':
        for (const chant of [...state.player.chants]) {
          this.resolveChant(state, chant, this.number(effect.multiplier, 1));
        }
        state.player.chants = [];
        break;
      case 'damage_per_class_resource': {
        const resource = this.classResourceKey(effect.resource);
        const stored = this.classResource(state, resource);
        const damage = stored * this.number(effect.value);
        for (const enemy of targets) {
          this.damage(state, state.player, enemy, damage, 'player', card.name);
        }
        if (effect.consume === 'all') {
          this.consumeClassResource(state, resource, 'all');
        }
        break;
      }
      case 'gain_mp_per_class_resource': {
        const resource = this.classResourceKey(effect.resource);
        const stored = this.classResource(state, resource);
        this.restoreMp(state, stored * this.number(effect.value), card.name);
        if (effect.consume === 'all') {
          this.consumeClassResource(state, resource, 'all');
        }
        break;
      }
      case 'consume_debuff_damage': {
        const debuff = String(effect.debuff ?? '');
        for (const recipient of targets) {
          const current = debuff ? recipient.debuffs[debuff] : undefined;
          if (!current) continue;
          const total = this.timedEffectInstances(current).reduce(
            (sum, instance) =>
              sum + Math.max(1, this.number(instance.value)),
            0,
          );
          delete recipient.debuffs[debuff];
          this.damage(
            state,
            state.player,
            recipient,
            total * this.number(effect.value),
            'player',
            card.name,
          );
        }
        break;
      }
      case 'debuff_catalyze': {
        const ratio = Math.max(0, this.number(effect.value_ratio, 1));
        const extraTurns = Math.max(0, this.number(effect.turns));
        for (const recipient of targets) {
          for (const key of Object.keys(recipient.debuffs)) {
            this.mutateTimedEffect(recipient.debuffs, key, (instance) => {
              instance.value = Math.max(
                0,
                Math.round(instance.value * (1 + ratio)),
              );
              if (instance.turns >= 0) instance.turns += extraTurns;
            });
          }
        }
        break;
      }
      case 'astrology_discover': {
        const showCount = Math.max(1, this.number(effect.value, 3));
        const pick = Math.max(
          1,
          Math.min(showCount, this.number(effect.pick, 1)),
        );
        const choices = this.astrologyChoices(showCount);
        if (choices.length === 0) {
          this.log(state, 'system', '星盘中暂时没有可供选择的牌');
          break;
        }
        state.player.pendingCardChoice = {
          type: 'astrology',
          title: pick > 1 ? '大占星术' : '占星术',
          choices,
          pick: Math.min(pick, choices.length),
          picked: [],
        };
        this.log(
          state,
          'player',
          `${state.player.pendingCardChoice.title}展开星盘：从 ${choices.length} 张牌中选择 ${state.player.pendingCardChoice.pick} 张临时加入本场手牌`,
        );
        break;
      }
      case 'restore_mp_per_abyss_echo':
        this.restoreMp(
          state,
          this.classResource(state, 'abyss_echo') * this.number(effect.value),
          card.name,
        );
        break;
      case 'clear_abyss_echo':
        this.consumeClassResource(state, 'abyss_echo', 'all');
        break;
      case 'gain_mp_per_chant':
        this.restoreMp(
          state,
          state.player.chants.length * this.number(effect.value),
          card.name,
        );
        break;
      case 'copy_chant': {
        const chant = [...state.player.chants].sort(
          (left, right) => left.turns - right.turns,
        )[0];
        if (chant && state.player.chants.length < 3) {
          const runtime = chant as typeof chant & { targetIndex?: number; multiplier?: number };
          state.player.chants.push({
            ...chant,
            id: `chant-copy:${Date.now()}:${Math.floor(this.random() * 1_000_000)}`,
            name: `${chant.name}·复写`,
            effects: [...chant.effects],
            targetIndex: runtime.targetIndex,
            multiplier:
              this.number(runtime.multiplier, 1) *
              this.number(effect.multiplier, 0.5),
          } as typeof chant);
        }
        break;
      }
      case 'recall_summon_mp': {
        const amount = Math.min(
          state.player.summons.length,
          Math.max(1, this.number(effect.amount, 1)),
        );
        const recalled = this.shuffle(
          state.player.summons.filter(
            (summon) => this.normalizePlayerSummon(summon).hp > 0,
          ),
        ).slice(0, amount);
        const maxGain = Math.max(1, this.number(effect.max, 5));
        const gained = recalled.reduce((sum, summon) => {
          const normalized = this.normalizePlayerSummon(summon);
          const hpRatio = normalized.hpMax > 0
            ? normalized.hp / normalized.hpMax
            : 0;
          const raw = Math.ceil(Math.max(0, normalized.duration) + hpRatio * 3);
          return sum + this.clamp(raw, 1, maxGain);
        }, 0);
        this.removePlayerSummons(state, recalled, '召回');
        this.restoreMp(
          state,
          Math.min(maxGain, gained),
          card.name,
        );
        break;
      }
      case 'destroy_summon_damage_per': {
        const mechanicalOnly = Boolean(effect.mechanicalOnly);
        const candidates = state.player.summons.filter(
          (summon) => {
            const normalized = this.normalizePlayerSummon(summon);
            return normalized.hp > 0 && (!mechanicalOnly || normalized.mechanical);
          },
        );
        const requested =
          effect.amount === 'all'
            ? candidates.length
            : Math.max(1, this.number(effect.amount, 1));
        const destroyed = candidates.slice(0, requested);
        const removed = this.removePlayerSummons(state, destroyed, '摧毁');
        const damage = removed * this.number(effect.value);
        const damageTargets = effect.enemy_target === 'all_enemies'
          ? this.aliveEnemies(state)
          : targets;
        for (const enemy of damageTargets) {
          this.damage(state, state.player, enemy, damage, 'player', card.name);
        }
        break;
      }
      case 'consume_san':
        if (state.player.subclass === 'dark_priest') {
          state.player.sanity = Math.max(
            0,
            (state.player.sanity ?? 100) - this.number(effect.value),
          );
        }
        break;
      case 'restore_san':
        if (state.player.subclass === 'dark_priest') {
          state.player.sanity = Math.min(
            100,
            (state.player.sanity ?? 100) + this.number(effect.value),
          );
        }
        break;
      case 'sacrifice_all_san': {
        if (state.player.subclass !== 'dark_priest') break;
        const sanity = state.player.sanity ?? 100;
        state.player.sanity = 0;
        this.addTimedEffect(
          state.player.buffs,
          'strength',
          Math.floor(sanity / 10) * this.number(effect.strength_per_10, 1),
          this.number(effect.turns, 1),
        );
        break;
      }
      case 'merchant_bribe': {
        const difficultyMultipliers: Record<string, number> = {
          easy: 1,
          normal: 1.6,
          hard: 2.6,
          nightmare: 4.2,
          hell: 4.2,
        };
        const cost = Math.max(
          10,
          Math.round(
            this.aliveEnemies(state).reduce(
              (sum, enemy) =>
                sum +
                18 *
                  Math.max(1, this.number(enemy.level, 1)) *
                  (difficultyMultipliers[enemy.difficulty] ?? 1.6),
              0,
            ),
          ),
        );
        if ((state.player.gold ?? 0) < cost) {
          this.log(state, 'system', `贿赂需要 ${cost} 金币，当前金币不足`);
          break;
        }
        state.player.gold = (state.player.gold ?? 0) - cost;
        for (const enemy of this.aliveEnemies(state)) enemy.hp = 0;
        this.log(state, 'player', `支付 ${cost} 金币化解了战斗`);
        break;
      }
      case 'merchant_flee': {
        const lostPercent = 1 + Math.floor(this.random() * 99);
        const lostGold = Math.floor(
          ((state.player.gold ?? 0) * lostPercent) / 100,
        );
        state.player.gold = Math.max(0, (state.player.gold ?? 0) - lostGold);
        this.directHpLoss(
          state,
          state.player,
          Math.max(1, Math.ceil(state.player.hp * 0.5)),
          '仓皇逃窜',
          1,
        );
        state.status = 'surrendered';
        state.phase = 'ended';
        this.log(
          state,
          'system',
          `商人脱身：损失 ${lostPercent}% 金币（-${lostGold}）并失去一半生命`,
        );
        break;
      }
      case 'conditional_group': {
        const conditions = Array.isArray(effect.conditions)
          ? (effect.conditions as CardEffect[])
          : [];
        const matches = conditions.map((condition) =>
          this.conditionMatches(condition, state, target),
        );
        const passed =
          effect.logic === 'or'
            ? matches.some(Boolean)
            : matches.every(Boolean);
        if (passed) {
          if (effect.logic === 'or') {
            const firstPayable = conditions.find(
              (condition, index) =>
                matches[index] && this.isPayableCondition(condition),
            );
            if (firstPayable) this.payCondition(state, firstPayable);
          } else {
            for (const condition of conditions) {
              if (this.isPayableCondition(condition)) {
                this.payCondition(state, condition);
              }
            }
          }
        }
        const children = passed
          ? Array.isArray(effect.then_effects)
            ? (effect.then_effects as CardEffect[])
            : []
          : Array.isArray(effect.else_effects)
            ? (effect.else_effects as CardEffect[])
            : [];
        for (const child of children) {
          this.applyCardEffect(
            state,
            card,
            child,
            targetIndex,
            bonus,
            multiplier,
            allyTargetId,
          );
        }
        break;
      }
      case 'conditional_bonus':
      case 'conditional_double':
      case 'conditional_cost_reduction':
      case 'bonus_vs_tag':
        break;
      default:
        this.log(state, 'system', `「${card.name}」的 ${effect.type} 特殊机制尚未产生额外数值`);
    }
  }

  private stabilizeWorkshopTest(state: LocalBattleState): void {
    const test = state.workshopTest;
    if (!test) return;
    if (test.playerInvincible && state.player.hp <= 0) state.player.hp = 1;
    if ((test.opponentMode ?? 'dummy') !== 'dummy') return;
    for (const enemy of state.enemies) {
      if (enemy.hp > 0) continue;
      if (test.dummyInvincible) {
        enemy.hp = 1;
        continue;
      }
      if (!test.autoRespawn) continue;
      enemy.hp = enemy.hpMax;
      enemy.shield = 0;
      enemy.buffs = {};
      enemy.debuffs = {};
      enemy.intent = test.dummyAttackEnabled
        ? {
            skillId: 'workshop-test-hit',
            name: '测试攻击',
            kind: 'attack',
            description: '由创意工坊测试场生成的攻击。',
            amount: enemy.attack,
            hits: 1,
          }
        : null;
      test.respawns += 1;
      this.animation(state, {
        kind: 'heal',
        sourceSide: 'system',
        sourceId: 'workshop-test',
        targetSide: 'enemy',
        targetId: enemy.id,
        amount: enemy.hpMax,
        hpAfter: enemy.hpMax,
        label: '木桩自动复活',
      });
      this.log(state, 'system', `${enemy.name} 已自动复活（第 ${test.respawns} 次）。`);
    }
  }

  private damage(
    state: LocalBattleState,
    source: Combatant,
    target: Combatant,
    rawAmount: number,
    kind: BattleLogEntry['kind'],
    label: string,
    damageOptions: boolean | DamageOptions = false,
  ): number {
    const options =
      typeof damageOptions === 'boolean'
        ? { ignoreDefense: damageOptions }
        : damageOptions;
    if (source.hp <= 0 || target.hp <= 0) return 0;
    let ignoreDefense = options.ignoreDefense === true;
    const sourceIdentity = this.combatantIdentity(state, source);
    const targetIdentity = this.combatantIdentity(state, target);
    const origin =
      options.origin ??
      (kind === 'enemy' ||
      this.activeMechanismCard ||
      sourceIdentity.side === 'companion' ||
      sourceIdentity.side === 'summon'
        ? 'attack'
        : 'effect');
    const opposingSides =
      (sourceIdentity.side === 'enemy') !==
      (targetIdentity.side === 'enemy');
    const canReact =
      origin === 'attack' && this.reactionDepth === 0 && opposingSides;
    const damageEvent: Record<string, unknown> = {
      amount: rawAmount,
      ignoreDefense,
      origin,
      sourceSide: sourceIdentity.side,
      sourceId: sourceIdentity.id,
      targetSide: targetIdentity.side,
      targetId: targetIdentity.id,
      target_is_player: targetIdentity.side === 'player' ? 1 : 0,
      target_is_enemy: targetIdentity.side === 'enemy' ? 1 : 0,
      target_is_summon: targetIdentity.side === 'summon' ? 1 : 0,
      cardId: this.activeMechanismCard?.id ?? '',
      cardName: this.activeMechanismCard?.name ?? '',
      cardType: this.activeMechanismCard?.type ?? '',
      cardTags: this.activeMechanismCard?.tags ?? [],
    };
    const beforeDamage =
      origin === 'defense_reflect'
        ? damageEvent
        : this.runWorkshopMechanisms(state, 'before_damage', damageEvent);
    if (beforeDamage.cancel === true) return 0;
    rawAmount = this.number(beforeDamage.amount, rawAmount);
    if (typeof beforeDamage.ignoreDefense === 'boolean') {
      ignoreDefense = beforeDamage.ignoreDefense;
    }
    let amount = Math.max(0, Math.round(rawAmount));
    if (amount > 0 && !options.ignoreAgility) {
      const statusDodge = this.effectValue(target.buffs.agility);
      const speedDodge = Math.min(
        this.rules?.maxSpeedDodge ?? 25,
        Math.floor(
          Math.max(0, target.speed) *
            (this.rules?.speedDodgePerPoint ?? 0.25),
        ),
      );
      const dodgeChance = this.clamp(statusDodge + speedDodge, 0, 95);
      if (dodgeChance > 0 && this.random() * 100 < dodgeChance) {
        this.log(
          state,
          kind,
          `${target.name ?? (target === state.player ? state.player.name : '目标')} 凭借敏捷/速度闪避了${label}（${dodgeChance}%）`,
        );
        this.animation(state, {
          kind: 'status',
          sourceSide: targetIdentity.side,
          sourceId: targetIdentity.id,
          targetSide: targetIdentity.side,
          targetId: targetIdentity.id,
          amount: dodgeChance,
          label: '闪避',
        });
        this.spendEffectCharge(target.buffs, 'agility');
        return 0;
      }
    }
    if (amount > 0 && target.buffs.damage_immune && !options.ignoreImmunity) {
      this.log(state, kind, `${target.name ?? '目标'} 的伤害免疫抵消了${label}`);
      this.spendEffectCharge(target.buffs, 'damage_immune');
      return 0;
    }
    const preHitShield = target.shield;
    if (
      amount > 0 &&
      canReact &&
      preHitShield > 0 &&
      this.hasDefenseReflect(state, target)
    ) {
      this.resolveDefenseReflect(state, target, source, preHitShield);
    }
    if (!options.fixedAmount) {
      const customDamageBonus = this.clamp(
        this.workshopStatusEffectValue(state, source, 'damage_bonus'),
        0,
        500,
      );
      if (customDamageBonus > 0) {
        amount = Math.ceil(amount * (1 + customDamageBonus / 100));
      }
      if (source.buffs.blood_burn) {
        amount = Math.ceil(
          amount *
            (1 +
              Math.max(0, this.effectValue(source.buffs.blood_burn)) / 100),
        );
      }
      if (!options.ignoreWeak && source.debuffs.weak) {
        amount = Math.floor(amount * 0.75);
      }
      if (!options.ignoreStrength) {
        amount += this.effectValue(source.buffs.strength);
      }
      if (source.buffs.monster_frenzy) {
        amount = Math.ceil(
          amount *
            (1 +
              Math.max(0, this.effectValue(source.buffs.monster_frenzy)) /
                100),
        );
      }
      if (!options.ignoreVulnerable && target.debuffs.vulnerable) {
        amount = Math.ceil(amount * 1.5);
      }
      if (target.debuffs.curse_mark) {
        amount += Math.max(1, this.effectValue(target.debuffs.curse_mark));
      }
      if (target.debuffs.abyss_mark) {
        amount += Math.max(
          1,
          this.effectValue(target.debuffs.abyss_mark) +
            Math.floor(amount * 0.08),
        );
      }
      const customReduction = this.clamp(
        this.workshopStatusEffectValue(state, target, 'damage_reduction'),
        0,
        100,
      );
      if (customReduction > 0) {
        amount = Math.ceil((amount * (100 - customReduction)) / 100);
      }
      const damageResist = this.clamp(
        this.effectValue(target.buffs.damage_resist),
        0,
        95,
      );
      if (damageResist > 0 && !options.ignoreResist) {
        amount = Math.ceil((amount * (100 - damageResist)) / 100);
      }
      if (target.buffs.damage_halve && !options.ignoreDamageHalve) {
        amount = Math.ceil(amount * 0.5);
        this.spendEffectCharge(target.buffs, 'damage_halve');
      }
      if (!ignoreDefense) {
        const defenseScale =
          targetIdentity.side !== 'enemy'
            ? this.rules?.playerDefenseScale ?? 0.28
            : this.rules?.enemyDefenseScale ?? 0.26;
        amount -=
          Math.floor(target.defense * defenseScale) +
          this.effectValue(target.buffs.fortitude);
      }
      if (targetIdentity.side === 'enemy' && target.buffs.evidence_barrier) {
        amount *= Math.max(
          0,
          1 - this.effectValue(target.buffs.evidence_barrier) / 100,
        );
      }
      if (target === state.player) {
        amount -=
          this.passiveEffectValue(state, 'damage_reduction') +
          this.effectValue(state.player.buffs.damage_reduce);
      }
    }
    amount = Math.max(rawAmount > 0 ? 1 : 0, Math.round(amount));
    const absorbed = Math.min(target.shield, amount);
    target.shield -= absorbed;
    const calculatedHpDamage = amount - absorbed;
    const beforeHp = target.hp;
    const hpFloor =
      target === state.player
        ? state.workshopTest?.playerInvincible
          ? 1
          : 0
        : targetIdentity.side === 'enemy' && state.workshopTest?.dummyInvincible
          ? 1
          : 0;
    if (
      calculatedHpDamage > 0 &&
      target.buffs.death_save &&
      target.hp - calculatedHpDamage <= hpFloor
    ) {
      target.hp = Math.max(1, hpFloor);
      this.spendEffectCharge(target.buffs, 'death_save');
      this.log(state, kind, `${target.name ?? '目标'} 的守护效果抵挡了致命伤`);
    } else {
      target.hp = Math.max(hpFloor, target.hp - calculatedHpDamage);
    }
    const hpDamage = beforeHp - target.hp;
    if (hpDamage > 0) this.recordAbyssEchoLoss(state, target);
    this.animation(state, {
      kind: 'damage',
      sourceSide: sourceIdentity.side,
      sourceId: sourceIdentity.id,
      targetSide: targetIdentity.side,
      targetId: targetIdentity.id,
      amount,
      hpAfter: target.hp,
      shieldAfter: target.shield,
      label,
    });
    this.log(
      state,
      kind,
      `${label}造成 ${amount} 点伤害${absorbed ? `（护盾吸收 ${absorbed}）` : ''}`,
    );
    if (
      target === state.player &&
      source !== target &&
      hpDamage > 0 &&
      canReact &&
      state.player.buffs.thorns
    ) {
      const thorns = this.effectValue(state.player.buffs.thorns);
      source.hp = Math.max(0, source.hp - thorns);
      const reflectedTarget = this.combatantIdentity(state, source);
      this.animation(state, {
        kind: 'damage',
        sourceSide: 'player',
        sourceId: 'player',
        targetSide: reflectedTarget.side,
        targetId: reflectedTarget.id,
        amount: thorns,
        hpAfter: source.hp,
        shieldAfter: source.shield,
        label: '荆棘反弹',
      });
      this.log(state, 'player', `荆棘反弹 ${thorns} 点伤害`);
    }
    if (targetIdentity.side === 'enemy' && hpDamage > 0) {
      const ratio =
        source === state.player
          ? this.resolvingPlayerSummonEffect
            ? 0
            : this.playerLifestealRatio(state)
          : sourceIdentity.side === 'companion' || sourceIdentity.side === 'summon'
            ? this.clamp(this.number(source.lifesteal) / 100, 0, 1)
            : 0;
      const lifesteal = Math.floor(hpDamage * ratio);
      if (lifesteal > 0) this.heal(state, source, lifesteal, '吸血', false);
    }
    if (
      sourceIdentity.side === 'enemy' &&
      targetIdentity.side !== 'enemy' &&
      hpDamage > 0 &&
      source.onHitDebuff
    ) {
      this.tryApplyDebuff(state, target, source.onHitDebuff, 1, 2, {
        uncleanseable: true,
      });
      this.log(state, 'enemy', `${source.name ?? '敌人'} 的词缀追加了诅咒印记`);
    }
    if (
      hpDamage > 0 &&
      (target === state.player || targetIdentity.side === 'enemy')
    ) {
      this.runWorkshopMechanisms(
        state,
        target === state.player ? 'player_damaged' : 'enemy_damaged',
        {
          amount: hpDamage,
          absorbed,
          targetId: targetIdentity.id,
          sourceId: sourceIdentity.id,
          cardId: this.activeMechanismCard?.id ?? '',
          cardType: this.activeMechanismCard?.type ?? '',
          cardTags: this.activeMechanismCard?.tags ?? [],
        },
      );
    }
    if (
      canReact &&
      amount > 0 &&
      target.hp > 0 &&
      source.hp > 0
    ) {
      this.resolveCounterattacks(state, target, source);
    }
    this.stabilizeWorkshopTest(state);
    this.stabilizePlayerSummons(state);
    this.stabilizeCompanion(state);
    return hpDamage;
  }

  private hasPassiveEffect(
    state: LocalBattleState,
    target: Combatant,
    type: string,
  ): boolean {
    return (
      target === state.player &&
      (state.player.passiveEffects ?? []).some(
        (effect) =>
          effect &&
          typeof effect === 'object' &&
          (effect as CardEffect).type === type,
      )
    );
  }

  private hasDefenseReflect(
    state: LocalBattleState,
    target: Combatant,
  ): boolean {
    return Boolean(
      target.buffs.defense_reflect ||
        this.hasPassiveEffect(state, target, 'defense_reflect'),
    );
  }

  private resolveDefenseReflect(
    state: LocalBattleState,
    defender: Combatant,
    attacker: Combatant,
    preHitShield: number,
  ): void {
    const ratio = this.clamp(defender.defense, 0, 150) / 100;
    const amount = Math.max(
      0,
      Math.round(preHitShield * 0.8 * ratio),
    );
    if (amount <= 0) return;
    const defenderIdentity = this.combatantIdentity(state, defender);
    this.withReactionContext(() => {
      this.damage(
        state,
        defender,
        attacker,
        amount,
        defenderIdentity.side === 'enemy' ? 'enemy' : 'player',
        '防反',
        {
          origin: 'defense_reflect',
          fixedAmount: true,
          ignoreAgility: true,
          ignoreImmunity: true,
        },
      );
    });
  }

  private resolveCounterattacks(
    state: LocalBattleState,
    defender: Combatant,
    attacker: Combatant,
  ): void {
    const count =
      (this.hasPassiveEffect(state, defender, 'counterattack') ? 1 : 0) +
      (defender.buffs.counterattack ? 1 : 0);
    if (count <= 0) return;
    const defenderIdentity = this.combatantIdentity(state, defender);
    for (
      let index = 0;
      index < count && defender.hp > 0 && attacker.hp > 0;
      index += 1
    ) {
      this.triggerBloodBurnAction(state, defender, '反击');
      if (defender.hp <= 0 || attacker.hp <= 0) break;
      this.withReactionContext(() => {
        this.damage(
          state,
          defender,
          attacker,
          Math.max(0, Math.round(defender.attack * 0.1)),
          defenderIdentity.side === 'enemy' ? 'enemy' : 'player',
          count > 1 ? `反击（${index + 1}/${count}）` : '反击',
          { origin: 'counterattack' },
        );
      });
    }
  }

  private withReactionContext<T>(action: () => T): T {
    const previousCard = this.activeMechanismCard;
    this.activeMechanismCard = undefined;
    this.reactionDepth += 1;
    try {
      return action();
    } finally {
      this.reactionDepth -= 1;
      this.activeMechanismCard = previousCard;
    }
  }

  private heal(
    state: LocalBattleState,
    target: Combatant,
    rawAmount: number,
    label: string,
    convertPriestOverflow = true,
  ): number {
    if (this.isInjuredCompanion(state, target)) return 0;
    const healBlock = this.clamp(
      this.effectValue(target.debuffs.heal_block),
      0,
      100,
    );
    const amount = Math.max(
      0,
      Math.floor((Math.round(rawAmount) * (100 - healBlock)) / 100),
    );
    const before = target.hp;
    target.hp = Math.min(target.hpMax, target.hp + amount);
    const restored = target.hp - before;
    const overflow = Math.max(0, before + amount - target.hpMax);
    if (restored > 0) {
      const identity = this.combatantIdentity(state, target);
      this.animation(state, {
        kind: 'heal',
        sourceSide: identity.side,
        sourceId: identity.id,
        targetSide: identity.side,
        targetId: identity.id,
        amount: restored,
        hpAfter: target.hp,
        label,
      });
      this.log(state, 'player', `${label}恢复 ${restored} HP`);
    }
    if (
      convertPriestOverflow &&
      target === state.player &&
      state.player.subclass === 'priest' &&
      overflow > 0
    ) {
      const targetIndex = this.resolveTargetIndex(state, state.selectedTarget);
      const enemy = state.enemies[targetIndex];
      if (enemy?.hp && enemy.hp > 0) {
        this.damage(
          state,
          state.player,
          enemy,
          overflow,
          'player',
          '过量治疗转化',
          {
            ignoreDefense: true,
            ignoreAgility: true,
            ignoreWeak: true,
            ignoreStrength: true,
            ignoreVulnerable: true,
            ignoreDamageHalve: true,
          },
        );
        this.log(state, 'player', `过量治疗 ${overflow} 转化为圣光伤害`);
      }
    }
    return restored;
  }

  private cardFriendlyTargets(
    state: LocalBattleState,
    effectTarget: unknown,
    allyTargetId: BattleFriendlyTargetId,
    targetCount = 1,
  ): Combatant[] {
    const companion = state.companion;
    const playerSummons = state.player.summons.map((summon) =>
      this.normalizePlayerSummon(summon),
    );
    if (effectTarget === 'all_summons') {
      return [
        ...playerSummons.filter((summon) => summon.hp > 0),
        ...(companion?.summons.filter((summon) => summon.hp > 0) ?? []),
      ];
    }
    if (
      effectTarget === 'random_summons' ||
      effectTarget === 'selected_summons'
    ) {
      return this.shuffle([...playerSummons]).slice(
        0,
        Math.max(1, Math.floor(targetCount)),
      );
    }
    if (
      this.resolvingPlayerSummonEffect &&
      effectTarget === 'self' &&
      this.activePlayerSummon
    ) {
      return [this.normalizePlayerSummon(this.activePlayerSummon)];
    }
    if (effectTarget === 'all_allies') {
      return [
        state.player,
        ...(companion && !companion.injured ? [companion] : []),
        ...playerSummons,
        ...(companion?.summons.filter((summon) => summon.hp > 0) ?? []),
      ];
    }
    if (effectTarget === 'random_allies') {
      return this.shuffle(
        this.cardFriendlyTargets(state, 'all_allies', allyTargetId),
      ).slice(0, Math.max(1, Math.floor(targetCount)));
    }
    if (effectTarget === 'selected_allies') {
      return allyTargetId === 'caelian' && companion
        ? [companion]
        : [state.player];
    }
    return allyTargetId === 'caelian' && companion
      ? [companion]
      : [state.player];
  }

  private resolveWorkshopScaling(
    state: LocalBattleState,
    effect: CardEffect,
  ): CardEffect {
    if (!effect.scaling || typeof effect.scaling !== 'object') return effect;
    const scaling = effect.scaling as Record<string, unknown>;
    const source =
      this.resolvingPlayerSummonEffect && this.activePlayerSummon
        ? this.normalizePlayerSummon(this.activePlayerSummon)
        : state.player;
    const stat = String(scaling.stat ?? '');
    const sourceValue =
      stat === 'hp'
        ? source.hp
        : stat === 'attack'
          ? source.attack
          : stat === 'shield'
            ? source.shield
            : stat === 'defense'
              ? source.defense
              : stat === 'mp' && source === state.player
                ? state.player.mp
                : 0;
    const percent = this.clamp(this.number(scaling.percent), 0, 200);
    return {
      ...effect,
      value: Math.max(
        0,
        Math.round(this.number(effect.value) + (sourceValue * percent) / 100),
      ),
    };
  }

  private isInjuredCompanion(
    state: LocalBattleState,
    target: Combatant,
  ): boolean {
    return target === state.companion && state.companion.injured;
  }

  private grantFriendlyShield(
    state: LocalBattleState,
    target: Combatant,
    rawAmount: number,
    label: string,
    sourceSide: 'player' | 'companion' = 'player',
  ): number {
    if (this.isInjuredCompanion(state, target)) return 0;
    const amount = Math.max(0, Math.round(rawAmount));
    if (amount <= 0) return 0;
    target.shield += amount;
    const identity = this.combatantIdentity(state, target);
    this.animation(state, {
      kind: 'shield',
      sourceSide,
      sourceId: sourceSide === 'companion' ? 'caelian' : 'player',
      targetSide: identity.side,
      targetId: identity.id,
      amount,
      shieldAfter: target.shield,
      label,
    });
    this.log(state, 'player', `${target.name ?? '友方'}获得 ${amount} 点护盾`);
    return amount;
  }

  private enemyFriendlyTargets(state: LocalBattleState): Combatant[] {
    const targets: Combatant[] = [state.player];
    for (const summon of state.player.summons) {
      const normalized = this.normalizePlayerSummon(summon);
      if (normalized.attackable !== false && normalized.hp > 0) {
        targets.push(normalized);
      }
    }
    if (state.companion && !state.companion.injured && state.companion.hp > 0) {
      targets.push(state.companion);
    }
    for (const summon of state.companion?.summons ?? []) {
      if (summon.hp > 0) targets.push(summon);
    }
    return targets;
  }

  private chooseEnemyFriendlyTarget(state: LocalBattleState): Combatant {
    const interceptingSummon = state.player.summons
      .map((summon) => this.normalizePlayerSummon(summon))
      .find((summon) => summon.attackable !== false && summon.hp > 0);
    if (interceptingSummon) return interceptingSummon;
    const targets = this.enemyFriendlyTargets(state);
    return targets[Math.floor(this.random() * targets.length)] ?? state.player;
  }

  private stabilizeCompanion(state: LocalBattleState): void {
    const companion = state.companion;
    if (!companion) return;
    companion.hp = Math.max(0, companion.hp);
    for (const summon of companion.summons) summon.hp = Math.max(0, summon.hp);
    if (companion.hp > 0 || companion.injured) return;
    companion.injured = true;
    companion.shield = 0;
    this.log(state, 'system', '凯利安生命归零，进入重伤状态并停止行动。');
    this.animation(state, {
      kind: 'status',
      sourceSide: 'system',
      targetSide: 'companion',
      targetId: companion.id,
      label: '重伤',
    });
  }

  private cardDefinition(
    state: LocalBattleState,
    cardId: string,
  ): CardDefinition | undefined {
    return state.workshopTest?.candidateCards?.[cardId] ?? this.cards?.[cardId];
  }

  private cardCatalogForState(
    state: LocalBattleState,
  ): Record<string, CardDefinition> {
    return {
      ...(this.cards ?? {}),
      ...(state.workshopTest?.candidateCards ?? {}),
    };
  }

  private drawCards(state: LocalBattleState, requested: number): void {
    let drawn = 0;
    while (
      drawn < requested &&
      state.player.hand.length < state.player.handLimit
    ) {
      if (state.player.drawPile.length === 0) {
        if (state.player.discardPile.length === 0) break;
        state.player.drawPile = this.shuffle(state.player.discardPile.splice(0));
        this.log(state, 'system', '弃牌堆已洗回抽牌堆');
      }
      const card = state.player.drawPile.pop();
      if (!card) break;
      state.player.hand.push(card);
      drawn += 1;
    }
    if (drawn > 0) {
      this.animation(state, {
        kind: 'draw',
        sourceSide: 'system',
        targetSide: 'player',
        targetId: 'player',
        amount: drawn,
        label: `抽取 ${drawn} 张牌`,
      });
    }
  }

  private isBlankCard(state: LocalBattleState, cardId: string): boolean {
    return (
      cardId === MAGICIAN_BLANK_CARD_ID ||
      this.cardDefinition(state, cardId)?.protectedFromDiscard === true
    );
  }

  private blankCardCount(state: LocalBattleState): number {
    return [
      ...state.player.hand,
      ...state.player.drawPile,
      ...state.player.discardPile,
    ].filter((instance) => this.isBlankCard(state, instance.cardId)).length;
  }

  private discardableHandCount(
    state: LocalBattleState,
    excludedInstanceId?: string,
  ): number {
    return state.player.hand.filter(
      (instance) =>
        instance.instanceId !== excludedInstanceId &&
        !this.isBlankCard(state, instance.cardId),
    ).length;
  }

  private takeDiscardableCards(
    state: LocalBattleState,
    requested: number,
    order: 'front' | 'back' | 'random' = 'front',
  ) {
    const eligible = state.player.hand.filter(
      (instance) => !this.isBlankCard(state, instance.cardId),
    );
    const ordered =
      order === 'random'
        ? this.shuffle(eligible)
        : order === 'back'
          ? [...eligible].reverse()
          : eligible;
    const amount = Number.isFinite(requested)
      ? Math.max(0, Math.floor(requested))
      : ordered.length;
    const discarded = ordered.slice(0, amount);
    const discardedIds = new Set(
      discarded.map((instance) => instance.instanceId),
    );
    state.player.hand = state.player.hand.filter(
      (instance) => !discardedIds.has(instance.instanceId),
    );
    return discarded;
  }

  private assertCardDiscardCosts(
    state: LocalBattleState,
    card: CardDefinition,
    cardInstanceId: string,
  ): void {
    const required = (card.effects ?? []).reduce((sum, effect) => {
      if (effect.type !== 'discard' || effect.amount === 'all') return sum;
      return sum + Math.max(0, this.number(effect.amount ?? effect.value, 1));
    }, 0);
    if (required > this.discardableHandCount(state, cardInstanceId)) {
      throw new Error(`「${card.name}」需要 ${required} 张可弃置的非空白手牌`);
    }
  }

  private generateBlankCards(
    state: LocalBattleState,
    requested: number,
    source: string,
  ): number {
    const room = Math.max(0, MAGICIAN_BLANK_LIMIT - this.blankCardCount(state));
    const created = Math.min(room, Math.max(0, Math.floor(requested)));
    if (created > 0) {
      const instances = Array.from({ length: created }, (_, index) => ({
        instanceId: `${MAGICIAN_BLANK_CARD_ID}:${Date.now()}:${index}:${Math.floor(this.random() * 1_000_000)}`,
        cardId: MAGICIAN_BLANK_CARD_ID,
      }));
      state.player.drawPile = this.shuffle([
        ...state.player.drawPile,
        ...instances,
      ]);
    }
    this.log(
      state,
      'player',
      created > 0
        ? `${source}将 ${created} 张空白牌洗入抽牌堆（${this.blankCardCount(state)}/${MAGICIAN_BLANK_LIMIT}）`
        : `${source}未生成空白牌：场上已达到 ${MAGICIAN_BLANK_LIMIT} 张上限`,
    );
    return created;
  }

  private triggerBlankGenerators(state: LocalBattleState): void {
    const generators = state.player.blankGenerators ?? [];
    if (generators.length === 0) return;
    let created = 0;
    for (const generator of generators) {
      created += this.generateBlankCards(
        state,
        generator.amount,
        '不竭牌匣',
      );
      generator.turns -= 1;
    }
    state.player.blankGenerators = generators.filter(
      (generator) => generator.turns > 0,
    );
    this.log(
      state,
      'system',
      `不竭牌匣本回合共洗入 ${created} 张空白牌，剩余 ${state.player.blankGenerators.length} 个持续效果`,
    );
  }

  private resolveCaelianActions(state: LocalBattleState): void {
    const companion = state.companion;
    if (!companion || companion.injured || companion.hp <= 0) return;
    if (companion.debuffs.freeze) {
      this.log(state, 'system', '凯利安被冰冻，本轮无法行动，技能序列保持不变。');
      this.animation(state, {
        kind: 'status',
        sourceSide: 'companion',
        sourceId: companion.id,
        targetSide: 'companion',
        targetId: companion.id,
        label: '冰冻',
      });
      return;
    }
    const sequence = companion.actionSequence;
    if (sequence.length === 0) return;
    let resolved = 0;
    while (resolved < sequence.length && this.aliveEnemies(state).length > 0) {
      const skill = sequence[companion.actionIndex % sequence.length];
      if (!skill || state.player.ap < skill.apCost) break;
      state.player.ap -= skill.apCost;
      this.log(
        state,
        'player',
        `凯利安消耗 ${skill.apCost} AP，施放「${skill.name}」`,
      );
      this.animation(state, {
        kind: 'companion-action',
        sourceSide: 'companion',
        sourceId: companion.id,
        targetSide: 'enemy',
        targetId: state.enemies[this.resolveTargetIndex(state, state.selectedTarget)]?.id,
        apAfter: state.player.ap,
        label: skill.name,
      });
      this.resolveCaelianSkill(state, companion, skill.id, skill.name);
      companion.actionIndex = (companion.actionIndex + 1) % sequence.length;
      resolved += 1;
      this.stabilizeCompanion(state);
    }
    if (resolved === 0) {
      const pending = sequence[companion.actionIndex % sequence.length];
      if (pending) {
        this.log(
          state,
          'system',
          `剩余 AP 不足，凯利安保留下一行动「${pending.name}」（需要 ${pending.apCost} AP）`,
        );
      }
    }
    this.stabilizeCompanion(state);
  }

  private resolveCaelianSkill(
    state: LocalBattleState,
    companion: BattleCompanionState,
    skillId: string,
    label: string,
  ): void {
    const target = state.enemies[this.resolveTargetIndex(state, state.selectedTarget)];
    if (!target) return;
    const level = companion.level;
    switch (skillId) {
      case 'radiant_lance':
        this.damage(
          state,
          companion,
          target,
          Math.round(companion.attack * 0.42 + 5 + level * 0.8),
          'player',
          label,
        );
        break;
      case 'aegis_procession':
        for (const ally of this.cardFriendlyTargets(state, 'all_allies', 'player')) {
          this.grantFriendlyShield(state, ally, 6 + Math.floor(level * 0.8), label, 'companion');
        }
        break;
      case 'dawn_mend': {
        const allies = this.cardFriendlyTargets(state, 'all_allies', 'player')
          .filter((ally) => ally.hp > 0)
          .sort((left, right) => left.hp / left.hpMax - right.hp / right.hpMax);
        if (allies[0]) this.heal(state, allies[0], 8 + Math.floor(level * 1.1), label);
        break;
      }
      case 'trelio_convergence': {
        this.damage(
          state,
          companion,
          target,
          Math.round(companion.attack * 0.34 + level),
          'player',
          label,
        );
        const trelio = companion.summons.find((summon) => summon.id === 'trelio' && summon.hp > 0);
        const nextTarget = state.enemies[this.resolveTargetIndex(state, state.selectedTarget)];
        if (trelio && nextTarget?.hp) {
          this.animation(state, {
            kind: 'companion-action',
            sourceSide: 'summon',
            sourceId: trelio.id,
            targetSide: 'enemy',
            targetId: nextTarget.id,
            label: '特莱奥·圣龙吐息',
          });
          this.damage(
            state,
            trelio,
            nextTarget,
            Math.round(trelio.attack * 0.32 + level),
            'player',
            '圣龙吐息',
          );
        }
        break;
      }
      case 'purifying_standard':
        for (const ally of this.cardFriendlyTargets(state, 'all_allies', 'player')) {
          const removed = this.removeEffects(ally.debuffs, 1);
          this.addTimedEffect(ally.buffs, 'fortitude', 1, 2);
          const identity = this.combatantIdentity(state, ally);
          this.animation(state, {
            kind: 'status',
            sourceSide: 'companion',
            sourceId: companion.id,
            targetSide: identity.side,
            targetId: identity.id,
            amount: removed,
            label: '净化·坚韧',
          });
        }
        break;
      case 'sunlit_judgement':
        for (const enemy of this.aliveEnemies(state)) {
          this.damage(
            state,
            companion,
            enemy,
            Math.round(companion.attack * 0.24 + 4 + level * 0.6),
            'player',
            label,
          );
        }
        break;
    }
  }

  private resolveTrelioSummon(state: LocalBattleState): void {
    const companion = state.companion;
    const trelio = companion?.summons.find(
      (summon) => summon.id === 'trelio' && summon.hp > 0,
    );
    const target = state.enemies[this.resolveTargetIndex(state, state.selectedTarget)];
    if (!trelio || trelio.debuffs.freeze || !target?.hp) return;
    this.animation(state, {
      kind: 'companion-action',
      sourceSide: 'summon',
      sourceId: trelio.id,
      targetSide: 'enemy',
      targetId: target.id,
      label: '特莱奥·圣光爪击',
    });
    this.damage(
      state,
      trelio,
      target,
      Math.round(trelio.attack * 0.2 + companion!.level * 0.35),
      'player',
      '圣光爪击',
    );
  }

  private resolveSummons(state: LocalBattleState): void {
    this.stabilizePlayerSummons(state);
    for (const summon of [...state.player.summons]) {
      const normalized = this.normalizePlayerSummon(summon);
      if (normalized.hp <= 0) continue;
      this.applyStartOfTurnEffects(state, normalized);
      if (normalized.hp <= 0) continue;
      this.resolvePlayerSummonAction(state, normalized);
      if (normalized.mechanical || normalized.attackable === false) {
        normalized.duration -= 1;
      }
    }
    this.stabilizePlayerSummons(state);
  }

  private addSummon(state: LocalBattleState, effect: CardEffect): void {
    const name = String(effect.name ?? '召唤物');
    const baseId = String(effect.id ?? `summon:${name}`);
    const uniqueByName = effect.unique_by_name !== false;
    const attackable = effect.attackable !== false;
    const mechanical = effect.mechanical === true || !attackable;
    const rawHpRatio = this.number(effect.hp_ratio, attackable ? 80 : 0);
    const hpRatio = rawHpRatio > 0 && rawHpRatio <= 1
      ? rawHpRatio * 100
      : rawHpRatio;
    const hpMax = attackable
      ? Math.max(1, Math.round((state.player.hpMax * hpRatio) / 100))
      : 1;
    const duration = Math.max(
      1,
      this.number(effect.duration ?? effect.max_turns, 3),
    );
    const existing = uniqueByName
      ? state.player.summons.find(
          (summon) => summon.id === baseId || summon.name === name,
        )
      : undefined;
    if (existing) {
      const normalized = this.normalizePlayerSummon(existing);
      normalized.hpMax = hpMax;
      normalized.hp = hpMax;
      normalized.duration = duration;
      normalized.attackable = attackable;
      normalized.mechanical = mechanical;
      this.log(
        state,
        'system',
        attackable
          ? `${name} 的生命已回复至上限`
          : `${name} 的存在时间已刷新至 ${duration} 回合`,
      );
      return;
    }
    const summon = this.normalizePlayerSummon({
      id: uniqueByName
        ? baseId
        : `${baseId}:${Date.now()}:${Math.floor(this.random() * 1_000_000)}`,
      name,
      duration,
      hp: hpMax,
      hpMax,
      shield: 0,
      attack: Math.max(
        0,
        this.number(
          effect.attack,
          Math.max(3, Math.floor(state.player.attack * 0.35)),
        ),
      ),
      defense: Math.max(0, this.number(effect.defense)),
      speed: Math.max(0, this.number(effect.speed, state.player.speed)),
      attackable,
      mechanical,
      buffs: {},
      debuffs: {},
      skills: Array.isArray(effect.skills) ? effect.skills : [],
    });
    state.player.summons.push(summon);
    this.applyWorkshopSummonTalentStatuses(
      state,
      this.normalizePlayerSummon(summon),
    );
    this.log(state, 'player', `召唤 ${name}`);
    this.runWorkshopMechanisms(state, 'summon_created', { summonName: name });
    if (state.player.buffs.summon_entry_double) {
      this.resolvePlayerSummonAction(state, summon, '双重契约·入场行动');
      this.spendEffectCharge(state.player.buffs, 'summon_entry_double');
      this.log(state, 'player', `${name} 受双重契约影响，立即额外行动一次`);
    }
  }

  private normalizePlayerSummon(
    summon: BattleSummonState,
  ): PlayerSummonCombatant {
    const attackable = summon.attackable ?? summon.hp !== null;
    summon.attackable = attackable;
    summon.mechanical ??= !attackable;
    summon.hp = Math.max(0, this.number(summon.hp, 1));
    summon.hpMax = Math.max(1, this.number(summon.hpMax, summon.hp || 1));
    summon.shield = Math.max(0, this.number(summon.shield));
    summon.attack = Math.max(0, this.number(summon.attack, 4));
    summon.defense = Math.max(0, this.number(summon.defense));
    summon.speed = Math.max(0, this.number(summon.speed));
    summon.buffs ??= {};
    summon.debuffs ??= {};
    return summon as PlayerSummonCombatant;
  }

  private activePlayerSummonCombatant(): PlayerSummonCombatant | undefined {
    return this.activePlayerSummon
      ? this.normalizePlayerSummon(this.activePlayerSummon)
      : undefined;
  }

  private activeSummonEffectValue(rawValue: unknown): number {
    let value = Math.max(0, this.number(rawValue));
    const summon = this.activePlayerSummonCombatant();
    if (summon?.buffs.summon_skill_amp) {
      value = Math.ceil(
        value * (1 + this.effectValue(summon.buffs.summon_skill_amp) / 100),
      );
    }
    return value;
  }

  private resolvePlayerSummonAction(
    state: LocalBattleState,
    summon: PlayerSummonCombatant,
    forcedLabel?: string,
  ): void {
    const skills = summon.skills.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null,
    );
    const fallback: Record<string, unknown> = {
      name: '协同攻击',
      weight: 1,
      effects: [{ type: 'damage', value: summon.attack, target: 'enemy' }],
    };
    const chosen = this.weightedChoice(
      skills.length > 0 ? skills : [fallback],
      (skill) => Math.max(1, this.number(skill.weight, 1)),
    );
    const targetIndex = this.resolveTargetIndex(state, state.selectedTarget);
    if (!chosen || !state.enemies[targetIndex]?.hp) return;
    const effects = Array.isArray(chosen.effects)
      ? (chosen.effects as CardEffect[])
      : [];
    const skillName = forcedLabel ?? String(chosen.name ?? '技能');
    this.log(state, 'player', `${summon.name}发动「${skillName}」`);
    const virtualCard: CardDefinition = {
      name: `${summon.name}·${skillName}`,
      type: 'summon',
      cost: 0,
      rarity: 'common',
      description: '',
      effects,
    };
    const previousResolving = this.resolvingPlayerSummonEffect;
    const previousSummon = this.activePlayerSummon;
    this.resolvingPlayerSummonEffect = true;
    this.activePlayerSummon = summon;
    try {
      for (const effect of effects) {
        this.applyCardEffect(state, virtualCard, effect, targetIndex);
      }
    } finally {
      this.resolvingPlayerSummonEffect = previousResolving;
      this.activePlayerSummon = previousSummon;
    }
  }

  private stabilizePlayerSummons(state: LocalBattleState): void {
    const removed: BattleSummonState[] = [];
    state.player.summons = state.player.summons.filter((summon) => {
      const normalized = this.normalizePlayerSummon(summon);
      const active =
        normalized.hp > 0 &&
        (!(normalized.mechanical || normalized.attackable === false) ||
          normalized.duration > 0);
      if (!active) removed.push(summon);
      return active;
    });
    this.recordPlayerSummonRemovals(state, removed, '离场');
  }

  private removePlayerSummons(
    state: LocalBattleState,
    summons: BattleSummonState[],
    reason: string,
  ): number {
    const requestedIds = new Set(summons.map((summon) => summon.id));
    if (requestedIds.size === 0) return 0;
    const removed = state.player.summons.filter((summon) =>
      requestedIds.has(summon.id),
    );
    state.player.summons = state.player.summons.filter(
      (summon) => !requestedIds.has(summon.id),
    );
    this.recordPlayerSummonRemovals(state, removed, reason);
    return removed.length;
  }

  private recordPlayerSummonRemovals(
    state: LocalBattleState,
    removed: BattleSummonState[],
    reason: string,
  ): void {
    if (removed.length === 0) return;
    state.player.summonsLost =
      (state.player.summonsLost ?? 0) + removed.length;
    for (const summon of removed) {
      this.runWorkshopMechanisms(state, 'summon_removed', {
        summonId: summon.id,
      });
      this.log(state, 'system', `${summon.name} 已${reason}`);
    }
  }

  private resolveChants(state: LocalBattleState): void {
    for (const chant of [...state.player.chants]) {
      chant.turns -= 1;
      if (chant.turns <= 0) this.resolveChant(state, chant, 1);
    }
    state.player.chants = state.player.chants.filter((chant) => chant.turns > 0);
  }

  private resolveChant(
    state: LocalBattleState,
    chant: LocalBattleState['player']['chants'][number],
    multiplier: number,
  ): void {
    const runtime = chant as typeof chant & {
      targetIndex?: number;
      multiplier?: number;
    };
    const targetIndex = this.resolveTargetIndex(
      state,
      runtime.targetIndex ?? state.selectedTarget,
    );
    const resolvedMultiplier =
      multiplier * this.number(runtime.multiplier, 1);
    const virtualCard: CardDefinition = {
      name: chant.name,
      type: 'spell',
      cost: 0,
      rarity: 'common',
      description: '',
      effects: chant.effects as CardEffect[],
    };
    this.log(state, 'player', `吟诵「${chant.name}」完成`);
    for (const rawEffect of chant.effects) {
      if (typeof rawEffect !== 'object' || rawEffect === null) continue;
      const effect = { ...(rawEffect as CardEffect) };
      if (typeof effect.value === 'number') effect.value *= resolvedMultiplier;
      this.applyCardEffect(state, virtualCard, effect, targetIndex);
    }
    if (state.player.subclass === 'arcane_mage') {
      this.restoreMp(state, 1, '吟诵完成');
    }
  }

  private applyStartOfTurnEffects(
    state: LocalBattleState,
    target: Combatant,
  ): void {
    if (target.buffs.regen) {
      this.heal(state, target, this.effectValue(target.buffs.regen), '再生');
    }
    if (target === state.player) {
      if (target.buffs.heal_regen) {
        this.heal(
          state,
          target,
          this.effectValue(target.buffs.heal_regen),
          '持续治疗',
        );
      }
      if (target.buffs.shield_regen) {
        target.shield += this.effectValue(target.buffs.shield_regen);
      }
      if (target.buffs.ap_regen) {
        state.player.ap += this.effectValue(target.buffs.ap_regen);
      }
      if (target.buffs.mp_regen) {
        this.restoreMp(
          state,
          this.effectValue(target.buffs.mp_regen),
          '持续回魔',
        );
      }
      if (target.buffs.draw_regen) {
        this.drawCards(state, this.effectValue(target.buffs.draw_regen));
      }
    }
    const customHeal = this.workshopStatusEffectValue(
      state,
      target,
      'turn_heal',
    );
    if (customHeal > 0) {
      this.heal(state, target, customHeal, '自定义状态持续治疗');
    }
    const customShield = this.workshopStatusEffectValue(
      state,
      target,
      'turn_shield',
    );
    if (customShield > 0) {
      target.shield += customShield;
      this.log(
        state,
        'system',
        `${target.name ?? '目标'} 的自定义状态赋予 ${customShield} 点护盾。`,
      );
    }
    const customDamage = this.workshopStatusEffectValue(
      state,
      target,
      'turn_damage',
    );
    if (customDamage > 0) {
      this.directHpLoss(state, target, customDamage, '自定义状态持续伤害');
    }
    const opposingAttack =
      this.combatantIdentity(state, target).side === 'enemy'
        ? state.player.attack
        : Math.max(0, ...this.aliveEnemies(state).map((enemy) => enemy.attack));
    const dotScales: Record<string, number> = {
      poison: 0.08,
      burn: 0.1,
      bleed: 0.06,
      corrosion: 0.05,
    };
    for (const key of ['poison', 'burn', 'bleed']) {
      const effect = target.debuffs[key];
      if (!effect) continue;
      const amount = Math.max(
        0,
        effect.value + Math.floor(opposingAttack * dotScales[key]!),
      );
      this.directHpLoss(state, target, amount, key);
    }
    const corrosion = target.debuffs.corrosion;
    if (corrosion) {
      const amount = Math.max(
        1,
        corrosion.value + Math.floor(opposingAttack * dotScales.corrosion!),
      );
      if (target.shield > 0) {
        const removed = Math.min(target.shield, amount);
        target.shield -= removed;
        this.log(state, 'enemy', `${target.name ?? '目标'} 的护盾被腐蚀 ${removed}`);
      } else {
        this.directHpLoss(
          state,
          target,
          Math.max(1, Math.floor(amount / 2)),
          '腐蚀',
        );
      }
    }
  }

  private applyPlayerEndTurnEffects(state: LocalBattleState): void {
    const field = state.player.buffs.end_turn_enemy_damage;
    if (!field) return;
    const target = state.enemies[
      this.resolveTargetIndex(state, state.selectedTarget)
    ];
    const amount = Math.max(0, this.effectValue(field));
    if (!target || target.hp <= 0 || amount <= 0) return;
    this.damage(
      state,
      state.player,
      target,
      amount,
      'player',
      '回合结束伤害',
      { ignoreStrength: true, ignoreWeak: true },
    );
  }

  private createBossMechanic(
    monster: MonsterDefinition,
  ): LocalBattleState['bossMechanic'] {
    const id = String(monster.boss_mechanic ?? '');
    if (!id) return undefined;
    return {
      id,
      phase: 0,
      gauge: 0,
      requiredCardType: id === 'academy_exam' ? 'attack' : undefined,
      playedCardTypes: [],
      repeatedCount: 0,
    };
  }

  private recordBossMechanicCard(
    state: LocalBattleState,
    cardType: string,
  ): void {
    const mechanic = state.bossMechanic;
    if (!mechanic) return;
    mechanic.playedCardTypes.push(cardType);
    if (mechanic.repeatedCardType === cardType) mechanic.repeatedCount += 1;
    else {
      mechanic.repeatedCardType = cardType;
      mechanic.repeatedCount = 1;
    }
    if (mechanic.id === 'heat_gauge') {
      mechanic.gauge = this.clamp(
        mechanic.gauge + (cardType === 'attack' ? 10 : cardType === 'defense' ? -8 : -3),
        0,
        100,
      );
    }
    if (mechanic.id === 'three_evidence_judgement') {
      const unique = new Set(mechanic.playedCardTypes);
      const boss = this.aliveEnemies(state)[0];
      if (boss && unique.size >= 3 && boss.buffs.evidence_barrier) {
        delete boss.buffs.evidence_barrier;
        this.log(state, 'system', '三类证据已经齐备，空洞圣徒的裁决屏障被破解。');
      }
    }
  }

  private resolveBossMechanicTurn(state: LocalBattleState): void {
    const mechanic = state.bossMechanic;
    const boss = this.aliveEnemies(state)[0];
    if (!mechanic || !boss) return;
    const played = mechanic.playedCardTypes;
    if (mechanic.id === 'academy_exam') {
      const passed = played.includes(mechanic.requiredCardType ?? 'attack');
      if (passed) {
        this.tryApplyDebuff(state, boss, 'vulnerable', 1, 1);
        this.log(state, 'system', '学院考核通过：魔像的术式暴露。');
      } else {
        this.addTimedEffect(boss.buffs, 'strength', 3, 2);
        this.log(state, 'system', `学院考核失败：本回合需要使用${mechanic.requiredCardType}牌。`);
      }
      const rotation = ['attack', 'defense', 'skill', 'spell'];
      mechanic.phase = (mechanic.phase + 1) % rotation.length;
      mechanic.requiredCardType = rotation[mechanic.phase];
    } else if (mechanic.id === 'soul_balance') {
      const attacks = played.filter((type) => type === 'attack').length;
      const defenses = played.filter((type) => type === 'defense').length;
      if (Math.abs(attacks - defenses) <= 1) {
        state.player.shield += 8;
        this.log(state, 'system', '灵魂天平保持平衡，玩家获得 8 点护盾。');
      } else {
        this.tryApplyDebuff(state, state.player, 'weak', 1, 1);
        this.log(state, 'system', '灵魂天平失衡，玩家陷入虚弱。');
      }
    } else if (mechanic.id === 'three_evidence_judgement') {
      boss.buffs.evidence_barrier ??= { value: 60, turns: 99 };
    } else if (mechanic.id === 'tide_rhythm') {
      mechanic.phase = (mechanic.phase + 1) % 3;
      if (mechanic.phase === 0) {
        boss.shield += 15;
        this.log(state, 'system', '潮汐进入涨潮相，女王获得 15 点护盾。');
      } else if (mechanic.phase === 1) {
        this.damage(state, boss, state.player, 8, 'enemy', '潮汐冲击', true);
      } else {
        this.tryApplyDebuff(state, boss, 'vulnerable', 1, 1);
        this.log(state, 'system', '潮汐进入退潮相，女王暂时易伤。');
      }
    } else if (mechanic.id === 'dream_layers') {
      mechanic.phase += 1;
      if (mechanic.phase >= 2 && mechanic.phase <= 4) {
        this.tryApplyDebuff(state, boss, 'vulnerable', 1, 1);
      } else if (mechanic.phase >= 5) {
        mechanic.phase = 0;
        this.tryApplyDebuff(state, state.player, 'weak', 1, 2);
        this.log(state, 'system', '梦境抵达最深层后崩塌，玩家陷入虚弱。');
      }
    } else if (mechanic.id === 'mirror_record') {
      if (mechanic.repeatedCount >= 2) {
        this.damage(
          state,
          boss,
          state.player,
          mechanic.repeatedCount * 4,
          'enemy',
          '镜像复写',
          true,
        );
        this.log(state, 'system', '镜像公爵夫人复写了连续使用的牌型。');
      }
    } else if (mechanic.id === 'heat_gauge' && mechanic.gauge >= 100) {
      this.damage(state, boss, state.player, 15, 'enemy', '炉心过载', true);
      this.tryApplyDebuff(state, boss, 'vulnerable', 1, 2);
      mechanic.gauge = 0;
      this.log(state, 'system', '炉心过载：双方受冲击，核心进入易伤。');
    } else if (mechanic.id === 'leviathan_parts') {
      mechanic.phase += 1;
      if (mechanic.phase % 2 === 1) {
        boss.shield += 12;
        this.log(state, 'system', '利维坦触肢护住头部，获得 12 点护盾。');
      } else {
        this.damage(state, boss, state.player, 10, 'enemy', '尾部横扫', true);
      }
    }
    mechanic.playedCardTypes = [];
    mechanic.repeatedCardType = undefined;
    mechanic.repeatedCount = 0;
  }

  private tickEffects(target: Combatant): void {
    for (const effects of [target.buffs, target.debuffs]) {
      for (const key of Object.keys(effects)) {
        this.mutateTimedEffect(effects, key, (instance) => {
          if (instance.fresh) {
            delete instance.fresh;
            return;
          }
          if (instance.turns >= 0) instance.turns -= 1;
        });
      }
    }
  }

  private applyBattleStartPassives(
    state: LocalBattleState,
    passiveIds: string[],
  ): void {
    for (const passiveId of passiveIds) {
      const passive = this.passives?.[passiveId];
      const effect = passive?.effect;
      if (!effect) continue;
      const effects =
        effect.type === 'multi' && Array.isArray(effect.effects)
          ? (effect.effects as CardEffect[])
          : [effect];
      this.applyBattleStartEffectList(state, passive.name, effects);
    }
  }

  private applyBattleStartEffectList(
    state: LocalBattleState,
    name: string,
    effects: CardEffect[],
  ): void {
    state.player.passiveEffects ??= [];
    state.player.passiveEffects.push(...structuredClone(effects));
    for (const child of effects) {
      if (child.type === 'battle_start_shield') {
        state.player.shield += this.number(child.value);
      } else if (child.type === 'battle_start_mp') {
        state.player.mp = Math.min(
          state.player.mpMax,
          state.player.mp + this.number(child.value),
        );
      } else if (child.type === 'extra_draw') {
        state.player.drawPerTurn += this.number(child.value);
      } else if (child.type === 'hand_limit_bonus') {
        state.player.handLimit += this.number(child.value);
      } else if (child.type === 'first_turn_ap') {
        state.player.ap += this.number(child.value);
      } else if (child.type === 'apply_workshop_status') {
        this.applyWorkshopTalentStatus(state, child);
      } else if (
        child.type === 'workshop_resource_change' &&
        child.trigger === 'battle_start'
      ) {
        this.applyWorkshopTalentResourceChange(state, child);
      }
    }
    this.log(state, 'system', `被动「${name}」生效`);
  }

  private applyTurnStartPassives(
    state: LocalBattleState,
    profileId: string,
  ): void {
    void profileId;
    for (const rawEffect of state.player.passiveEffects ?? []) {
      if (typeof rawEffect !== 'object' || rawEffect === null) continue;
      const effect = rawEffect as CardEffect;
      if (effect.type === 'turn_start_heal') {
        this.heal(
          state,
          state.player,
          this.number(effect.value),
          '职业天赋',
        );
      } else if (effect.type === 'turn_start_cleanse') {
        this.removeEffects(state.player.debuffs, this.number(effect.value, 1));
      } else if (
        effect.type === 'turn_start_debuff_shield' &&
        Object.keys(state.player.debuffs).length > 0
      ) {
        state.player.shield += this.number(effect.value);
      } else if (effect.type === 'turn_start_mp' || effect.type === 'mp_regen') {
        this.restoreMp(state, this.number(effect.value), '藏品');
      } else if (effect.type === 'turn_start_shield') {
        state.player.shield += this.number(effect.value);
      } else if (
        effect.type === 'workshop_resource_change' &&
        effect.trigger === 'turn_start'
      ) {
        this.applyWorkshopTalentResourceChange(state, effect);
      }
    }
  }

  private cardCost(
    card: CardDefinition,
    state: LocalBattleState,
    targetIndex: number,
  ): number {
    let cost = Math.max(0, this.number(card.cost));
    if (card.type === 'attack' && state.player.buffs.cost_reduction) {
      cost -= this.effectValue(state.player.buffs.cost_reduction);
    }
    if (this.isSpellCard(card)) {
      if (state.player.buffs.next_spell_ap_free) cost = 0;
      cost -= this.effectValue(state.player.buffs.next_spell_ap_reduce);
    }
    if (this.isSummonCard(card)) {
      cost -= this.effectValue(state.player.buffs.next_summon_ap_reduce);
    }
    if (this.isMechanicalSummonCard(card)) {
      cost -= this.effectValue(
        state.player.buffs.next_mech_summon_ap_reduce,
      );
    }
    const target = state.enemies[targetIndex];
    for (const effect of card.effects ?? []) {
      if (
        effect.type === 'conditional_cost_reduction' &&
        target &&
        this.conditionMatches(effect, state, target)
      ) {
        cost -= this.number(effect.value);
      }
    }
    return Math.max(0, cost);
  }

  private cardMpCost(card: CardDefinition, state: LocalBattleState): number {
    let cost = Math.max(0, this.number(card.mpCost));
    if (this.isSpellCard(card)) {
      cost -= this.effectValue(state.player.buffs.next_spell_mp_reduce);
      if (this.cardElement(card) === 'water') {
        cost -= this.effectValue(
          state.player.buffs.next_water_spell_mp_reduce,
        );
      }
    }
    return Math.max(0, Math.round(cost));
  }

  private spendCardCostBuffs(
    state: LocalBattleState,
    card: CardDefinition,
  ): void {
    if (card.type === 'attack') {
      this.spendEffectCharge(state.player.buffs, 'cost_reduction');
    }
    if (this.isSpellCard(card)) {
      this.spendEffectCharge(state.player.buffs, 'next_spell_ap_free');
      this.spendEffectCharge(state.player.buffs, 'next_spell_ap_reduce');
      this.spendEffectCharge(state.player.buffs, 'next_spell_mp_reduce');
      if (this.cardElement(card) === 'water') {
        this.spendEffectCharge(
          state.player.buffs,
          'next_water_spell_mp_reduce',
        );
      }
    }
    if (this.isSummonCard(card)) {
      this.spendEffectCharge(state.player.buffs, 'next_summon_ap_reduce');
    }
    if (this.isMechanicalSummonCard(card)) {
      this.spendEffectCharge(
        state.player.buffs,
        'next_mech_summon_ap_reduce',
      );
    }
  }

  private isSummonCard(card: CardDefinition): boolean {
    return (
      card.type === 'summon' ||
      this.cardHasNestedEffect(
        card.effects ?? [],
        (effect) => effect.type === 'summon',
      )
    );
  }

  private isMechanicalSummonCard(card: CardDefinition): boolean {
    if (!this.isSummonCard(card)) return false;
    if (
      this.cardHasNestedEffect(
        card.effects ?? [],
        (effect) =>
          effect.type === 'summon' &&
          (effect.mechanical === true || effect.attackable === false),
      )
    ) {
      return true;
    }
    return /机械|齿轮|装填|无人机|机器人|核心|炮台|机械臂|锻锤/.test(
      `${card.name}${card.description}${String(card.brief ?? '')}${String(card.cat ?? '')}`,
    );
  }

  private cardDamageBonus(
    card: CardDefinition,
    state: LocalBattleState,
    target: BattleEnemyState,
  ): number {
    let bonus = 0;
    bonus += this.effectValue(state.player.buffs.damage_bonus);
    bonus += this.effectValue(state.player.buffs.empower);
    if (card.type === 'attack') {
      bonus += this.passiveEffectValue(state, 'attack_bonus');
      bonus += this.effectValue(state.player.buffs.next_attack_bonus);
      bonus += this.effectValue(state.player.buffs.purified_power);
      if (
        state.player.subclass === 'vampire_hunter' &&
        state.player.buffs.blood_moon
      ) {
        bonus += Math.max(3, Math.ceil(state.player.hpMax * 0.08));
      }
    }
    if (this.isSpellCard(card)) {
      bonus += this.effectValue(state.player.buffs.spell_damage_bonus);
    }
    if (
      state.player.buffs.undead_damage_bonus &&
      target.tags.includes('undead')
    ) {
      bonus += this.effectValue(state.player.buffs.undead_damage_bonus);
    }
    for (const rawEffect of state.player.passiveEffects ?? []) {
      if (typeof rawEffect !== 'object' || rawEffect === null) continue;
      const effect = rawEffect as CardEffect;
      if (
        effect.type === 'tag_damage_bonus' &&
        Array.isArray(effect.tags) &&
        effect.tags.map(String).some((tag) => target.tags.includes(tag))
      ) {
        bonus += this.number(effect.value ?? effect.bonus);
      }
    }
    for (const effect of card.effects ?? []) {
      if (
        effect.type === 'conditional_bonus' &&
        this.conditionMatches(effect, state, target)
      ) {
        bonus += this.number(effect.bonus);
      }
      if (
        effect.type === 'bonus_vs_tag' &&
        Array.isArray(effect.tags) &&
        effect.tags.map(String).some((tag) => target.tags.includes(tag))
      ) {
        bonus += this.number(effect.bonus);
      }
    }
    if (
      state.player.subclass === 'dark_mage' &&
      this.isAbyssSpellCard(card)
    ) {
      bonus += this.classResource(state, 'abyss_echo') * 2;
    }
    if (
      state.player.subclass === 'dragon_knight' &&
      card.type === 'attack' &&
      this.classResource(state, 'dragon_soul') >= 3
    ) {
      bonus += 6;
    }
    if (state.player.subclass === 'blacksmith' && card.type === 'attack') {
      bonus += this.classResource(state, 'furnace_heat') * 2;
    }
    if (
      state.player.subclass === 'wind_mage' &&
      /风痕/.test(this.cardResourceText(card))
    ) {
      bonus += this.classResource(state, 'wind_mark') * 3;
    }
    const thunderText = this.cardResourceText(card);
    if (
      state.player.subclass === 'thunder_mage' &&
      (/(?:每层|每点|每个)\s*(?:雷荷)?充能[^；，。]*伤害/.test(thunderText) ||
        /(?:雷荷)?充能\s*(?:每层|每点|每个)[^；，。]*伤害/.test(thunderText) ||
        /消耗\s*(?:全部\s*)?(?:雷荷)?充能[^；，。]*[+＋]\s*\d+\s*伤害/.test(thunderText) ||
        (/消耗\s*(?:全部\s*)?(?:雷荷)?充能/.test(thunderText) &&
          /每层\s*[+＋]\s*\d+\s*伤害/.test(thunderText)))
    ) {
      bonus += this.classResource(state, 'thunder_charge') * 3;
    }
    return bonus;
  }

  private weaponMasterComboBonus(
    card: CardDefinition,
    state: LocalBattleState,
  ): number {
    if (
      state.player.subclass !== 'weapon_master' ||
      card.type !== 'attack' ||
      state.player.buffs.weapon_master_no_combo
    ) return 0;
    const cardId = String(
      (card as CardDefinition & { id?: unknown }).id ??
        this.activeMechanismCard?.id ??
        '',
    );
    let playedBefore = state.player.cardsPlayedThisTurn?.[cardId] ?? 0;
    if (state.player.buffs.weapon_master_force_combo && playedBefore < 1) {
      playedBefore = 1;
    }
    if (playedBefore <= 0) return 0;
    const base = playedBefore === 1 ? 2 : 4;
    const extra = this.effectValue(state.player.buffs.weapon_master_bonus_extra);
    const cap = 4 + this.effectValue(state.player.buffs.weapon_master_combo_cap);
    return Math.min(cap, base + extra);
  }

  private cardDamageMultiplier(
    card: CardDefinition,
    state: LocalBattleState,
    target: BattleEnemyState,
  ): number {
    let multiplier = card.effects?.some(
      (effect) =>
        effect.type === 'conditional_double' &&
        this.conditionMatches(effect, state, target),
    )
      ? 2
      : 1;
    if (card.type === 'attack' && state.player.buffs.spell_double) {
      multiplier *= 2;
    }
    if (card.type === 'attack' && state.player.buffs.weapon_master_attack_amp) {
      multiplier *=
        1 + this.effectValue(state.player.buffs.weapon_master_attack_amp) / 100;
    }
    if (card.type === 'attack' && state.player.buffs.attack_amp_percent) {
      multiplier *=
        1 + this.effectValue(state.player.buffs.attack_amp_percent) / 100;
    }
    if (this.isSpellCard(card) && state.player.buffs.spell_amp_percent) {
      multiplier *=
        1 + this.effectValue(state.player.buffs.spell_amp_percent) / 100;
    }
    if (
      this.isSpellCard(card) &&
      this.cardElement(card) === 'thunder' &&
      state.player.buffs.thunder_spell_amp
    ) {
      multiplier *=
        1 + this.effectValue(state.player.buffs.thunder_spell_amp) / 100;
    }
    if (
      state.player.subclass === 'dark_priest' &&
      (card.type === 'attack' || card.type === 'spell')
    ) {
      const lostSanity = 100 - this.clamp(state.player.sanity ?? 100, 0, 100);
      multiplier *= 1 + Math.min(5, Math.floor(lostSanity / 20)) * 0.08;
    }
    return multiplier;
  }

  private amplifiedCardEffectValue(
    state: LocalBattleState,
    card: CardDefinition,
    kind: 'heal' | 'shield',
    rawValue: number,
  ): number {
    let value = this.activeSummonEffectValue(rawValue);
    if (this.resolvingPlayerSummonEffect) {
      return Math.max(0, Math.round(value));
    }
    if (this.isSpellCard(card) && state.player.buffs.spell_amp_percent) {
      value = Math.ceil(
        value *
          (1 + this.effectValue(state.player.buffs.spell_amp_percent) / 100),
      );
    }
    if (
      this.isSpellCard(card) &&
      state.player.buffs.spell_heal_shield_amp
    ) {
      value = Math.ceil(
        value *
          (1 +
            this.effectValue(state.player.buffs.spell_heal_shield_amp) / 100),
      );
    }
    if (kind === 'heal' && state.player.buffs.healing_amp_percent) {
      value = Math.ceil(
        value *
          (1 + this.effectValue(state.player.buffs.healing_amp_percent) / 100),
      );
    }
    return Math.max(0, Math.round(value));
  }

  private isAbyssSpellCard(card: CardDefinition): boolean {
    return (
      (card.cls === 'dark_mage' || card.cat === 'sub_dark_mage') &&
      (card.type === 'spell' ||
        this.cardElement(card) === 'dark' ||
        /深渊|虚空|暗|黑潮/.test(`${card.name}${card.description}`))
    );
  }

  private isSpellCard(card: CardDefinition): boolean {
    return card.type === 'spell';
  }

  private isCleanseCard(card: CardDefinition): boolean {
    return (
      card.effects?.some((effect) => String(effect.type).includes('cleanse')) ||
      /净化|解毒|万能解药|圣光/.test(`${card.name}${card.description}`)
    );
  }

  private conditionMatches(
    raw: unknown,
    state: LocalBattleState,
    target: BattleEnemyState,
  ): boolean {
    const condition =
      typeof raw === 'string'
        ? raw
        : typeof raw === 'object' && raw !== null
          ? String(
              (raw as Record<string, unknown>).condition ??
                (raw as Record<string, unknown>).type ??
                '',
            )
          : '';
    const detail =
      typeof raw === 'object' && raw !== null
        ? (raw as Record<string, unknown>)
        : {};
    switch (condition) {
      case 'has_shield':
      case 'self_has_shield':
        return state.player.shield > 0;
      case 'self_no_shield':
        return state.player.shield <= 0;
      case 'self_no_debuff':
        return Object.keys(state.player.debuffs).length === 0;
      case 'self_has_debuff':
        return Object.keys(state.player.debuffs).length > 0;
      case 'enemy_has_debuff':
        return Object.keys(target.debuffs).length > 0;
      case 'enemy_no_debuff':
        return Object.keys(target.debuffs).length === 0;
      case 'enemy_has_specific_debuff':
        return Boolean(target.debuffs[String(detail.debuff)]);
      case 'enemy_has_any_specific_debuff':
        return (
          Array.isArray(detail.debuffs) &&
          detail.debuffs
            .map(String)
            .some((debuff) => Boolean(target.debuffs[debuff]))
        );
      case 'enemy_has_buff':
        return Object.keys(target.buffs).length > 0;
      case 'enemy_has_shield':
        return target.shield > 0;
      case 'enemy_no_shield':
      case 'no_shield':
        return target.shield <= 0;
      case 'enemy_no_specific_debuff':
        return !target.debuffs[String(detail.debuff)];
      case 'self_has_buff':
        return Object.keys(state.player.buffs).length > 0;
      case 'self_has_specific_buff':
        return Boolean(state.player.buffs[String(detail.buff)]);
      case 'self_no_buff':
        return Object.keys(state.player.buffs).length === 0;
      case 'self_full_hp':
        return state.player.hp >= state.player.hpMax;
      case 'self_not_full_hp':
        return state.player.hp < state.player.hpMax;
      case 'has_summon':
        return state.player.summons.length > 0;
      case 'no_summon':
        return state.player.summons.length === 0;
      case 'spend_mp':
        return state.player.mp >= this.number(detail.amount ?? detail.value, 1);
      case 'spend_hp':
        return state.player.hp > this.number(detail.amount ?? detail.value, 1);
      case 'discard':
        return (
          this.discardableHandCount(state) >=
          this.number(detail.amount ?? detail.value, 1)
        );
      case 'destroy_summon':
        return (
          state.player.summons.length >=
          this.number(detail.amount ?? detail.value, 1)
        );
      case 'spend_workshop_resource': {
        const found = this.workshopResource(
          state,
          String(detail.mechanismId ?? ''),
          String(detail.resourceId ?? ''),
        );
        if (!found) return false;
        if (detail.amount === 'all') return found.current > found.definition.min;
        return (
          found.current - found.definition.min >=
          Math.max(1, this.number(detail.amount ?? detail.value, 1))
        );
      }
      case 'low_hp':
      case 'self_low_hp':
        return state.player.hp <= state.player.hpMax * 0.5;
      case 'self_hp_below_percent':
        return (
          state.player.hp <=
          state.player.hpMax * (this.number(detail.percent ?? detail.value, 50) / 100)
        );
      case 'mp_below_percent':
        return (
          state.player.mp <=
          state.player.mpMax * (this.number(detail.percent ?? detail.value, 50) / 100)
        );
      case 'last_card_was_spell':
        return state.player.lastCardType === 'spell';
      case 'previous_card_same_name':
        return Boolean(
          this.activeMechanismCard?.name &&
          (state.player.lastCardName === this.activeMechanismCard.name ||
            (!state.player.lastCardName &&
              state.player.lastCardId &&
              this.cardDefinition(state, state.player.lastCardId)?.name ===
                this.activeMechanismCard.name)),
        );
      case 'same_card_played_this_turn': {
        const current = this.activeMechanismCard;
        if (!current) return false;
        if (
          (state.player.cardNamesPlayedThisTurn?.[
            cardNameHistoryKey(current.name)
          ] ?? 0) > 0
        ) {
          return true;
        }
        if (state.player.cardNamesPlayedThisTurn) return false;
        return Object.entries(state.player.cardsPlayedThisTurn ?? {}).some(
          ([playedId, count]) =>
            count > 0 &&
            this.cardDefinition(state, playedId)?.name === current.name,
        );
      }
      case 'summon_died_this_battle':
        return (state.player.summonsLost ?? 0) > 0;
      case 'has_chant':
        return state.player.chants.length > 0;
      default:
        return false;
    }
  }

  private passiveEffectValue(
    state: LocalBattleState,
    type: string,
  ): number {
    return (state.player.passiveEffects ?? []).reduce<number>((sum, rawEffect) => {
      if (typeof rawEffect !== 'object' || rawEffect === null) return sum;
      const effect = rawEffect as CardEffect;
      return effect.type === type
        ? sum + this.number(effect.value ?? effect.ratio)
        : sum;
    }, 0);
  }

  private playerLifestealPercent(state: LocalBattleState): number {
    return (
      Math.max(0, this.number(state.player.lifesteal)) +
      Math.max(0, this.passiveEffectValue(state, 'lifesteal_ratio')) * 100
    );
  }

  private playerLifestealRatio(state: LocalBattleState): number {
    return this.clamp(this.playerLifestealPercent(state) / 100, 0, 1);
  }

  private syncInheritedLifesteal(state: LocalBattleState): void {
    if (!state.companion) return;
    const inherited = this.playerLifestealPercent(state) * 0.8;
    state.companion.lifesteal = inherited;
    for (const summon of state.companion.summons) summon.lifesteal = inherited;
  }

  private classResourceKey(value: unknown): string {
    const key = String(value ?? 'class_resource').toLowerCase();
    if (/圣印|sigil/.test(key)) return 'holy_sigil';
    if (/龙魂|dragon[_\s-]*soul/.test(key)) return 'dragon_soul';
    if (/余烬|ember/.test(key)) return 'ember_echo';
    if (/风痕|wind[_\s-]*mark/.test(key)) return 'wind_mark';
    if (/生长|growth/.test(key)) return 'growth';
    if (/炉温|furnace|heat/.test(key)) return 'furnace_heat';
    if (/零件|part/.test(key)) return 'parts';
    if (/雷|charge/.test(key)) return 'thunder_charge';
    if (/共鸣|resonance/.test(key)) return 'element_resonance';
    if (/深渊|abyss/.test(key)) return 'abyss_echo';
    if (/猎杀|hunter[_\s-]*prepare/.test(key)) return 'hunter_prepare';
    return key.replace(/\s+/g, '_');
  }

  private classResourceAllowed(state: LocalBattleState, key: string): boolean {
    const owner = CLASS_RESOURCE_OWNERS[key];
    return !owner || state.player.subclass === owner;
  }

  private classResource(state: LocalBattleState, value: unknown): number {
    const key = this.classResourceKey(value);
    if (!this.classResourceAllowed(state, key)) return 0;
    if (key === 'abyss_echo') return this.syncAbyssEcho(state);
    return Math.max(0, Math.floor(state.player.classResources?.[key] ?? 0));
  }

  private setClassResource(
    state: LocalBattleState,
    value: unknown,
    amount: number,
  ): number {
    const key = this.classResourceKey(value);
    if (!this.classResourceAllowed(state, key)) return 0;
    state.player.classResources ??= {};
    const normalized = Math.max(0, Math.floor(amount));
    state.player.classResources[key] = normalized;
    if (key === 'abyss_echo') state.player.abyssEcho = normalized;
    return normalized;
  }

  private addClassResource(
    state: LocalBattleState,
    value: unknown,
    amount = 1,
  ): number {
    const key = this.classResourceKey(value);
    return this.setClassResource(
      state,
      key,
      this.classResource(state, key) + Math.max(0, Math.floor(amount)),
    );
  }

  private consumeClassResource(
    state: LocalBattleState,
    value: unknown,
    amount: number | 'all',
  ): number {
    const key = this.classResourceKey(value);
    const before = this.classResource(state, key);
    const consumed = amount === 'all'
      ? before
      : Math.min(before, Math.max(0, Math.floor(amount)));
    this.setClassResource(state, key, before - consumed);
    if (key === 'abyss_echo' && consumed > 0) {
      state.player.abyssEchoBatches = [];
      this.setClassResource(state, key, 0);
    }
    return consumed;
  }

  private syncAbyssEcho(state: LocalBattleState): number {
    if (state.player.subclass !== 'dark_mage') {
      state.player.abyssEcho = 0;
      state.player.abyssEchoBatches = [];
      if (state.player.classResources) {
        delete state.player.classResources.abyss_echo;
      }
      return 0;
    }
    if (!Array.isArray(state.player.abyssEchoBatches)) {
      const legacyEcho = Math.max(
        0,
        Math.floor(
          Math.max(
            this.number(state.player.abyssEcho),
            this.number(state.player.classResources?.abyss_echo),
          ),
        ),
      );
      state.player.abyssEchoBatches = legacyEcho > 0
        ? [{ turn: state.turn, value: legacyEcho }]
        : [];
    }
    state.player.abyssEchoBatches = state.player.abyssEchoBatches.filter(
      (batch) => batch.value > 0 && state.turn - batch.turn < 2,
    );
    const total = state.player.abyssEchoBatches.reduce(
      (sum, batch) => sum + batch.value,
      0,
    );
    state.player.abyssEcho = total;
    state.player.classResources ??= {};
    state.player.classResources.abyss_echo = total;
    return total;
  }

  private recordAbyssEchoLoss(
    state: LocalBattleState,
    target: Combatant,
  ): void {
    if (state.player.subclass !== 'dark_mage') {
      this.syncAbyssEcho(state);
      return;
    }
    if (target !== state.player) {
      return;
    }
    this.syncAbyssEcho(state);
    const batch = state.player.abyssEchoBatches?.find(
      (entry) => entry.turn === state.turn,
    );
    if (batch) batch.value += 1;
    else (state.player.abyssEchoBatches ??= []).push({ turn: state.turn, value: 1 });
    this.syncAbyssEcho(state);
  }

  private cardResourceText(card: CardDefinition): string {
    return `${card.description ?? ''}；${String(card.brief ?? '')}；${card.name ?? ''}`;
  }

  private resourceLayersFromText(card: CardDefinition, name: string): number {
    const text = this.cardResourceText(card);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const pattern of [
      new RegExp(`获得\\s*(\\d+)\\s*(?:层|个|点)?\\s*${escaped}`),
      new RegExp(`获得\\s*${escaped}\\s*(\\d+)\\s*(?:层|个|点)?`),
      new RegExp(`${escaped}\\s*[+＋]\\s*(\\d+)`),
    ]) {
      const matched = text.match(pattern);
      if (matched) return Math.max(0, this.number(Number(matched[1])));
    }
    return new RegExp(`获得\\s*${escaped}(?:[；，。/]|$)`).test(text) ? 1 : 0;
  }

  private resourceConsumptionFromText(
    card: CardDefinition,
    name: string,
  ): number | 'all' | 0 {
    const text = this.cardResourceText(card);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (
      new RegExp(`消耗\\s*全部\\s*${escaped}`).test(text) ||
      new RegExp(`清空\\s*${escaped}`).test(text)
    ) return 'all';
    for (const pattern of [
      new RegExp(`消耗\\s*(\\d+)\\s*(?:层|个|点)?\\s*${escaped}`),
      new RegExp(`消耗\\s*${escaped}\\s*(\\d+)\\s*(?:层|个|点)?`),
    ]) {
      const matched = text.match(pattern);
      if (matched) return Math.max(0, this.number(Number(matched[1])));
    }
    return new RegExp(`消耗\\s*${escaped}`).test(text) ? 1 : 0;
  }

  private assertCardResourceCosts(
    state: LocalBattleState,
    cardId: string,
  ): void {
    const requirements: Record<string, [string, number, string]> = {
      hk_sigil_burst: ['holy_sigil', 1, '没有圣印，无法发动圣印迸发'],
      th_overcharge: ['thunder_charge', 2, '雷荷充能不足：需要 2 层'],
      th_arc_jump: ['thunder_charge', 1, '雷荷充能不足：需要 1 层'],
      wood_growth: ['growth', 1, '生长不足：需要 1 层'],
      mc_overclock: ['parts', 2, '零件不足：需要 2 个'],
      mc_parts_bomb: ['parts', 1, '没有零件，无法引爆零件炸弹'],
    };
    const requirement = requirements[cardId];
    if (requirement && this.classResource(state, requirement[0]) < requirement[1]) {
      throw new Error(requirement[2]);
    }
  }

  private assertCardSummonCosts(
    state: LocalBattleState,
    card: CardDefinition,
  ): void {
    const destructiveEffects: CardEffect[] = [];
    const collect = (effects: CardEffect[]): void => {
      for (const effect of effects) {
        if (effect.type === 'destroy_summon_damage_per') {
          destructiveEffects.push(effect);
        }
        for (const key of ['effects', 'then_effects', 'else_effects']) {
          if (Array.isArray(effect[key])) {
            collect(effect[key] as CardEffect[]);
          }
        }
      }
    };
    collect(card.effects ?? []);
    for (const effect of destructiveEffects) {
      const mechanicalOnly = effect.mechanicalOnly === true;
      const eligible = state.player.summons.some((summon) => {
        const normalized = this.normalizePlayerSummon(summon);
        return normalized.hp > 0 && (!mechanicalOnly || normalized.mechanical);
      });
      if (!eligible) {
        throw new Error(
          mechanicalOnly
            ? '场上没有可摧毁的机械召唤物'
            : '场上没有可摧毁的召唤物',
        );
      }
    }
  }

  private updateClassResourcesAfterCard(
    state: LocalBattleState,
    card: CardDefinition,
    cardId: string,
  ): void {
    const subclass = state.player.subclass ?? '';
    if (subclass === 'holy_knight') {
      const gained = this.resourceLayersFromText(card, '圣印');
      if (gained > 0) this.addClassResource(state, 'holy_sigil', gained);
      const used = this.resourceConsumptionFromText(card, '圣印');
      if (used) this.consumeClassResource(state, 'holy_sigil', used);
    } else if (subclass === 'dragon_knight') {
      if (card.type === 'attack' && this.classResource(state, 'dragon_soul') >= 3) {
        this.consumeClassResource(state, 'dragon_soul', 'all');
      }
    } else if (subclass === 'elementalist') {
      const element = this.cardElement(card);
      const previous = state.player.lastElementalistElement ?? '';
      if (element && previous && element !== previous) {
        this.addClassResource(state, 'element_resonance');
      }
      if (element) state.player.lastElementalistElement = element;
      if (cardId === 'em_element_reset') {
        this.consumeClassResource(state, 'element_resonance', 'all');
      }
    } else if (subclass === 'fire_mage') {
      const gained = this.resourceLayersFromText(card, '余烬');
      if (gained > 0) this.addClassResource(state, 'ember_echo', gained);
      const used = this.resourceConsumptionFromText(card, '余烬');
      if (used) this.consumeClassResource(state, 'ember_echo', used);
    } else if (subclass === 'wind_mage') {
      const gained = this.resourceLayersFromText(card, '风痕');
      if (gained > 0) this.addClassResource(state, 'wind_mark', gained);
      else if (
        cardId === 'wind_reposition' ||
        card.effects?.some((effect) => effect.type === 'draw') ||
        /高天|位移|风/.test(card.name)
      ) this.addClassResource(state, 'wind_mark');
      if (/消耗风痕/.test(this.cardResourceText(card))) {
        this.consumeClassResource(state, 'wind_mark', 'all');
      }
    } else if (subclass === 'thunder_mage') {
      const used =
        this.resourceConsumptionFromText(card, '充能') ||
        this.resourceConsumptionFromText(card, '雷荷充能');
      if (used) this.consumeClassResource(state, 'thunder_charge', used);
      const gained = card.type === 'summon'
        ? 0
        : this.resourceLayersFromText(card, '充能') ||
          this.resourceLayersFromText(card, '雷荷充能');
      if (gained > 0) this.addClassResource(state, 'thunder_charge', gained);
      else if (this.number(card.mpCost) > 0) {
        this.addClassResource(state, 'thunder_charge');
      }
    } else if (subclass === 'wood_mage') {
      const gained = this.resourceLayersFromText(card, '生长');
      if (gained > 0) this.addClassResource(state, 'growth', gained);
      else if (card.effects?.some((effect) => ['heal', 'summon'].includes(effect.type))) {
        this.addClassResource(state, 'growth');
      }
      const used = this.resourceConsumptionFromText(card, '生长');
      if (used) this.consumeClassResource(state, 'growth', used);
    } else if (subclass === 'blacksmith') {
      // Summon skill text belongs to the summon action, not to the card's
      // immediate resource gain. In particular, 自动锻锤 only has a 50%
      // skill that grants furnace heat after it enters play.
      const gained = card.type === 'summon'
        ? 0
        : this.resourceLayersFromText(card, '炉温');
      if (gained > 0) this.addClassResource(state, 'furnace_heat', gained);
      else if (card.type === 'defense' || card.type === 'skill') {
        this.addClassResource(state, 'furnace_heat');
      }
      if (card.type === 'attack') {
        this.consumeClassResource(state, 'furnace_heat', 'all');
      }
    } else if (subclass === 'mechanic') {
      const hasStructuredGain = this.cardHasNestedEffect(
        card.effects ?? [],
        (effect) =>
          effect.type === 'gain_class_resource' &&
          this.classResourceKey(effect.resource) === 'parts',
      );
      const gained = hasStructuredGain
        ? 0
        : this.resourceLayersFromText(card, '零件');
      const used = this.resourceConsumptionFromText(card, '零件');
      if (gained > 0) this.addClassResource(state, 'parts', gained);
      else if (
        !hasStructuredGain &&
        !used &&
        (card.type === 'summon' || card.type === 'skill')
      ) {
        this.addClassResource(state, 'parts');
      }
      if (used) this.consumeClassResource(state, 'parts', used);
    } else if (subclass === 'vampire_hunter' && cardId === 'vh_force_moon') {
      if (!state.player.buffs.blood_moon) {
        this.addClassResource(state, 'hunter_prepare');
      }
    } else if (subclass === 'weapon_master') {
      if (cardId === 'wmst_stance_reset') {
        state.player.cardsPlayedThisTurn = {};
        state.player.cardNamesPlayedThisTurn = {};
      }
      if (card.type === 'attack') {
        const counts = (state.player.cardsPlayedThisTurn ??= {});
        counts[cardId] = (counts[cardId] ?? 0) + 1;
        this.spendEffectCharge(state.player.buffs, 'weapon_master_force_combo');
        this.spendEffectCharge(state.player.buffs, 'weapon_master_no_combo');
      }
    }
    if (cardId !== 'wmst_stance_reset') {
      if (!state.player.cardNamesPlayedThisTurn) {
        const migratedCounts: Record<string, number> = {};
        for (const [playedId, rawCount] of Object.entries(
          state.player.cardsPlayedThisTurn ?? {},
        )) {
          const playedName = this.cardDefinition(state, playedId)?.name;
          const count = Math.max(0, Math.floor(this.number(rawCount)));
          if (!playedName || count === 0) continue;
          const historyKey = cardNameHistoryKey(playedName);
          migratedCounts[historyKey] =
            (migratedCounts[historyKey] ?? 0) + count;
        }
        state.player.cardNamesPlayedThisTurn = migratedCounts;
      }
      const nameCounts = state.player.cardNamesPlayedThisTurn;
      const historyKey = cardNameHistoryKey(card.name);
      nameCounts[historyKey] = (nameCounts[historyKey] ?? 0) + 1;
    }
    state.player.lastCardId = cardId;
    state.player.lastCardType = card.type;
    state.player.lastCardName = card.name;
  }

  private cardHasNestedEffect(
    effects: CardEffect[],
    predicate: (effect: CardEffect) => boolean,
  ): boolean {
    return effects.some((effect) => {
      if (predicate(effect)) return true;
      return ['effects', 'then_effects', 'else_effects'].some((key) =>
        Array.isArray(effect[key])
          ? this.cardHasNestedEffect(effect[key] as CardEffect[], predicate)
          : false,
      );
    });
  }

  private cardElement(card: CardDefinition | undefined): string {
    if (!card) return '';
    const direct = String((card as CardDefinition & { element?: unknown }).element ?? '');
    if (direct) return direct;
    return String(card.effects?.find((effect) => effect.element)?.element ?? '');
  }

  private isPayableCondition(condition: CardEffect): boolean {
    return [
      'spend_mp',
      'spend_hp',
      'discard',
      'destroy_summon',
      'spend_workshop_resource',
    ].includes(condition.type);
  }

  private payCondition(state: LocalBattleState, condition: CardEffect): void {
    const requested = Math.max(
      1,
      this.number(condition.amount ?? condition.value, 1),
    );
    if (condition.type === 'spend_mp') {
      state.player.mp = Math.max(0, state.player.mp - requested);
    } else if (condition.type === 'spend_hp') {
      const spent = this.directHpLoss(
        state,
        state.player,
        requested,
        '支付生命',
        1,
      );
      this.log(state, 'player', `支付 ${spent} HP 作为卡牌效果代价`);
    } else if (condition.type === 'discard') {
      const discarded = this.takeDiscardableCards(state, requested);
      state.player.discardPile.push(...discarded);
    } else if (condition.type === 'destroy_summon') {
      const destroyed =
        condition.amount === 'all'
          ? [...state.player.summons]
          : this.shuffle(state.player.summons).slice(0, requested);
      this.removePlayerSummons(state, destroyed, '牺牲');
    } else if (condition.type === 'spend_workshop_resource') {
      const found = this.workshopResource(
        state,
        String(condition.mechanismId ?? ''),
        String(condition.resourceId ?? ''),
      );
      if (!found) return;
      this.changeWorkshopResource(
        state,
        found.manifest,
        found.definition.id,
        condition.amount === 'all' ? 'set' : 'add',
        condition.amount === 'all' ? found.definition.min : -requested,
      );
    }
  }

  private async finishBattle(
    session: BattleSessionRecord,
    status: 'victory' | 'defeat',
  ): Promise<void> {
    const state = session.state;
    state.status = status;
    state.phase = 'ended';
    this.runWorkshopMechanisms(
      state,
      status === 'victory' ? 'battle_victory' : 'battle_defeat',
    );
    if (state.workshopTest) {
      state.rewards = null;
      this.log(
        state,
        'system',
        status === 'victory'
          ? '测试木桩已全部击倒；本次测试不会发放奖励或修改正式角色。'
          : '测试角色已倒下；本次测试不会造成正式角色损失。',
      );
      await this.save(session);
      return;
    }
    const fullRewards = this.calculateRewards(state);
    if (status === 'victory' && state.huntingContext) {
      const animal = huntingAnimal(state.huntingContext.animalId);
      if (animal) {
        fullRewards.items.push(
          ...rollHuntingRewards(this.random, animal.primaryMaterialIds).map(
            (item) => ({
              id: item.itemId,
              name: item.name,
              quantity: item.quantity,
            }),
          ),
        );
      }
    }
    const rewards =
      status === 'victory'
        ? fullRewards
        : {
            experience: Math.round(fullRewards.experience * 0.3),
            gold: Math.round(fullRewards.gold * 0.3),
            guildExperience: Math.round(fullRewards.guildExperience * 0.3),
            items: [],
          };
    state.rewards = rewards;
    if (status === 'victory') {
      await this.advanceCombatCommissions(session.profileId, state);
    }
    const levelResult = await this.applyRewards(
      session.profileId,
      state,
      rewards,
      status,
    );
    if (status === 'victory') {
      state.rewardChoices = this.createRewardChoices(
        state,
        levelResult.levelsGained,
        levelResult.levelRewardId,
      );
      await this.syncBattleLevelRewardChoices(
        session.profileId,
        state.rewardChoices,
      );
    }
    this.log(
      state,
      status === 'victory' ? 'reward' : 'system',
      status === 'victory' ? '战斗胜利，奖励已结算' : '战斗失败，获得 30% 安慰奖励',
    );
    const now = Date.now();
    await this.db.battleRewards.put({
      id: `${session.id}:reward`,
      profileId: session.profileId,
      battleId: session.id,
      claimed: true,
      rewards,
      updatedAt: now,
    });
    await this.save(session);
  }

  private applyPreparedBattleEffects(
    state: LocalBattleState,
    rawEffects: unknown[],
  ): void {
    for (const rawEffect of rawEffects) {
      if (typeof rawEffect !== 'object' || rawEffect === null) continue;
      const effect = rawEffect as CardEffect;
      if (effect.type === 'next_battle_buff') {
        this.addTimedEffect(
          state.player.buffs,
          String(effect.buff ?? 'strength'),
          this.number(effect.value, 1),
          this.number(effect.turns, 1),
        );
      } else if (effect.type === 'next_battle_shield') {
        state.player.shield += this.number(effect.value);
      } else if (effect.type === 'next_battle_draw') {
        state.player.initialDraw += this.number(effect.value);
      } else if (effect.type === 'next_battle_ap') {
        state.player.ap += this.number(effect.value);
      }
    }
    if (rawEffects.length > 0) {
      this.log(state, 'system', `已应用 ${rawEffects.length} 项战前药剂效果`);
    }
  }

  private applyCarriedRelicEffects(
    state: LocalBattleState,
    relicIds: string[],
  ): void {
    for (const relicId of relicIds) {
      const relic = this.relics?.[relicId];
      if (!relic?.effect) continue;
      const effects =
        relic.effect.type === 'multi'
          ? childEffects(relic.effect)
          : [relic.effect];
      state.player.passiveEffects ??= [];
      state.player.passiveEffects.push(...effects);
      for (const effect of effects) {
        if (effect.type === 'battle_start_shield') {
          state.player.shield += this.number(effect.value);
        } else if (effect.type === 'battle_start_mp') {
          state.player.mp = Math.min(
            state.player.mpMax,
            state.player.mp + this.number(effect.value),
          );
        } else if (effect.type === 'battle_start_draw') {
          this.drawCards(state, this.number(effect.value));
        } else if (effect.type === 'extra_draw') {
          state.player.drawPerTurn += this.number(effect.value);
        } else if (effect.type === 'first_turn_ap') {
          state.player.ap += this.number(effect.value);
        }
      }
      this.log(state, 'system', `藏品「${relic.name}」生效`);
    }
  }

  private async applyBattleStartRelics(
    profileId: string,
    state: LocalBattleState,
    carriedRelicIds: string[],
  ): Promise<boolean> {
    const carried = new Set(carriedRelicIds);
    const alive = () => this.aliveEnemies(state);

    if (carried.has('special_reshaped_quill')) {
      const enemies = alive();
      const bosses = enemies.filter((enemy) => {
        const definition = this.monsters?.[enemy.definitionId];
        return definition ? this.isBossMonster(definition) : false;
      });
      if (bosses.length > 0) {
        const target = bosses
          .slice()
          .sort((left, right) => right.hpMax - left.hpMax)[0]!;
        const damage = Math.max(1, Math.ceil(target.hpMax * 0.3));
        target.hp = Math.max(0, target.hp - damage);
        this.log(
          state,
          'system',
          `重塑的羽毛笔落下星光，对首领 ${target.name} 造成 ${damage} 点伤害。`,
        );
        this.animation(state, {
          kind: 'damage',
          sourceSide: 'system',
          sourceId: 'special_reshaped_quill',
          targetSide: 'enemy',
          targetId: target.id,
          amount: damage,
          hpAfter: target.hp,
          label: '重塑的羽毛笔',
        });
      } else if (enemies.length >= 2) {
        const target = enemies
          .slice()
          .sort((left, right) => right.hp - left.hp)[0]!;
        const damage = target.hp;
        target.hp = 0;
        this.log(
          state,
          'system',
          `重塑的羽毛笔划开命运，秒杀了 ${target.name}。`,
        );
        this.animation(state, {
          kind: 'damage',
          sourceSide: 'system',
          sourceId: 'special_reshaped_quill',
          targetSide: 'enemy',
          targetId: target.id,
          amount: damage,
          hpAfter: 0,
          label: '重塑的羽毛笔',
        });
        state.selectedTarget = Math.max(
          0,
          state.enemies.findIndex((enemy) => enemy.hp > 0),
        );
      }
    }

    if (carried.has('special_golden_shovel')) {
      const enemies = alive();
      const hasBoss = state.enemies.some((enemy) => {
        const definition = this.monsters?.[enemy.definitionId];
        return definition ? this.isBossMonster(definition) : false;
      });
      if (hasBoss) {
        this.log(
          state,
          'system',
          '金铲子遇到首领怪物，没有触发。',
        );
      } else if (enemies.length > 0) {
        const key = 'battle.goldenShovelMisses';
        const id = `${profileId}:${key}`;
        const current = await this.db.achievementCounters.get(id);
        const misses = Math.max(
          0,
          Math.floor(this.number(current?.value)),
        );
        const definition = this.relics?.special_golden_shovel;
        const chance = this.clamp(
          this.number(definition?.effect?.chance, 0.1),
          0,
          1,
        );
        const pity = Math.max(
          1,
          Math.floor(this.number(definition?.effect?.pity, 10)),
        );
        const guaranteed = misses >= pity - 1;
        const hit = guaranteed || this.random() < chance;
        await this.db.achievementCounters.put({
          id,
          profileId,
          key,
          value: hit ? 0 : misses + 1,
          data: { lastTriggered: hit, guaranteed: hit && guaranteed },
          updatedAt: Date.now(),
        });
        if (hit) {
          for (const enemy of enemies) enemy.hp = 0;
          this.log(
            state,
            'system',
            guaranteed
              ? `金铲子积蓄的好运终于爆发，第 ${pity} 场战斗直接判定为胜利！`
              : '金铲子闪闪发光，战斗直接判定为胜利！',
          );
          this.animation(state, {
            kind: 'status',
            sourceSide: 'system',
            sourceId: 'special_golden_shovel',
            targetSide: 'enemy',
            label: '金铲子 · 直接胜利',
          });
        } else {
          this.log(
            state,
            'system',
            '金铲子轻轻一挥，但这次没有挖到胜利。',
          );
        }
      }
    }

    return alive().length === 0;
  }

  private calculateRewards(state: LocalBattleState): BattleRewards {
    const enemies = state.enemies;
    const baseExperience = enemies.reduce((sum, enemy) => sum + enemy.xp, 0);
    const baseGold = enemies.reduce((sum, enemy) => {
      const [min, max] = enemy.gold;
      return sum + Math.round(min + this.random() * Math.max(0, max - min));
    }, 0);
    const items = enemies.flatMap((enemy) =>
      enemy.loot
        .filter((item) => this.random() <= item.chance)
        .map((item) => ({ id: item.id, name: item.name, quantity: 1 })),
    );
    const experience = Math.round(
      baseExperience * (1 + this.passiveEffectValue(state, 'xp_bonus')),
    );
    const gold = Math.round(
      baseGold * (1 + this.passiveEffectValue(state, 'gold_bonus')),
    );
    return {
      experience,
      gold: gold * 5,
      guildExperience: Math.round(
        experience *
          0.35 *
          (1 + this.passiveEffectValue(state, 'guild_xp_bonus')),
      ),
      items,
    };
  }

  private async applyRewards(
    profileId: string,
    state: LocalBattleState,
    rewards: BattleRewards,
    status: 'victory' | 'defeat',
  ): Promise<{ levelsGained: number; levelRewardId?: string }> {
    const [player, guild] = await Promise.all([
      this.db.playerStates.get(profileId),
      this.db.guildStates.get(profileId),
    ]);
    if (!player) throw new Error('玩家档案不存在');
    player.hp =
      status === 'defeat'
        ? Math.max(1, Math.round(player.hpMax * 0.3))
        : this.clamp(state.player.hp, 1, state.player.hpMax);
    player.mp = this.clamp(state.player.mp, 0, state.player.mpMax);
    const levelBefore = player.level;
    const levelsGained = grantPlayerExperience(player, rewards.experience);
    player.gold = Math.max(0, state.player.gold ?? player.gold) + rewards.gold;
    player.updatedAt = Date.now();
    await this.db.playerStates.put(player);
    if (guild) {
      guild.experience += rewards.guildExperience;
      guild.updatedAt = Date.now();
      updateGuildRank(guild);
      await this.db.guildStates.put(guild);
    }
    for (const item of rewards.items) {
      const id = `${profileId}:${item.id}`;
      const existing = await this.db.inventoryStacks.get(id);
      await this.db.inventoryStacks.put({
        id,
        profileId,
        itemId: item.id,
        name: item.name,
        quantity: (existing?.quantity ?? 0) + item.quantity,
        updatedAt: Date.now(),
      });
    }
    return {
      levelsGained,
      levelRewardId:
        levelsGained > 0 ? `level-${levelBefore + 1}` : undefined,
    };
  }

  private createRewardChoices(
    state: LocalBattleState,
    levelsGained: number,
    levelRewardId?: string,
  ): NonNullable<LocalBattleState['rewardChoices']> {
    const subclass = state.player.subclass ?? '';
    const customProfession = readWorkshopPacks()
      .flatMap((pack) => pack.classes)
      .find((profession) => profession.id === subclass);
    const cardIds = customProfession
      ? this.shuffle([...new Set(customProfession.cardPool)]).slice(0, 3)
      : ['merchant', 'astrologer'].includes(subclass)
        ? []
        : this.shuffle(
            Object.entries(this.cards ?? {})
              .filter(
                ([, card]) =>
                  card.rarity !== 'legendary' &&
                  card.rewardable !== false &&
                  (card.cls === subclass || card.cat === 'common'),
              )
              .map(([id]) => id),
          ).slice(0, 3);
    const offerEquipment =
      levelsGained > 0 || state.difficulty === 'hard' || state.difficulty === 'hell';
    const equipmentIds = offerEquipment
      ? this.shuffle(Object.keys(this.equipment ?? {})).slice(0, levelsGained > 0 ? 5 : 3)
      : [];
    const relicIds =
      levelsGained > 0
        ? this.shuffle(
            Object.entries(this.relics ?? {})
              .filter(([, relic]) => relic.levelReward === true)
              .map(([id]) => id),
          ).slice(0, 3)
        : [];
    return {
      cardIds,
      equipmentIds,
      relicIds,
      cardClaimed: cardIds.length === 0,
      equipmentClaimed: equipmentIds.length === 0,
      relicClaimed: relicIds.length === 0,
      levelsGained,
      levelRewardId,
    };
  }

  private async syncBattleLevelRewardChoices(
    profileId: string,
    choices: NonNullable<LocalBattleState['rewardChoices']>,
  ): Promise<void> {
    if (!choices.levelRewardId) return;
    const player = await this.db.playerStates.get(profileId);
    const reward = player?.pendingLevelRewards?.find(
      (entry) => entry.id === choices.levelRewardId,
    );
    if (!player || !reward) return;
    reward.equipmentIds = [...choices.equipmentIds];
    reward.relicIds = [...choices.relicIds];
    reward.equipmentClaimed = choices.equipmentClaimed;
    reward.relicClaimed = choices.relicClaimed;
    player.pendingLevelRewards = player.pendingLevelRewards?.filter(
      (entry) => !entry.equipmentClaimed || !entry.relicClaimed,
    );
    player.updatedAt = Date.now();
    await this.db.playerStates.put(player);
  }

  private async syncClaimedLevelReward(
    profileId: string,
    choices: NonNullable<LocalBattleState['rewardChoices']>,
  ): Promise<void> {
    if (!choices.levelRewardId) return;
    const player = await this.db.playerStates.get(profileId);
    const reward = player?.pendingLevelRewards?.find(
      (entry) => entry.id === choices.levelRewardId,
    );
    if (!player || !reward) return;
    reward.equipmentClaimed = choices.equipmentClaimed;
    reward.relicClaimed = choices.relicClaimed;
    player.pendingLevelRewards = player.pendingLevelRewards?.filter(
      (entry) => !entry.equipmentClaimed || !entry.relicClaimed,
    );
    player.updatedAt = Date.now();
    await this.db.playerStates.put(player);
  }

  private async persistBattlePlayer(
    profileId: string,
    state: LocalBattleState,
  ): Promise<void> {
    const player = await this.db.playerStates.get(profileId);
    if (!player) throw new Error('玩家档案不存在');
    player.hp = this.clamp(state.player.hp, 1, state.player.hpMax);
    player.mp = this.clamp(state.player.mp, 0, state.player.mpMax);
    player.gold = Math.max(0, state.player.gold ?? player.gold);
    player.updatedAt = Date.now();
    await this.db.playerStates.put(player);
  }

  private async advanceCombatCommissions(
    profileId: string,
    state: LocalBattleState,
  ): Promise<void> {
    const defeatedNames = new Map<string, number>();
    for (const enemy of state.enemies.filter((entry) => entry.hp <= 0)) {
      for (const key of [enemy.definitionId, enemy.name]) {
        const normalized = key.replace(/[\s·・_\-—]+/g, '').toLowerCase();
        defeatedNames.set(normalized, (defeatedNames.get(normalized) ?? 0) + 1);
      }
    }
    const quests = await this.db.questRecords
      .where('profileId')
      .equals(profileId)
      .filter(
        (quest) =>
          quest.kind === 'commission' &&
          quest.status === 'active' &&
          quest.commissionType === 'combat',
      )
      .toArray();
    for (const quest of quests) {
      const target = (quest.commissionTarget ?? '')
        .replace(/[\s·・_\-—]+/g, '')
        .toLowerCase();
      const count = defeatedNames.get(target) ?? 0;
      if (count <= 0) continue;
      quest.currentStage = Math.min(
        quest.totalStages,
        quest.currentStage + count,
      );
      if (quest.currentStage >= quest.totalStages) quest.status = 'ready';
      quest.updatedAt = Date.now();
      await this.db.questRecords.put(quest);
    }
  }

  private initializeWorkshopMechanisms(
    state: LocalBattleState,
    subclass: string,
    additionalIds: string[] = [],
  ): void {
    const profession = state.workshopTest
      ? undefined
      : readWorkshopPacks()
          .flatMap((pack) => pack.classes)
          .find((entry) => entry.id === subclass);
    const ids = [
      ...new Set([...(profession?.mechanismIds ?? []), ...additionalIds]),
    ];
    if (!ids.length) return;
    const manifests = this.workshopMechanismCatalog(state).filter((entry) =>
      ids.includes(entry.id),
    );
    const resources: Record<string, number> = {};
    for (const manifest of manifests) {
      for (const resource of manifest.resources) {
        resources[`${manifest.id}:${resource.id}`] = resource.initial;
      }
    }
    state.workshopMechanisms = {
      ids: manifests.map((entry) => entry.id),
      resources,
      fired: [],
      disabled: [],
      errors: {},
    };
  }

  private workshopMechanismCatalog(
    state: LocalBattleState,
  ): WorkshopMechanismManifest[] {
    return [
      ...new Map(
        [
          ...readWorkshopMechanisms(),
          ...(state.workshopTest?.candidateMechanisms ?? []),
        ].map((entry) => [entry.id, entry]),
      ).values(),
    ];
  }

  private runWorkshopMechanisms(
    state: LocalBattleState,
    trigger: WorkshopMechanismTrigger,
    event: Record<string, unknown> = {},
    onlyManifestId?: string,
  ): Record<string, unknown> {
    const runtime = state.workshopMechanisms;
    if (!runtime?.ids.length || this.mechanismDepth >= 4) return event;
    if (this.mechanismDepth === 0) this.mechanismSteps = 0;
    this.mechanismDepth += 1;
    try {
      const manifests = this.workshopMechanismCatalog(state).filter(
        (entry) =>
          runtime.ids.includes(entry.id) &&
          (!onlyManifestId || entry.id === onlyManifestId),
      );
      const executions: Array<{
        manifest: WorkshopMechanismManifest;
        priority: number;
        rule?: WorkshopMechanismRule;
      }> = [];
      for (const manifest of manifests) {
        if (isWorkshopScriptMechanism(manifest)) {
          if ((manifest.triggers ?? []).includes(trigger)) {
            executions.push({
              manifest,
              priority: manifest.priority ?? 0,
            });
          }
          continue;
        }
        executions.push(
          ...manifest.rules
            .filter((rule) => rule.trigger === trigger)
            .map((rule) => ({
              manifest,
              priority: rule.priority,
              rule,
            })),
        );
      }
      executions.sort((left, right) => right.priority - left.priority);
      for (const { manifest, rule } of executions) {
        if (this.mechanismSteps >= 64) {
          this.log(state, 'system', '创意工坊机制达到单次执行上限，后续规则已停止。');
          break;
        }
        if (isWorkshopScriptMechanism(manifest)) {
          if (runtime.disabled?.includes(manifest.id)) continue;
          this.mechanismSteps += 1;
          try {
            const resources = this.mechanismResourceView(state, manifest);
            const rawResult = executeWorkshopScriptMechanism(manifest, {
              trigger,
              battle: this.workshopScriptBattleSnapshot(state),
              event: { ...event },
              resources,
              random: this.random(),
            });
            const result = normalizeWorkshopScriptResult(
              rawResult,
              manifest,
              trigger,
            );
            for (const [resourceId, value] of Object.entries(result.resources)) {
              this.changeWorkshopResource(
                state,
                manifest,
                resourceId,
                'set',
                value,
              );
            }
            Object.assign(event, result.event);
            for (const action of result.actions) {
              this.mechanismSteps += 1;
              if (this.mechanismSteps > 64) break;
              this.applyWorkshopMechanismAction(
                state,
                manifest,
                action,
                event,
                trigger,
              );
            }
          } catch (caught) {
            const errors = (runtime.errors ??= {});
            const errorCount = (errors[manifest.id] ?? 0) + 1;
            errors[manifest.id] = errorCount;
            const message = caught instanceof Error ? caught.message : String(caught);
            this.log(
              state,
              'system',
              `代码机制「${manifest.name}」执行失败：${message.slice(0, 160)}`,
            );
            if (errorCount >= 3) {
              const disabled = (runtime.disabled ??= []);
              if (!disabled.includes(manifest.id)) disabled.push(manifest.id);
              this.log(
                state,
                'system',
                `代码机制「${manifest.name}」已在本场战斗中停用。`,
              );
            }
          }
          continue;
        }
        if (!rule) continue;
        const firedKey =
          rule.once === 'battle'
            ? `${manifest.id}:${rule.id}:battle`
            : rule.once === 'turn'
              ? `${manifest.id}:${rule.id}:turn:${state.turn}`
              : '';
        if (firedKey && runtime.fired.includes(firedKey)) continue;
        const resources = this.mechanismResourceView(state, manifest);
        const context = { state, resources, event, random: this.random };
        if (!evaluateWorkshopCondition(rule.condition, context)) continue;
        if (firedKey) runtime.fired.push(firedKey);
        for (const action of rule.actions) {
          this.mechanismSteps += 1;
          if (this.mechanismSteps > 64) break;
          this.applyWorkshopMechanismAction(
            state,
            manifest,
            action,
            event,
            trigger,
          );
        }
      }
      if (runtime.fired.length > 300) {
        runtime.fired = runtime.fired.filter(
          (key) => !key.includes(':turn:') || key.endsWith(`:${state.turn}`),
        );
      }
    } finally {
      this.mechanismDepth -= 1;
    }
    return event;
  }

  private workshopScriptBattleSnapshot(
    state: LocalBattleState,
  ): WorkshopScriptBattleSnapshot {
    const cards = this.cardCatalogForState(state);
    const cardSnapshot = (cardId: string) => {
      const card = cards[cardId];
      return {
        id: cardId,
        name: card?.name ?? cardId,
        type: card?.type ?? '',
        cost: this.number(card?.cost),
        mpCost: this.number(card?.mpCost),
        tags: Array.isArray(card?.tags) ? card.tags.map(String) : [],
      };
    };
    return {
      turn: state.turn,
      phase: state.phase,
      selectedTarget: state.selectedTarget,
      player: {
        hp: state.player.hp,
        hpMax: state.player.hpMax,
        mp: state.player.mp,
        mpMax: state.player.mpMax,
        ap: state.player.ap,
        apMax: state.player.apMax,
        shield: state.player.shield,
        attack: state.player.attack,
        defense: state.player.defense,
        speed: state.player.speed,
        buffs: structuredClone(state.player.buffs),
        debuffs: structuredClone(state.player.debuffs),
        hand: state.player.hand.map((entry) => cardSnapshot(entry.cardId)),
        drawPileCount: state.player.drawPile.length,
        discardPileCount: state.player.discardPile.length,
        summons: structuredClone(state.player.summons),
      },
      enemies: state.enemies.map((enemy) => ({
        id: enemy.id,
        definitionId: enemy.definitionId,
        name: enemy.name,
        hp: enemy.hp,
        hpMax: enemy.hpMax,
        shield: enemy.shield,
        attack: enemy.attack,
        defense: enemy.defense,
        speed: enemy.speed,
        buffs: structuredClone(enemy.buffs),
        debuffs: structuredClone(enemy.debuffs),
        intent: structuredClone(enemy.intent),
      })),
    };
  }

  private mechanismResourceView(
    state: LocalBattleState,
    manifest: WorkshopMechanismManifest,
  ): Record<string, number> {
    const resources: Record<string, number> = {};
    for (const definition of manifest.resources) {
      resources[definition.id] =
        state.workshopMechanisms?.resources[
          `${manifest.id}:${definition.id}`
        ] ?? definition.initial;
    }
    return resources;
  }

  private changeWorkshopResource(
    state: LocalBattleState,
    manifest: WorkshopMechanismManifest,
    resourceId: string,
    mode: 'add' | 'set',
    value: number,
  ): number | undefined {
    const runtime = state.workshopMechanisms;
    const definition = manifest.resources.find(
      (entry) => entry.id === resourceId,
    );
    if (!runtime || !definition) return undefined;
    const key = `${manifest.id}:${definition.id}`;
    const before = runtime.resources[key] ?? definition.initial;
    const requested = mode === 'add' ? before + value : value;
    const after = this.clamp(requested, definition.min, definition.max);
    runtime.resources[key] = after;
    if (after === before) return after;
    this.log(state, 'system', `${definition.label}：${before} → ${after}`);
    this.runWorkshopMechanisms(
      state,
      'resource_changed',
      {
        before,
        after,
        delta: after - before,
        resource_id: definition.id,
      },
      manifest.id,
    );
    return after;
  }

  private workshopResource(
    state: LocalBattleState,
    mechanismId: string,
    resourceId: string,
  ):
    | {
        manifest: WorkshopMechanismManifest;
        definition: WorkshopMechanismResource;
        current: number;
      }
    | undefined {
    if (!state.workshopMechanisms?.ids.includes(mechanismId)) return undefined;
    const manifest = this.workshopMechanismCatalog(state).find(
      (entry) => entry.id === mechanismId,
    );
    const definition = manifest?.resources.find(
      (entry) => entry.id === resourceId,
    );
    if (!manifest || !definition) return undefined;
    return {
      manifest,
      definition,
      current:
        state.workshopMechanisms.resources[`${manifest.id}:${definition.id}`] ??
        definition.initial,
    };
  }

  private workshopStatusDefinition(
    state: LocalBattleState,
    mechanismId: string,
    statusId: string,
  ):
    | { manifest: WorkshopMechanismManifest; status: WorkshopMechanismStatus }
    | undefined {
    if (!state.workshopMechanisms?.ids.includes(mechanismId)) return undefined;
    const manifest = this.workshopMechanismCatalog(state).find(
      (entry) => entry.id === mechanismId,
    );
    const status = manifest?.statuses.find((entry) => entry.id === statusId);
    return manifest && status ? { manifest, status } : undefined;
  }

  private applyWorkshopTalentResourceChange(
    state: LocalBattleState,
    effect: CardEffect,
  ): void {
    const found = this.workshopResource(
      state,
      String(effect.mechanismId ?? ''),
      String(effect.resourceId ?? ''),
    );
    if (!found) {
      this.log(state, 'system', '职业天赋引用的自定义资源未启用。');
      return;
    }
    this.changeWorkshopResource(
      state,
      found.manifest,
      found.definition.id,
      effect.mode === 'set' ? 'set' : 'add',
      this.number(effect.value),
    );
  }

  private applyWorkshopTalentStatus(
    state: LocalBattleState,
    effect: CardEffect,
  ): void {
    const found = this.workshopStatusDefinition(
      state,
      String(effect.mechanismId ?? ''),
      String(effect.statusId ?? ''),
    );
    if (!found) {
      this.log(state, 'system', '职业天赋引用的自定义状态未启用。');
      return;
    }
    const targets: Combatant[] =
      effect.target === 'all_enemies'
        ? this.aliveEnemies(state)
        : effect.target === 'all_summons'
          ? [
              ...state.player.summons
                .map((summon) => this.normalizePlayerSummon(summon))
                .filter((summon) => summon.hp > 0),
              ...(state.companion?.summons.filter((summon) => summon.hp > 0) ?? []),
            ]
          : [state.player];
    const requestedTurns = this.number(effect.turns, -1);
    const turns = requestedTurns < 0
      ? -1
      : Math.max(1, Math.min(99, Math.round(requestedTurns)));
    for (const target of targets) {
      this.applyWorkshopStatus(
        state,
        found.manifest,
        found.status.id,
        target,
        Math.max(1, Math.round(this.number(effect.value, 1))),
        turns,
      );
    }
  }

  private applyWorkshopSummonTalentStatuses(
    state: LocalBattleState,
    summon: Combatant,
  ): void {
    for (const rawEffect of state.player.passiveEffects ?? []) {
      if (typeof rawEffect !== 'object' || rawEffect === null) continue;
      const effect = rawEffect as CardEffect;
      if (
        effect.type !== 'apply_workshop_status' ||
        effect.target !== 'all_summons'
      ) {
        continue;
      }
      const found = this.workshopStatusDefinition(
        state,
        String(effect.mechanismId ?? ''),
        String(effect.statusId ?? ''),
      );
      if (!found) continue;
      const requestedTurns = this.number(effect.turns, -1);
      this.applyWorkshopStatus(
        state,
        found.manifest,
        found.status.id,
        summon,
        Math.max(1, Math.round(this.number(effect.value, 1))),
        requestedTurns < 0
          ? -1
          : Math.max(1, Math.min(99, Math.round(requestedTurns))),
      );
    }
  }

  private workshopStatusEffects(
    state: LocalBattleState,
    target: Combatant,
    type: WorkshopMechanismStatusEffect['type'],
  ): Array<{ effect: WorkshopMechanismStatusEffect; stacks: number }> {
    const runtime = state.workshopMechanisms;
    if (!runtime) return [];
    return this.workshopMechanismCatalog(state)
      .filter((manifest) => runtime.ids.includes(manifest.id))
      .flatMap((manifest) =>
        manifest.statuses.flatMap((status) => {
          const key = workshopStatusKey(manifest.id, status.id);
          const timed =
            status.polarity === 'buff'
              ? target.buffs[key]
              : target.debuffs[key];
          if (!timed) return [];
          const stacks = Math.max(1, this.effectValue(timed));
          return status.effects
            .filter((effect) => effect.type === type)
            .map((effect) => ({ effect, stacks }));
        }),
      );
  }

  private workshopStatusEffectValue(
    state: LocalBattleState,
    target: Combatant,
    type: WorkshopMechanismStatusEffect['type'],
  ): number {
    return this.workshopStatusEffects(state, target, type).reduce(
      (sum, entry) => sum + entry.effect.value * entry.stacks,
      0,
    );
  }

  private applyWorkshopStatus(
    state: LocalBattleState,
    manifest: WorkshopMechanismManifest,
    statusId: string,
    target: Combatant,
    stacks: number,
    turns: number,
  ): boolean {
    const status = manifest.statuses.find((entry) => entry.id === statusId);
    if (!status) return false;
    const key = workshopStatusKey(manifest.id, status.id);
    const duration = turns < 0 ? '本场战斗' : `${turns} 回合`;
    if (status.polarity === 'debuff') {
      const applied = this.tryApplyDebuff(state, target, key, stacks, turns);
      if (applied) {
        this.log(
          state,
          'system',
          `${target.name ?? '目标'} 获得 Debuff「${status.label}」${stacks} 层，持续 ${duration}。`,
        );
      }
      return applied;
    }
    this.addTimedEffect(target.buffs, key, stacks, turns);
    this.log(
      state,
      'system',
      `${target.name ?? '目标'} 获得 Buff「${status.label}」${stacks} 层，持续 ${duration}。`,
    );
    return true;
  }

  private applyWorkshopMechanismAction(
    state: LocalBattleState,
    manifest: WorkshopMechanismManifest,
    action: WorkshopMechanismAction,
    event: Record<string, unknown>,
    trigger: WorkshopMechanismTrigger,
  ): void {
    const resources = this.mechanismResourceView(state, manifest);
    const context = { state, resources, event, random: this.random };
    const value = Math.max(
      -999_999,
      Math.min(999_999, evaluateWorkshopFormula(action.value, context)),
    );
    const amount = Math.max(0, Math.round(value));
    const turns = Math.max(
      1,
      Math.min(99, Math.round(evaluateWorkshopFormula(action.turns ?? 1, context))),
    );
    const label = `机制「${manifest.name}」`;

    if (action.type === 'resource_add' || action.type === 'resource_set') {
      this.changeWorkshopResource(
        state,
        manifest,
        action.resource ?? '',
        action.type === 'resource_add' ? 'add' : 'set',
        value,
      );
      return;
    }

    if (action.type === 'event_multiply') {
      if (trigger !== 'before_damage') return;
      event.amount = this.number(event.amount) * this.clamp(value, 0, 10);
      return;
    }
    if (action.type === 'event_cancel') {
      if (trigger === 'before_damage' || trigger === 'before_debuff') {
        event.cancel = true;
      }
      return;
    }

    const targets =
      action.target === 'all_summons'
        ? [
            ...state.player.summons
              .map((summon) => this.normalizePlayerSummon(summon))
              .filter((summon) => summon.hp > 0),
            ...(state.companion?.summons.filter((summon) => summon.hp > 0) ?? []),
          ]
        : action.target === 'all_enemies'
        ? this.aliveEnemies(state)
        : action.target === 'selected_enemy'
          ? [state.enemies[this.resolveTargetIndex(state, state.selectedTarget)]].filter(
              (entry): entry is BattleEnemyState => Boolean(entry),
            )
          : [state.player];

    if (action.type === 'damage') {
      for (const target of targets) {
        this.damage(
          state,
          state.player,
          target,
          amount,
          'player',
          label,
          target === state.player,
        );
      }
      return;
    }
    if (action.type === 'heal') {
      for (const target of targets) this.heal(state, target, amount, label);
      return;
    }
    if (action.type === 'shield') {
      for (const target of targets) target.shield += amount;
      this.log(state, 'player', `${label}赋予 ${amount} 点护盾。`);
      return;
    }
    if (action.type === 'draw') {
      this.drawCards(state, Math.min(10, amount));
      return;
    }
    if (action.type === 'gain_ap') {
      state.player.ap = Math.min(state.player.apMax + 10, state.player.ap + amount);
      this.log(state, 'player', `${label}恢复 ${amount} AP。`);
      return;
    }
    if (action.type === 'gain_mp') {
      this.restoreMp(state, amount, label);
      return;
    }
    if (action.type === 'apply_buff' || action.type === 'apply_debuff') {
      const status = action.status ?? (action.type === 'apply_buff' ? 'strength' : 'weak');
      for (const target of targets) {
        if (action.type === 'apply_buff') {
          this.addTimedEffect(target.buffs, status, Math.max(1, amount), turns);
        } else {
          this.tryApplyDebuff(
            state,
            target,
            status,
            Math.max(1, amount),
            turns,
          );
        }
      }
      this.log(state, 'system', `${label}施加 ${status}，持续 ${turns} 回合。`);
      return;
    }
    if (action.type === 'apply_status') {
      for (const target of targets) {
        this.applyWorkshopStatus(
          state,
          manifest,
          action.status ?? '',
          target,
          Math.max(1, amount),
          turns,
        );
      }
      return;
    }
    if (action.type === 'cleanse') {
      for (const target of targets) this.removeEffects(target.debuffs, amount || 1);
      return;
    }
    if (action.type === 'discard_random') {
      const discarded = this.takeDiscardableCards(state, amount, 'random');
      state.player.discardPile.push(...discarded);
      this.log(state, 'player', `${label}弃置 ${discarded.length} 张牌。`);
      return;
    }
    if (action.type === 'recover_discard') {
      const recovered = state.player.discardPile.splice(
        Math.max(0, state.player.discardPile.length - amount),
      );
      const room = Math.max(0, state.player.handLimit - state.player.hand.length);
      state.player.hand.push(...recovered.slice(0, room));
      state.player.discardPile.push(...recovered.slice(room));
      return;
    }
    if (action.type === 'log') {
      this.log(state, 'system', action.message ?? label);
    }
  }

  private async getOngoing(
    profileId: string,
    battleId: string,
  ): Promise<BattleSessionRecord> {
    const session = await this.db.battleSessions.get(battleId);
    if (
      !session ||
      session.profileId !== profileId ||
      !session.active ||
      session.state.status !== 'ongoing'
    ) {
      throw new Error('当前战斗不存在或已经结束');
    }
    for (const summon of session.state.player.summons) {
      this.normalizePlayerSummon(summon);
    }
    this.syncInheritedLifesteal(session.state);
    if (session.state.player.subclass !== 'dark_mage') {
      this.syncAbyssEcho(session.state);
    }
    return session;
  }

  private assertPlayerPhase(state: LocalBattleState): void {
    if (state.phase !== 'player') throw new Error('当前不是玩家行动阶段');
  }

  private assertNoPendingCardChoice(state: LocalBattleState): void {
    if (state.player.pendingCardChoice) {
      throw new Error('请先完成当前占星选牌');
    }
  }

  private astrologyChoices(requested: number): string[] {
    const pool = Object.entries(this.cards ?? {}).filter(
      ([, card]) =>
        card.cat !== 'sub_merchant' &&
        card.rewardable !== false &&
        card.unplayable !== true,
    );
    const choices: string[] = [];
    const count = Math.min(Math.max(1, Math.floor(requested)), pool.length);
    while (choices.length < count && pool.length > 0) {
      const picked = this.weightedChoice(pool, ([, card]) => {
        const rarity = String(card.rarity ?? 'common');
        return (
          {
            common: 60,
            uncommon: 32,
            rare: 14,
            epic: 5,
            legendary: 1,
          }[rarity] ?? 20
        );
      });
      if (!picked) break;
      choices.push(picked[0]);
      pool.splice(pool.indexOf(picked), 1);
    }
    return choices;
  }

  private async save(session: BattleSessionRecord): Promise<void> {
    session.turn = session.state.turn;
    session.phase = session.state.phase;
    session.updatedAt = Date.now();
    await this.db.battleSessions.put(session);
  }

  private resolveTargetIndex(state: LocalBattleState, desired: number): number {
    if (state.enemies[desired]?.hp && state.enemies[desired]!.hp > 0) {
      return desired;
    }
    return Math.max(
      0,
      state.enemies.findIndex((enemy) => enemy.hp > 0),
    );
  }

  private aliveEnemies(state: LocalBattleState): BattleEnemyState[] {
    return state.enemies.filter((enemy) => enemy.hp > 0);
  }

  private enemyTeamTargets(
    state: LocalBattleState,
    actor: BattleEnemyState,
    effect: CardEffect,
  ): BattleEnemyState[] {
    return effect.target === 'all_enemies' || effect.target === 'enemy_team'
      ? this.aliveEnemies(state)
      : [actor];
  }

  private enemyTurnOrder(state: LocalBattleState): BattleEnemyState[] {
    return [...this.aliveEnemies(state)].sort((left, right) => {
      const priority = (enemy: BattleEnemyState): number => {
        const skill = enemy.intent
          ? this.monsters?.[enemy.definitionId]?.skills?.[enemy.intent.skillId]
          : undefined;
        if (skill?.effects?.some((effect) => effect.type === 'cleanse')) {
          return 0;
        }
        if (
          skill?.effects?.some(
            (effect) =>
              effect.target === 'all_enemies' ||
              effect.target === 'enemy_team',
          )
        ) {
          return 1;
        }
        return 2;
      };
      return priority(left) - priority(right);
    });
  }

  private enemyEffectAmount(
    enemy: BattleEnemyState,
    effect: CardEffect,
  ): number {
    return Math.max(
      0,
      Math.round(
        this.number(effect.value) +
          enemy.attack * this.number(effect.attack_ratio) +
          enemy.defense * this.number(effect.defense_ratio) +
          enemy.attack * (this.rules?.enemyAttackScale ?? 0.48),
      ),
    );
  }

  private intentKind(skill: MonsterSkillDefinition): string {
    const effects = skill.effects ?? [];
    if (effects.some((effect) => effect.type === 'cleanse')) return '净化';
    if (
      effects.some(
        (effect) =>
          effect.target === 'all_enemies' || effect.target === 'enemy_team',
      )
    ) {
      return '支援';
    }
    const type = effects[0]?.type;
    if (type === 'damage') return '攻击';
    if (type === 'shield') return '防御';
    if (type === 'buff' || type === 'apply_buff') return '强化';
    if (type === 'heal') return '治疗';
    return '特殊';
  }

  private addTimedEffect(
    target: Record<string, BattleTimedEffect>,
    key: string,
    value: number,
    turns: number,
    options: Pick<
      BattleTimedEffect,
      'charges' | 'undispellable' | 'uncleanseable' | 'debuff'
    > = {},
  ): void {
    const existing = target[key];
    if (
      existing &&
      (key === 'defense_reflect' || key === 'counterattack')
    ) {
      const previous = this.timedEffectInstances(existing)[0];
      const addedTurns = turns < 0 ? -1 : Math.max(1, turns);
      const mergedTurns =
        previous?.turns === -1 || addedTurns === -1
          ? -1
          : Math.max(1, this.number(existing.turns, 1) + addedTurns);
      this.rebuildTimedEffect(target, key, [
        {
          value: 1,
          turns: mergedTurns,
          ...(previous?.fresh ? { fresh: true } : {}),
          ...(options.undispellable ? { undispellable: true } : {}),
        },
      ]);
      return;
    }
    const instances = existing
      ? this.timedEffectInstances(existing)
      : [];
    instances.push({
      value: Math.max(0, value),
      turns: turns < 0 ? -1 : Math.max(1, turns),
      ...(options.charges !== undefined
        ? { charges: Math.max(0, options.charges) }
        : {}),
      ...(options.undispellable ? { undispellable: true } : {}),
      ...(options.uncleanseable ? { uncleanseable: true } : {}),
      ...(options.debuff !== undefined ? { debuff: options.debuff } : {}),
      fresh: true,
    });
    this.rebuildTimedEffect(target, key, instances);
  }

  private tryApplyDebuff(
    state: LocalBattleState,
    target: Combatant,
    key: string,
    value: number,
    turns: number,
    options: Pick<
      BattleTimedEffect,
      'charges' | 'undispellable' | 'uncleanseable' | 'debuff'
    > = {},
  ): boolean {
    const identity = this.combatantIdentity(state, target);
    const event = this.runWorkshopMechanisms(state, 'before_debuff', {
      status: key,
      target_side: identity.side,
      target_id: identity.id,
      target_is_player: identity.side === 'player' ? 1 : 0,
      target_is_enemy: identity.side === 'enemy' ? 1 : 0,
      target_is_summon: identity.side === 'summon' ? 1 : 0,
    });
    if (
      event.cancel === true ||
      this.workshopStatusEffectValue(state, target, 'debuff_immunity') > 0
    ) {
      this.log(
        state,
        'system',
        `${target.name ?? '目标'} 的自定义 Buff 免疫了 ${key}`,
      );
      return false;
    }
    this.addTimedEffect(target.debuffs, key, value, turns, options);
    return true;
  }

  private spendEffectCharge(
    effects: Record<string, BattleTimedEffect>,
    key: string,
  ): void {
    const effect = effects[key];
    if (!effect || effect.charges === undefined) return;
    const instances = this.timedEffectInstances(effect);
    const charged = instances.find(
      (instance) => instance.charges !== undefined,
    );
    if (!charged) return;
    charged.charges = this.number(charged.charges) - 1;
    this.rebuildTimedEffect(effects, key, instances);
  }

  private timedEffectInstances(
    effect: BattleTimedEffect,
  ): BattleTimedEffectInstance[] {
    if (Array.isArray(effect.instances) && effect.instances.length > 0) {
      return effect.instances.map((instance) => ({ ...instance }));
    }
    // Older Alpha saves only persisted the aggregate shape. Blood burn also
    // stored a numeric stack count, so distribute the aggregate value across
    // those synthetic instances while preserving the exact total.
    const count = Math.max(1, Math.floor(this.number(effect.stacks, 1)));
    const value = this.number(effect.value) / count;
    return Array.from({ length: count }, (_, index) => ({
      value,
      turns: this.number(effect.turns, 1),
      ...(index === 0 && effect.charges !== undefined
        ? { charges: this.number(effect.charges) }
        : {}),
      ...(effect.debuff !== undefined ? { debuff: effect.debuff } : {}),
      ...(effect.fresh ? { fresh: true } : {}),
      ...(effect.undispellable ? { undispellable: true } : {}),
      ...(effect.uncleanseable ? { uncleanseable: true } : {}),
    }));
  }

  private rebuildTimedEffect(
    effects: Record<string, BattleTimedEffect>,
    key: string,
    rawInstances: BattleTimedEffectInstance[],
  ): BattleTimedEffect | undefined {
    const instances = rawInstances.filter((instance) => {
      if (instance.charges !== undefined && instance.charges <= 0) return false;
      return instance.turns < 0 || instance.turns > 0;
    });
    if (instances.length === 0) {
      delete effects[key];
      return undefined;
    }
    const timedTurns = instances
      .map((instance) => instance.turns)
      .filter((turns) => turns >= 0);
    const charged = instances.filter(
      (instance) => instance.charges !== undefined,
    );
    const rebuilt: BattleTimedEffect = {
      value: instances.reduce(
        (sum, instance) => sum + this.number(instance.value),
        0,
      ),
      turns:
        timedTurns.length > 0
          ? Math.max(...timedTurns)
          : -1,
      stacks: instances.length,
      instances,
      ...(charged.length > 0
        ? {
            charges: charged.reduce(
              (sum, instance) => sum + this.number(instance.charges),
              0,
            ),
          }
        : {}),
      ...(instances.some((instance) => instance.fresh)
        ? { fresh: true }
        : {}),
      ...(instances.some((instance) => instance.undispellable)
        ? { undispellable: true }
        : {}),
      ...(instances.some((instance) => instance.uncleanseable)
        ? { uncleanseable: true }
        : {}),
    };
    const debuff = instances.find(
      (instance) => instance.debuff !== undefined,
    )?.debuff;
    if (debuff !== undefined) rebuilt.debuff = debuff;
    effects[key] = rebuilt;
    return rebuilt;
  }

  private mutateTimedEffect(
    effects: Record<string, BattleTimedEffect>,
    key: string,
    mutate: (instance: BattleTimedEffectInstance) => void,
  ): BattleTimedEffect | undefined {
    const effect = effects[key];
    if (!effect) return undefined;
    const instances = this.timedEffectInstances(effect);
    for (const instance of instances) mutate(instance);
    return this.rebuildTimedEffect(effects, key, instances);
  }

  private triggerBloodBurnAction(
    state: LocalBattleState,
    target: Combatant,
    actionLabel: string,
    action: BloodBurnAction | null = bloodBurnAction(target),
  ): void {
    if (!action) return;
    for (let stack = 1; stack <= action.stacks && target.hp > 1; stack += 1) {
      this.directHpLoss(
        state,
        target,
        action.amountPerStack,
        `烧血·${actionLabel}（${stack}/${action.stacks}）`,
        1,
      );
    }
  }

  private triggerTrap(state: LocalBattleState, enemy: BattleEnemyState): boolean {
    const trap = enemy.debuffs.trap;
    if (!trap) return false;
    const amount = Math.max(1, Math.round(this.effectValue(trap)));
    delete enemy.debuffs.trap;
    this.directHpLoss(state, enemy, amount, '陷阱');
    return enemy.hp <= 0;
  }

  private applyOnHitResponses(
    state: LocalBattleState,
    enemy: BattleEnemyState,
    target: Combatant,
  ): void {
    const onHitDraw = target === state.player ? state.player.buffs.on_hit_draw : undefined;
    if (onHitDraw) {
      const requested = Math.max(1, Math.round(this.effectValue(onHitDraw)));
      const before = state.player.hand.length;
      this.drawCards(state, requested);
      const drawn = state.player.hand.length - before;
      if (drawn > 0) this.log(state, 'system', `受击抽牌：抽取 ${drawn} 张牌`);
      this.spendEffectCharge(state.player.buffs, 'on_hit_draw');
    }

    const thornsDebuff = target.buffs.thorns_debuff;
    if (!thornsDebuff || enemy.hp <= 0) return;
    const key = thornsDebuff.debuff ?? 'weak';
    const value = Math.max(1, this.effectValue(thornsDebuff));
    this.tryApplyDebuff(
      state,
      enemy,
      key,
      value,
      Math.max(1, thornsDebuff.turns),
    );
    this.log(state, 'player', `荆棘反制：${enemy.name} 获得 ${key} ${value}`);
  }

  private directHpLoss(
    state: LocalBattleState,
    target: Combatant,
    rawAmount: number,
    label: string,
    minimumHp = 0,
  ): number {
    const amount = Math.max(0, Math.round(rawAmount));
    if (amount <= 0 || target.hp <= 0) return 0;
    const invincibleFloor = Math.max(
      minimumHp,
      state.workshopTest?.playerInvincible && target === state.player
        ? 1
        : state.workshopTest?.dummyInvincible && target !== state.player
          ? 1
          : 0,
    );
    const before = target.hp;
    target.hp = Math.max(invincibleFloor, target.hp - amount);
    const actual = before - target.hp;
    if (actual <= 0) return 0;
    this.recordAbyssEchoLoss(state, target);
    const targetIdentity = this.combatantIdentity(state, target);
    const targetIsFriendly = targetIdentity.side !== 'enemy';
    this.animation(state, {
      kind: 'damage',
      sourceSide: targetIsFriendly ? 'enemy' : 'player',
      sourceId: label,
      targetSide: targetIdentity.side,
      targetId: targetIdentity.id,
      amount: actual,
      hpAfter: target.hp,
      shieldAfter: target.shield,
      label,
    });
    this.log(
      state,
      targetIsFriendly ? 'enemy' : 'player',
      `${target.name}因${label}失去 ${actual} 点生命`,
    );
    this.stabilizeWorkshopTest(state);
    this.stabilizePlayerSummons(state);
    this.stabilizeCompanion(state);
    return actual;
  }

  private applyConsumableEffect(
    state: LocalBattleState,
    label: string,
    effect: CardEffect,
    targetIndex: number,
  ): void {
    switch (effect.type) {
      case 'heal':
        this.heal(state, state.player, this.number(effect.value), label);
        return;
      case 'gain_mp':
        this.restoreMp(state, this.number(effect.value), label);
        return;
      case 'heal_mp':
        this.heal(state, state.player, this.number(effect.heal), label);
        this.restoreMp(state, this.number(effect.mp), label);
        return;
      case 'buff': {
        const buff = String(effect.buff ?? 'strength');
        const value = this.number(effect.value, 1);
        const turns = Math.max(1, this.number(effect.turns, 1));
        this.addTimedEffect(state.player.buffs, buff, value, turns, {
          charges: this.optionalPositiveNumber(effect.charges),
          undispellable: effect.undispellable === true,
        });
        this.animation(state, {
          kind: 'status',
          sourceSide: 'player',
          sourceId: 'player',
          targetSide: 'player',
          targetId: 'player',
          amount: value,
          label: buff,
        });
        this.log(state, 'player', `${label}赋予 ${buff} ${value}，持续 ${turns} 回合`);
        return;
      }
      case 'cleanse_specific': {
        const debuff = String(effect.debuff ?? '');
        if (debuff && state.player.debuffs[debuff]) {
          delete state.player.debuffs[debuff];
          this.animation(state, {
            kind: 'status',
            sourceSide: 'player',
            sourceId: 'player',
            targetSide: 'player',
            targetId: 'player',
            label: `解除 ${debuff}`,
          });
          this.log(state, 'player', `${label}解除了 ${debuff}`);
        }
        return;
      }
      case 'cleanse': {
        const removed = this.removeEffects(
          state.player.debuffs,
          effect.amount ?? 'all',
        );
        this.animation(state, {
          kind: 'status',
          sourceSide: 'player',
          sourceId: 'player',
          targetSide: 'player',
          targetId: 'player',
          amount: removed,
          label: '净化',
        });
        this.log(state, 'player', `${label}净化了 ${removed} 个负面状态`);
        return;
      }
      case 'shield': {
        const amount = Math.max(0, Math.round(this.number(effect.value)));
        state.player.shield += amount;
        this.animation(state, {
          kind: 'shield',
          sourceSide: 'player',
          sourceId: 'player',
          targetSide: 'player',
          targetId: 'player',
          amount,
          shieldAfter: state.player.shield,
          label,
        });
        this.log(state, 'player', `${label}获得 ${amount} 点护盾`);
        return;
      }
      case 'damage': {
        const resolved = this.resolveTargetIndex(state, targetIndex);
        const target = state.enemies[resolved];
        if (target) {
          state.selectedTarget = resolved;
          this.damage(
            state,
            state.player,
            target,
            this.number(effect.value),
            'player',
            label,
            true,
          );
        }
        return;
      }
      case 'multi':
        for (const child of childEffects(effect)) {
          if (
            canApplyBattleConsumable(child, {
              player: state.player,
              hasLivingEnemy: this.aliveEnemies(state).length > 0,
            })
          ) {
            this.applyConsumableEffect(state, label, child, targetIndex);
          }
        }
    }
  }

  private restoreMp(
    state: LocalBattleState,
    rawAmount: number,
    label: string,
  ): number {
    const amount = Math.max(0, Math.round(rawAmount));
    const before = state.player.mp;
    state.player.mp = Math.min(state.player.mpMax, state.player.mp + amount);
    const restored = state.player.mp - before;
    if (restored > 0) {
      this.animation(state, {
        kind: 'mp',
        sourceSide: 'player',
        sourceId: 'player',
        targetSide: 'player',
        targetId: 'player',
        amount: restored,
        mpAfter: state.player.mp,
        label,
      });
      this.log(state, 'player', `${label}恢复 ${restored} MP`);
    }
    return restored;
  }

  private removeEffects(
    effects: Record<string, BattleTimedEffect>,
    amount: unknown,
  ): number {
    let remaining =
      amount === 'all'
        ? Number.POSITIVE_INFINITY
        : Math.max(1, this.number(amount, 1));
    let removed = 0;
    for (const key of Object.keys(effects)) {
      if (remaining <= 0) break;
      const kept: BattleTimedEffectInstance[] = [];
      for (const instance of this.timedEffectInstances(effects[key]!)) {
        const protectedLayer =
          instance.undispellable === true ||
          instance.uncleanseable === true;
        if (!protectedLayer && remaining > 0) {
          removed += 1;
          remaining -= 1;
        } else {
          kept.push(instance);
        }
      }
      this.rebuildTimedEffect(effects, key, kept);
    }
    return removed;
  }

  private activeEffectCount(
    effects: Record<string, BattleTimedEffect>,
  ): number {
    return Object.values(effects).reduce(
      (total, effect) => total + this.timedEffectInstances(effect).length,
      0,
    );
  }

  private effectValue(effect?: BattleTimedEffect): number {
    return effect?.value ?? 0;
  }

  private combatantIdentity(
    state: LocalBattleState,
    combatant: Combatant,
  ): { side: 'player' | 'companion' | 'summon' | 'enemy'; id: string } {
    if (combatant === state.player) {
      return { side: 'player', id: 'player' };
    }
    if (combatant === state.companion) {
      return { side: 'companion', id: 'caelian' };
    }
    const playerSummon = state.player.summons.find(
      (entry) => entry === combatant,
    );
    if (playerSummon) return { side: 'summon', id: playerSummon.id };
    const summon = state.companion?.summons.find(
      (entry) => entry === combatant,
    );
    if (summon) return { side: 'summon', id: summon.id };
    const enemy = state.enemies.find((entry) => entry === combatant);
    return {
      side: 'enemy',
      id: enemy?.id ?? 'unknown-enemy',
    };
  }

  private animation(
    state: LocalBattleState,
    event: Omit<BattleAnimationEvent, 'id' | 'turn'>,
  ): void {
    const animations = (state.animations ??= []);
    animations.push({
      id: `${Date.now()}:${state.turn}:${this.animationSequence++}`,
      turn: state.turn,
      ...event,
    });
    if (animations.length > 160) {
      animations.splice(0, animations.length - 160);
    }
  }

  private log(
    state: LocalBattleState,
    kind: BattleLogEntry['kind'],
    text: string,
  ): void {
    state.log.push({
      id: `${Date.now()}:${state.log.length}:${Math.floor(this.random() * 1_000_000)}`,
      turn: state.turn,
      kind,
      text,
    });
    if (state.log.length > 80) state.log.splice(0, state.log.length - 80);
  }

  private weightedChoice<T>(
    values: T[],
    weightOf: (value: T) => number,
  ): T | undefined {
    const total = values.reduce((sum, value) => sum + weightOf(value), 0);
    if (total <= 0) return values[0];
    let cursor = this.random() * total;
    for (const value of values) {
      cursor -= weightOf(value);
      if (cursor <= 0) return value;
    }
    return values.at(-1);
  }

  private shuffle<T>(values: T[]): T[] {
    for (let index = values.length - 1; index > 0; index -= 1) {
      const target = Math.floor(this.random() * (index + 1));
      [values[index], values[target]] = [values[target]!, values[index]!];
    }
    return values;
  }

  private number(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback;
  }

  private optionalPositiveNumber(value: unknown): number | undefined {
    const parsed = this.number(value);
    return parsed > 0 ? parsed : undefined;
  }

  private clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
  }

  private assertPrepared(): void {
    if (
      !this.cards ||
      !this.monsters ||
      !this.rules ||
      !this.passives ||
      !this.battleItems ||
      !this.relics ||
      !this.equipment
    ) {
      throw new Error('战斗内容尚未加载');
    }
  }
}
