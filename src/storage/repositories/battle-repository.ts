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
import { loadCardCatalog } from '@/content/catalogs/cards';
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
import { createCaelianCompanion } from '@/battle/caelian-companion';
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
  BattleTimedEffect,
  LocalBattleState,
  PlayerRecord,
} from '@/domain/types';
import type { CaelianDatabase } from '@/storage/database';
import { grantPlayerExperience } from '@/player/progression';
import { updateGuildRank } from '@/guild-progression';
import { readWorkshopPacks, workshopPassiveId } from '@/workshop';
import {
  evaluateWorkshopCondition,
  evaluateWorkshopFormula,
  isWorkshopScriptMechanism,
  normalizeWorkshopScriptResult,
  readWorkshopMechanisms,
  type WorkshopMechanismAction,
  type WorkshopMechanismManifest,
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
  buffs: Record<string, BattleTimedEffect>;
  debuffs: Record<string, BattleTimedEffect>;
  onHitDebuff?: string;
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
}

interface WorkshopTestInput {
  professionId: string;
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
  private activeMechanismCard?: {
    id: string;
    name: string;
    type: string;
    tags: string[];
  };

  constructor(
    private readonly db: CaelianDatabase,
    private readonly random: () => number = Math.random,
  ) {}

  async prepare(): Promise<void> {
    if (
      this.cards &&
      this.monsters &&
      this.rules &&
      this.passives &&
      this.battleItems &&
      this.relics &&
      this.equipment
    ) {
      return;
    }
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
    if (readWorkshopMechanisms().some(isWorkshopScriptMechanism)) {
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
      workshopTest?: WorkshopTestInput;
    },
  ): Promise<void> {
    this.assertPrepared();
    await this.prepareInstalledWorkshopScripts();
    const existing = await this.db.battleSessions
      .where('profileId')
      .equals(profileId)
      .filter((session) => session.active)
      .first();
    if (existing) {
      throw new Error('请先结束或关闭当前战斗');
    }

    const [
      player,
      deck,
      loadout,
      equipment,
      settings,
      ownedPassives,
      world,
      ownedRelics,
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
      ]);
    if (!player) throw new Error('玩家档案不存在');
    if (input.workshopTest) {
      await this.startWorkshopTest(profileId, player, input.workshopTest);
      return;
    }
    if (!deck || deck.cardIds.length === 0) {
      throw new Error('请先准备至少一张卡牌的出战牌组');
    }
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
    const enemies = Array.from({ length: enemyCount }, (_, index) =>
      this.makeEnemy(
        monsterId,
        monster,
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
        ? createCaelianCompanion(player.level, this.random)
        : undefined,
      enemies,
      rewards: null,
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
    this.runWorkshopMechanisms(state, 'battle_start');
    for (const enemy of enemies) {
      enemy.intent = this.chooseIntent(monster, enemy);
    }
    this.log(
      state,
      'system',
      `在${region}遭遇 ${enemyCount > 1 ? `${enemyCount} 只` : ''}${monster.name}。抽取 ${battlePlayer.hand.length} 张起始手牌。`,
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
        `${world?.location || region} · ${enemyCount > 1 ? '群体遭遇' : monster.name}`,
      storyTriggered: input.storyTriggered === true,
      relatedQuestId: input.relatedQuestId?.trim() || '',
      turn: state.turn,
      phase: state.phase,
      state,
      updatedAt: now,
    };
    await this.db.battleSessions.add(session);
    const specialVictory = this.applyBattleStartRelics(
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
    const cardInstance = state.player.hand[input.handIndex];
    if (!cardInstance) throw new Error('这张手牌已经不存在');
    const card = this.cards?.[cardInstance.cardId];
    if (!card) throw new Error('卡牌数据不存在');
    if (state.player.debuffs.freeze && !this.isCleanseCard(card)) {
      throw new Error('冰冻中：只能使用净化类卡牌');
    }
    if (state.player.debuffs.entangle && card.type === 'attack') {
      throw new Error('缠绕中：无法使用攻击类卡牌');
    }

    const targetIndex = this.resolveTargetIndex(
      state,
      input.targetIndex ?? state.selectedTarget,
    );
    const cardTags = Array.isArray(card.tags) ? card.tags.map(String) : [];
    this.activeMechanismCard = {
      id: cardInstance.cardId,
      name: card.name,
      type: card.type,
      tags: cardTags,
    };
    let cost = this.cardCost(card, state, targetIndex);
    let mpCost = Math.max(0, this.number(card.mpCost));
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

      state.player.ap -= cost;
      state.player.mp -= mpCost;
      state.selectedTarget = targetIndex;
      state.player.hand.splice(input.handIndex, 1);
      state.player.discardPile.push(cardInstance);
      this.log(state, 'player', `使用「${card.name}」`);
      const allyTargetId = input.allyTargetId ?? 'player';
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
      this.triggerBloodBurnAction(state, state.player, '打牌');
      if (state.player.hp <= 0) {
        await this.finishBattle(session, 'defeat');
        return;
      }
      this.applyCardEffects(
        state,
        card,
        targetIndex,
        allyTargetId,
      );
      this.updateClassResourcesAfterCard(state, card, cardInstance.cardId);
      this.recordBossMechanicCard(state, card.type);
      if (card.type === 'attack' && state.player.buffs.cost_reduction) {
        this.spendEffectCharge(state.player.buffs, 'cost_reduction');
      }
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

  async discardHand(profileId: string, battleId: string): Promise<void> {
    const session = await this.getOngoing(profileId, battleId);
    const state = session.state;
    this.assertPlayerPhase(state);
    if (state.player.ap < 1) throw new Error('弃牌重抽需要 1 点行动点');
    if (state.player.hand.length === 0) throw new Error('当前没有可弃置的手牌');
    const count = state.player.hand.length;
    state.player.ap -= 1;
    state.player.discardPile.push(...state.player.hand.splice(0));
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
    const [stack, player] = await Promise.all([
      this.db.inventoryStacks.get(stackId),
      this.db.playerStates.get(profileId),
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
    for (const effect of immediate) {
      if (effect.type === 'heal') {
        player.hp = Math.min(player.hpMax, player.hp + this.number(effect.value));
      } else if (effect.type === 'gain_mp') {
        player.mp = Math.min(player.mpMax, player.mp + this.number(effect.value));
      } else {
        player.hp = Math.min(player.hpMax, player.hp + this.number(effect.heal));
        player.mp = Math.min(player.mpMax, player.mp + this.number(effect.mp));
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
    this.runWorkshopMechanisms(state, 'turn_end');
    this.log(state, 'system', '结束玩家回合');

    this.resolveChants(state);
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

    if (state.workshopTest && !state.workshopTest.dummyAttackEnabled) {
      this.log(state, 'system', '测试木桩已设置为不主动攻击。');
    } else {
      for (const enemy of this.aliveEnemies(state)) {
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
    this.drawCards(state, state.player.drawPerTurn);
    this.runWorkshopMechanisms(state, 'turn_start');
    for (const enemy of this.aliveEnemies(state)) {
      const monster = this.monsters?.[enemy.definitionId];
      enemy.intent = monster ? this.chooseIntent(monster, enemy) : null;
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
    player.hp = session.state.player.hp;
    player.mp = session.state.player.mp;
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
          stats: Object.fromEntries(
            Object.entries(definition.stats).map(([key, value]) => [
              key,
              Math.round(value * (1 + (stars - 1) * 0.35)),
            ]),
          ),
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
    const profession = readWorkshopPacks()
      .flatMap((pack) => pack.classes)
      .find((entry) => entry.id === input.professionId);
    if (!profession) throw new Error('请选择一个已经保存到本地的自制职业');
    const deckIds = [...profession.starterDeck];
    if (!deckIds.length || deckIds.some((cardId) => !this.cards?.[cardId])) {
      throw new Error('该职业的测试牌组不完整，请重新校验并保存职业');
    }

    const attributeBudget = 99 * 8;
    const apCount = Math.max(0, Math.floor(input.attributes.actionPointsPerTurn));
    const apCost = Math.min(apCount, 6) * 2 + Math.max(0, apCount - 6) * 3;
    const attributeSpent =
      Math.max(0, Math.floor(input.attributes.hpMax)) +
      Math.max(0, Math.floor(input.attributes.mpMax)) +
      Math.max(0, Math.floor(input.attributes.attack)) +
      Math.max(0, Math.floor(input.attributes.defense)) +
      Math.max(0, Math.floor(input.attributes.speed)) +
      apCost;
    if (attributeSpent > attributeBudget) {
      throw new Error(`满级测试角色最多可分配 ${attributeBudget} 点属性`);
    }

    const requestedMechanisms = [
      ...new Set([...(profession.mechanismIds ?? []), ...input.mechanismIds]),
    ];
    const availableMechanisms = new Set(
      readWorkshopMechanisms().map((entry) => entry.id),
    );
    const missingMechanisms = requestedMechanisms.filter(
      (id) => !availableMechanisms.has(id),
    );
    if (missingMechanisms.length) {
      throw new Error(`缺少职业依赖的底层机制：${missingMechanisms.join('、')}`);
    }

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
      statPoints: attributeBudget - attributeSpent,
      gold: 0,
      pendingBattleEffects: [],
    };
    const battlePlayer = this.makePlayer(testPlayerRecord, deckIds, []);
    const dummyCount = this.clamp(Math.floor(input.dummyCount), 1, 8);
    const dummyHp = this.clamp(Math.floor(input.dummyHp), 1, 1_000_000);
    const dummyAttack = this.clamp(Math.floor(input.dummyAttack), 0, 100_000);
    const dummyDefense = this.clamp(Math.floor(input.dummyDefense), 0, 100_000);
    const enemies: BattleEnemyState[] = Array.from(
      { length: dummyCount },
      (_, index) => ({
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
      }),
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
    this.applyBattleStartPassives(state, [workshopPassiveId(profession.id)]);
    this.runWorkshopMechanisms(state, 'battle_start');
    this.log(
      state,
      'system',
      `创意工坊测试开始：Lv.100 ${profession.name}，${dummyCount} 个测试木桩。`,
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

  private makePlayer(
    player: PlayerRecord,
    cardIds: string[],
    equipment: Array<{ stats: Record<string, number> }>,
  ): BattlePlayerState {
    const bonus = equipment.reduce<Record<string, number>>((result, item) => {
      for (const [key, value] of Object.entries(item.stats)) {
        result[key] = (result[key] ?? 0) + this.number(value);
      }
      return result;
    }, {});
    const stat = (...keys: string[]) =>
      keys.reduce((sum, key) => sum + (bonus[key] ?? 0), 0);
    const hpMax = Math.max(1, player.hpMax + stat('hpMax', 'hp', '生命'));
    const mpMax = Math.max(0, player.mpMax + stat('mpMax', 'mp', '魔力'));
    const instances = this.shuffle(
      cardIds.map((cardId, index) => ({
        instanceId: `${cardId}:${index}:${Math.floor(this.random() * 1_000_000)}`,
        cardId,
      })),
    );
    return {
      name: player.name,
      subclass: player.subclass,
      hp: Math.min(hpMax, player.hp + stat('hp', '生命')),
      hpMax,
      mp: Math.min(mpMax, player.mp + stat('mp', '魔力')),
      mpMax,
      shield: 0,
      attack: Math.max(0, player.attack + stat('attack', '攻击')),
      defense: Math.max(0, player.defense + stat('defense', '防御')),
      speed: Math.max(0, player.speed + stat('speed', '速度')),
      ap: Math.max(
        1,
        player.actionPointsPerTurn + stat('actionPointsPerTurn', 'ap', '行动点'),
      ),
      apMax: Math.max(
        1,
        player.actionPointsPerTurn + stat('actionPointsPerTurn', 'ap', '行动点'),
      ),
      initialDraw: this.rules?.initialDraw ?? 5,
      drawPerTurn:
        (this.rules?.baseDrawPerTurn ?? 3) + stat('drawPerTurn', 'draw', '抽牌'),
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
  ): BattleIntent | null {
    const skills = Object.entries(monster.skills ?? {});
    if (skills.length === 0) return null;
    const chosen = this.weightedChoice(skills, ([, skill]) =>
      Math.max(1, this.number(skill.weight, 1)),
    );
    if (!chosen) return null;
    const [skillId, skill] = chosen;
    const damageEffect = skill.effects?.find((effect) => effect.type === 'damage');
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
      this.stabilizeCompanion(state);
      return;
    }
    this.log(state, 'enemy', `${enemy.name} 使用「${skill.name}」`);
    this.animation(state, {
      kind: 'enemy-action',
      sourceSide: 'enemy',
      sourceId: enemy.id,
      targetSide: friendlyIdentity.side,
      targetId: friendlyIdentity.id,
      label: skill.name,
    });
    for (const effect of skill.effects ?? []) {
      if (effect.type === 'damage') {
        if (this.triggerTrap(state, enemy)) break;
        const hits = Math.max(1, this.number(effect.hits, 1));
        for (let hit = 0; hit < hits; hit += 1) {
          const amount = Math.max(
            1,
            Math.round(this.enemyEffectAmount(enemy, effect) * (0.9 + this.random() * 0.24)),
          );
          this.damage(state, enemy, friendlyTarget, amount, 'enemy', enemy.name);
          if (friendlyTarget.hp <= 0) break;
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
        this.heal(
          state,
          enemy,
          this.enemyEffectAmount(enemy, effect),
          skill.name,
        );
      } else if (effect.type === 'shield') {
        const amount = this.enemyEffectAmount(enemy, effect);
        enemy.shield += amount;
        this.log(state, 'enemy', `${enemy.name} 获得 ${amount} 点护盾`);
        this.animation(state, {
          kind: 'shield',
          sourceSide: 'enemy',
          sourceId: enemy.id,
          targetSide: 'enemy',
          targetId: enemy.id,
          amount,
          shieldAfter: enemy.shield,
          label: '护盾',
        });
      } else if (effect.type === 'buff' || effect.type === 'apply_buff') {
        const effectName = String(effect.buff ?? 'strength');
        this.addTimedEffect(
          enemy.buffs,
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
          targetId: enemy.id,
          amount: this.number(effect.value),
          label: effectName,
        });
      } else if (effect.type === 'debuff' || effect.type === 'apply_debuff') {
        const effectName = String(effect.debuff ?? 'weak');
        this.addTimedEffect(
          friendlyTarget.debuffs,
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
    for (const effect of card.effects ?? []) {
      this.applyCardEffect(
        state,
        card,
        effect,
        targetIndex,
        bonus,
        multiplier,
        allyTargetId,
      );
      if (this.aliveEnemies(state).length === 0) break;
    }
    if (card.effects?.some((effect) => effect.type === 'damage')) {
      for (const key of [
        'empower',
        'next_attack_bonus',
        'spell_double',
        'poison_coat',
      ]) {
        this.spendEffectCharge(state.player.buffs, key);
      }
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
    const target = state.enemies[targetIndex];
    if (!target) return;
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
        for (const enemy of targets) {
          const base =
            this.number(effect.value) +
            (card.type === 'attack'
              ? Math.floor(
                  state.player.attack * (this.rules?.playerAttackScale ?? 0.35),
                )
              : 0) +
            bonus;
          const hits = Math.max(1, this.number(effect.hits, 1));
          for (let hit = 0; hit < hits; hit += 1) {
            totalDamage += this.damage(
              state,
              state.player,
              enemy,
              Math.max(0, Math.round(base * multiplier)),
              'player',
              card.name,
            );
          }
          if (state.player.buffs.poison_coat && enemy.hp > 0) {
            this.addTimedEffect(
              enemy.debuffs,
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
        break;
      }
      case 'shield': {
        const shieldBonus = this.passiveEffectValue(
          state,
          'shield_bonus',
        );
        const amount = Math.max(
          0,
          Math.round(this.number(effect.value) * (1 + shieldBonus)),
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
        for (const recipient of this.cardFriendlyTargets(
          state,
          effect.target,
          allyTargetId,
        )) {
          this.heal(state, recipient, this.number(effect.value), card.name);
        }
        break;
      }
      case 'heal_overflow_shield': {
        const amount = this.number(effect.value);
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
        this.drawCards(state, this.number(effect.value, 1));
        break;
      case 'gain_mp': {
        const before = state.player.mp;
        state.player.mp = Math.min(
          state.player.mpMax,
          state.player.mp + this.number(effect.value),
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
        state.player.classResources ??= {};
        state.player.classResources[resource] =
          (state.player.classResources[resource] ?? 0) +
          this.number(effect.value, 1);
        break;
      }
      case 'discard_last_drawn': {
        const amount = Math.min(
          state.player.hand.length,
          Math.max(1, this.number(effect.amount, 1)),
        );
        const discarded = state.player.hand.splice(-amount, amount);
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
        this.damage(
          state,
          state.player,
          state.player,
          this.number(effect.value),
          'player',
          card.name,
          true,
        );
        break;
      case 'apply_buff':
      case 'thorns': {
        const recipients =
          effect.target === 'enemy' || effect.target === 'all_enemies'
            ? targets
            : this.cardFriendlyTargets(state, effect.target, allyTargetId);
        for (const recipient of recipients) {
          const effectName = String(effect.buff ?? effect.type);
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
          effect.target === 'self' ? [state.player] : targets;
        for (const recipient of recipients) {
          const effectName = String(effect.debuff ?? 'weak');
          this.addTimedEffect(
            recipient.debuffs,
            effectName,
            this.number(effect.value, 1),
            this.number(effect.turns, 1),
            {
              charges: this.optionalPositiveNumber(effect.charges),
              uncleanseable: effect.uncleanseable === true,
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
          this.addTimedEffect(
            target.debuffs,
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
              removed * this.number(effect.value),
              card.name,
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
          delete recipient.debuffs[String(effect.debuff)];
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
            removed * this.number(effect.value),
            card.name,
          );
        }
        break;
      }
      case 'strip_shield': {
        const removed = target.shield;
        target.shield = 0;
        if (removed > 0) {
          this.animation(state, {
            kind: 'shield',
            sourceSide: 'player',
            targetSide: 'enemy',
            targetId: target.id,
            amount: -removed,
            shieldAfter: 0,
            label: '破盾',
          });
        }
        break;
      }
      case 'damage_per_debuff':
        for (const enemy of targets) {
          this.damage(
            state,
            state.player,
            enemy,
            Object.keys(enemy.debuffs).length * this.number(effect.value),
            'player',
            card.name,
          );
        }
        break;
      case 'damage_per_buff':
        this.damage(
          state,
          state.player,
          target,
          Object.keys(state.player.buffs).length * this.number(effect.value),
          'player',
          card.name,
        );
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
          this.addTimedEffect(
            enemy.debuffs,
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
        const amount = Math.min(
          state.player.hand.length,
          Math.max(0, this.number(effect.amount, 1)),
        );
        state.player.discardPile.push(...state.player.hand.splice(0, amount));
        break;
      }
      case 'discard_all_damage': {
        const discarded = state.player.hand.splice(0);
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
      case 'destroy_summon': {
        const requested =
          effect.amount === 'all'
            ? state.player.summons.length
            : Math.max(1, this.number(effect.amount, 1));
        const destroyed =
          effect.target === 'all_summons'
            ? state.player.summons.splice(0)
            : this.shuffle(state.player.summons).slice(0, requested);
        if (effect.target !== 'all_summons') {
          const destroyedIds = new Set(destroyed.map((summon) => summon.id));
          state.player.summons = state.player.summons.filter(
            (summon) => !destroyedIds.has(summon.id),
          );
        }
        this.log(state, 'player', `牺牲 ${destroyed.length} 个召唤物`);
        break;
      }
      case 'reveal_intent':
        this.log(state, 'player', '已洞察敌人的行动意图');
        break;
      case 'recover_discard':
      case 'recover_discard_summon': {
        const amount = Math.min(
          state.player.discardPile.length,
          Math.max(0, this.number(effect.amount, 1)),
        );
        for (let index = 0; index < amount; index += 1) {
          const recovered = state.player.discardPile.pop();
          if (recovered && state.player.hand.length < state.player.handLimit) {
            state.player.hand.push(recovered);
          }
        }
        break;
      }
      case 'chant':
        state.player.chants.push({
          id: `chant:${Date.now()}:${Math.floor(this.random() * 1_000_000)}`,
          name: card.name,
          turns: Math.max(1, this.number(effect.turns, 1)),
          effects: Array.isArray(effect.effects) ? effect.effects : [],
        });
        this.log(
          state,
          'player',
          `开始吟诵「${card.name}」（${this.number(effect.turns, 1)} 回合）`,
        );
        break;
      case 'reduce_chant': {
        const chant = state.player.chants[0];
        if (chant) chant.turns = Math.max(0, chant.turns - this.number(effect.value, 1));
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
        const stored = state.player.classResources?.[resource] ?? 0;
        const damage = stored * this.number(effect.value);
        for (const enemy of targets) {
          this.damage(state, state.player, enemy, damage, 'player', card.name);
        }
        if (effect.consume === 'all' && state.player.classResources) {
          state.player.classResources[resource] = 0;
        }
        break;
      }
      case 'gain_mp_per_class_resource': {
        const resource = this.classResourceKey(effect.resource);
        const stored = state.player.classResources?.[resource] ?? 0;
        this.restoreMp(state, stored * this.number(effect.value), card.name);
        break;
      }
      case 'consume_debuff_damage': {
        const debuff = String(effect.debuff ?? '');
        if (debuff && target.debuffs[debuff]) {
          delete target.debuffs[debuff];
          this.damage(
            state,
            state.player,
            target,
            this.number(effect.value),
            'player',
            card.name,
          );
        }
        break;
      }
      case 'debuff_catalyze': {
        const ratio = Math.max(0, this.number(effect.value_ratio, 1));
        const extraTurns = Math.max(0, this.number(effect.turns));
        let potency = 0;
        for (const debuff of Object.values(target.debuffs)) {
          potency += this.effectValue(debuff);
          debuff.turns += extraTurns;
        }
        if (potency > 0) {
          this.damage(
            state,
            state.player,
            target,
            Math.round(potency * ratio),
            'player',
            card.name,
            true,
          );
        }
        break;
      }
      case 'astrology_discover': {
        const amount = Math.max(
          1,
          this.number(effect.pick, this.number(effect.value, 1)),
        );
        this.drawCards(state, amount);
        this.log(state, 'player', `星图发现并保留了 ${amount} 张牌`);
        break;
      }
      case 'restore_mp_per_abyss_echo':
        this.restoreMp(
          state,
          (state.player.abyssEcho ?? 0) * this.number(effect.value),
          card.name,
        );
        break;
      case 'clear_abyss_echo':
        state.player.abyssEcho = 0;
        if (state.player.classResources) state.player.classResources.abyss_echo = 0;
        break;
      case 'gain_mp_per_chant':
        this.restoreMp(
          state,
          state.player.chants.length * this.number(effect.value),
          card.name,
        );
        break;
      case 'copy_chant': {
        const chant = state.player.chants[0];
        if (chant) {
          this.resolveChant(state, chant, this.number(effect.multiplier, 0.5));
        }
        break;
      }
      case 'recall_summon_mp': {
        const amount = Math.min(
          state.player.summons.length,
          Math.max(1, this.number(effect.amount, 1)),
        );
        const recalled = this.shuffle(state.player.summons).slice(0, amount);
        const ids = new Set(recalled.map((summon) => summon.id));
        state.player.summons = state.player.summons.filter(
          (summon) => !ids.has(summon.id),
        );
        this.restoreMp(
          state,
          Math.min(this.number(effect.max, 999), recalled.length),
          card.name,
        );
        state.player.summonsLost = (state.player.summonsLost ?? 0) + recalled.length;
        break;
      }
      case 'destroy_summon_damage_per': {
        const mechanicalOnly = Boolean(effect.mechanicalOnly);
        const candidates = state.player.summons.filter(
          (summon) =>
            !mechanicalOnly || /机|械|炮|傀儡|机械/i.test(`${summon.id}${summon.name}`),
        );
        const requested =
          effect.amount === 'all'
            ? candidates.length
            : Math.max(1, this.number(effect.amount, 1));
        const destroyed = candidates.slice(0, requested);
        const ids = new Set(destroyed.map((summon) => summon.id));
        state.player.summons = state.player.summons.filter(
          (summon) => !ids.has(summon.id),
        );
        const damage = destroyed.length * this.number(effect.value);
        for (const enemy of targets) {
          this.damage(state, state.player, enemy, damage, 'player', card.name);
        }
        state.player.summonsLost = (state.player.summonsLost ?? 0) + destroyed.length;
        break;
      }
      case 'consume_san':
        state.player.sanity = Math.max(
          0,
          (state.player.sanity ?? 100) - this.number(effect.value),
        );
        break;
      case 'restore_san':
        state.player.sanity = Math.min(
          100,
          (state.player.sanity ?? 100) + this.number(effect.value),
        );
        break;
      case 'sacrifice_all_san': {
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
        const cost = Math.max(
          50,
          Math.round(
            this.aliveEnemies(state).reduce((sum, enemy) => sum + enemy.hpMax, 0) *
              0.25,
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
        const lostGold = Math.round((state.player.gold ?? 0) * 0.2);
        state.player.gold = Math.max(0, (state.player.gold ?? 0) - lostGold);
        state.player.hp = Math.max(1, Math.round(state.player.hp * 0.5));
        state.status = 'surrendered';
        state.phase = 'ended';
        this.log(state, 'system', `商人脱身：保留一半生命并损失 ${lostGold} 金币`);
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
            0,
            1,
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
    let ignoreDefense = options.ignoreDefense === true;
    const sourceIdentity = this.combatantIdentity(state, source);
    const targetIdentity = this.combatantIdentity(state, target);
    const beforeDamage = this.runWorkshopMechanisms(state, 'before_damage', {
      amount: rawAmount,
      ignoreDefense,
      sourceSide: sourceIdentity.side,
      sourceId: sourceIdentity.id,
      targetSide: targetIdentity.side,
      targetId: targetIdentity.id,
      cardId: this.activeMechanismCard?.id ?? '',
      cardName: this.activeMechanismCard?.name ?? '',
      cardType: this.activeMechanismCard?.type ?? '',
      cardTags: this.activeMechanismCard?.tags ?? [],
    });
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
    if (source.buffs.blood_burn) {
      amount = Math.ceil(
        amount * (1 + Math.max(0, this.effectValue(source.buffs.blood_burn)) / 100),
      );
    }
    if (!options.ignoreWeak && source.debuffs.weak) amount = Math.floor(amount * 0.75);
    if (!options.ignoreStrength) amount += this.effectValue(source.buffs.strength);
    if (source.buffs.monster_frenzy) {
      amount = Math.ceil(
        amount *
          (1 + Math.max(0, this.effectValue(source.buffs.monster_frenzy)) / 100),
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
        this.effectValue(target.debuffs.abyss_mark) + Math.floor(amount * 0.08),
      );
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
    if (target === state.player && hpDamage > 0) {
      state.player.abyssEcho = (state.player.abyssEcho ?? 0) + 1;
      state.player.classResources ??= {};
      state.player.classResources.abyss_echo = state.player.abyssEcho;
    }
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
    if (source === state.player && target !== state.player && hpDamage > 0) {
      const lifesteal = Math.round(
        hpDamage * Math.max(0, this.passiveEffectValue(state, 'lifesteal_ratio')),
      );
      if (lifesteal > 0) {
        this.heal(state, state.player, lifesteal, '吸血', false);
      }
    }
    if (
      sourceIdentity.side === 'enemy' &&
      targetIdentity.side !== 'enemy' &&
      hpDamage > 0 &&
      source.onHitDebuff
    ) {
      this.addTimedEffect(target.debuffs, source.onHitDebuff, 1, 2, {
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
    this.stabilizeWorkshopTest(state);
    this.stabilizeCompanion(state);
    return hpDamage;
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
  ): Combatant[] {
    const companion = state.companion;
    if (effectTarget === 'all_allies') {
      return companion ? [state.player, companion] : [state.player];
    }
    return allyTargetId === 'caelian' && companion
      ? [companion]
      : [state.player];
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
    if (state.companion && !state.companion.injured && state.companion.hp > 0) {
      targets.push(state.companion);
    }
    for (const summon of state.companion?.summons ?? []) {
      if (summon.hp > 0) targets.push(summon);
    }
    return targets;
  }

  private chooseEnemyFriendlyTarget(state: LocalBattleState): Combatant {
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
    const existingIds = new Set(state.player.summons.map((summon) => summon.id));
    for (const summon of [...state.player.summons]) {
      const skills = summon.skills.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === 'object' && entry !== null,
      );
      const chosen = this.weightedChoice(skills, (skill) =>
        Math.max(1, this.number(skill.weight, 1)),
      );
      const targetIndex = this.resolveTargetIndex(state, state.selectedTarget);
      const target = state.enemies[targetIndex];
      if (chosen && target) {
        const effects = Array.isArray(chosen.effects)
          ? (chosen.effects as CardEffect[])
          : [];
        this.log(state, 'player', `${summon.name}发动「${String(chosen.name ?? '技能')}」`);
        const virtualCard: CardDefinition = {
          name: summon.name,
          type: 'summon',
          cost: 0,
          rarity: 'common',
          description: '',
          effects,
        };
        for (const effect of effects) {
          this.applyCardEffect(state, virtualCard, effect, targetIndex);
        }
      }
      summon.duration -= 1;
    }
    state.player.summons = state.player.summons.filter(
      (summon) => summon.duration > 0 && (summon.hp === null || summon.hp > 0),
    );
    for (const id of existingIds) {
      if (!state.player.summons.some((summon) => summon.id === id)) {
        this.runWorkshopMechanisms(state, 'summon_removed', { summonId: id });
      }
    }
  }

  private addSummon(state: LocalBattleState, effect: CardEffect): void {
    const name = String(effect.name ?? '召唤物');
    if (
      effect.unique_by_name &&
      state.player.summons.some((summon) => summon.name === name)
    ) {
      this.log(state, 'system', `${name} 已在场上`);
      return;
    }
    const hpRatio = this.number(effect.hp_ratio);
    state.player.summons.push({
      id: String(effect.id ?? `summon:${Date.now()}`),
      name,
      duration: Math.max(1, this.number(effect.duration, 3)),
      hp:
        hpRatio > 0
          ? Math.max(1, Math.round((state.player.hpMax * hpRatio) / 100))
          : null,
      skills: Array.isArray(effect.skills) ? effect.skills : [],
    });
    this.log(state, 'player', `召唤 ${name}`);
    this.runWorkshopMechanisms(state, 'summon_created', { summonName: name });
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
    const targetIndex = this.resolveTargetIndex(state, state.selectedTarget);
    const virtualCard: CardDefinition = {
      name: chant.name,
      type: 'skill',
      cost: 0,
      rarity: 'common',
      description: '',
      effects: chant.effects as CardEffect[],
    };
    this.log(state, 'player', `吟诵「${chant.name}」完成`);
    for (const rawEffect of chant.effects) {
      if (typeof rawEffect !== 'object' || rawEffect === null) continue;
      const effect = { ...(rawEffect as CardEffect) };
      if (typeof effect.value === 'number') effect.value *= multiplier;
      this.applyCardEffect(state, virtualCard, effect, targetIndex);
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
        this.addTimedEffect(boss.debuffs, 'vulnerable', 1, 1);
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
        this.addTimedEffect(state.player.debuffs, 'weak', 1, 1);
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
        this.addTimedEffect(boss.debuffs, 'vulnerable', 1, 1);
        this.log(state, 'system', '潮汐进入退潮相，女王暂时易伤。');
      }
    } else if (mechanic.id === 'dream_layers') {
      mechanic.phase += 1;
      if (mechanic.phase >= 2 && mechanic.phase <= 4) {
        this.addTimedEffect(boss.debuffs, 'vulnerable', 1, 1);
      } else if (mechanic.phase >= 5) {
        mechanic.phase = 0;
        this.addTimedEffect(state.player.debuffs, 'weak', 1, 2);
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
      this.addTimedEffect(boss.debuffs, 'vulnerable', 1, 2);
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
      for (const [key, effect] of Object.entries(effects)) {
        if (effect.fresh) {
          effect.fresh = false;
          continue;
        }
        effect.turns -= 1;
        if (effect.turns <= 0) delete effects[key];
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
      state.player.passiveEffects ??= [];
      state.player.passiveEffects.push(...effects);
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
        } else if (child.type === 'first_turn_ap') {
          state.player.ap += this.number(child.value);
        }
      }
      this.log(state, 'system', `被动「${passive.name}」生效`);
    }
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
    }
    if (this.isSpellCard(card)) {
      bonus += this.effectValue(state.player.buffs.spell_damage_bonus);
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
    return bonus;
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
    return multiplier;
  }

  private isSpellCard(card: CardDefinition): boolean {
    return (
      card.type === 'spell' ||
      /mage|magic|spell|法|术|奥术|元素|魔/.test(
        `${String(card.cat ?? '')}${card.name}${card.description}`,
      )
    );
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
      case 'enemy_has_buff':
        return Object.keys(target.buffs).length > 0;
      case 'enemy_has_shield':
        return target.shield > 0;
      case 'enemy_no_shield':
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
      case 'discard':
        return (
          state.player.hand.length >= this.number(detail.amount ?? detail.value, 1)
        );
      case 'destroy_summon':
        return (
          state.player.summons.length >=
          this.number(detail.amount ?? detail.value, 1)
        );
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
        return state.player.lastCardId === String(detail.cardId ?? detail.id ?? '');
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

  private classResourceKey(value: unknown): string {
    const key = String(value ?? 'class_resource').toLowerCase();
    if (/圣印|sigil/.test(key)) return 'holy_sigil';
    if (/零件|part/.test(key)) return 'parts';
    if (/雷|charge/.test(key)) return 'thunder_charge';
    if (/共鸣|resonance/.test(key)) return 'element_resonance';
    if (/深渊|echo/.test(key)) return 'abyss_echo';
    return key.replace(/\s+/g, '_');
  }

  private updateClassResourcesAfterCard(
    state: LocalBattleState,
    card: CardDefinition,
    cardId: string,
  ): void {
    const resources = (state.player.classResources ??= {});
    if (card.type === 'defense') {
      resources.holy_sigil = (resources.holy_sigil ?? 0) + 1;
    }
    if (card.type === 'summon') {
      resources.parts = (resources.parts ?? 0) + 1;
    }
    if (this.number(card.mpCost) > 0) {
      resources.thunder_charge = (resources.thunder_charge ?? 0) + 1;
    }
    if (card.type === 'spell' || card.type === 'skill') {
      resources.element_resonance = (resources.element_resonance ?? 0) + 1;
    }
    state.player.lastCardId = cardId;
    state.player.lastCardType = card.type;
  }

  private isPayableCondition(condition: CardEffect): boolean {
    return ['spend_mp', 'discard', 'destroy_summon'].includes(condition.type);
  }

  private payCondition(state: LocalBattleState, condition: CardEffect): void {
    const requested = Math.max(
      1,
      this.number(condition.amount ?? condition.value, 1),
    );
    if (condition.type === 'spend_mp') {
      state.player.mp = Math.max(0, state.player.mp - requested);
    } else if (condition.type === 'discard') {
      const discarded = state.player.hand.splice(0, requested);
      state.player.discardPile.push(...discarded);
    } else if (condition.type === 'destroy_summon') {
      const destroyed =
        condition.amount === 'all'
          ? [...state.player.summons]
          : this.shuffle(state.player.summons).slice(0, requested);
      const ids = new Set(destroyed.map((summon) => summon.id));
      state.player.summons = state.player.summons.filter(
        (summon) => !ids.has(summon.id),
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

  private applyBattleStartRelics(
    state: LocalBattleState,
    carriedRelicIds: string[],
  ): boolean {
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
      const hasBoss = enemies.some((enemy) => {
        const definition = this.monsters?.[enemy.definitionId];
        return definition ? this.isBossMonster(definition) : false;
      });
      if (!hasBoss && this.random() < 0.1) {
        for (const enemy of enemies) enemy.hp = 0;
        this.log(
          state,
          'system',
          '金铲子闪闪发光，战斗直接判定为胜利！',
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
          hasBoss
            ? '金铲子遇到首领怪物，没有触发。'
            : '金铲子轻轻一挥，但这次没有挖到胜利。',
        );
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
        : Math.max(1, state.player.hp);
    player.mp = Math.max(0, state.player.mp);
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
    player.hp = Math.max(1, state.player.hp);
    player.mp = Math.max(0, state.player.mp);
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
    const profession = readWorkshopPacks()
      .flatMap((pack) => pack.classes)
      .find((entry) => entry.id === subclass);
    const ids = [
      ...new Set([...(profession?.mechanismIds ?? []), ...additionalIds]),
    ];
    if (!ids.length) return;
    const manifests = readWorkshopMechanisms().filter((entry) =>
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

  private async prepareInstalledWorkshopScripts(): Promise<void> {
    if (readWorkshopMechanisms().some(isWorkshopScriptMechanism)) {
      await prepareWorkshopScriptRuntime();
    }
  }

  private runWorkshopMechanisms(
    state: LocalBattleState,
    trigger: WorkshopMechanismTrigger,
    event: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const runtime = state.workshopMechanisms;
    if (!runtime?.ids.length || this.mechanismDepth >= 4) return event;
    if (this.mechanismDepth === 0) this.mechanismSteps = 0;
    this.mechanismDepth += 1;
    try {
      const manifests = readWorkshopMechanisms().filter((entry) =>
        runtime.ids.includes(entry.id),
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
              runtime.resources[`${manifest.id}:${resourceId}`] = value;
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
    const cards = this.cards ?? {};
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

  private applyWorkshopMechanismAction(
    state: LocalBattleState,
    manifest: WorkshopMechanismManifest,
    action: WorkshopMechanismAction,
    event: Record<string, unknown>,
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
      const definition = manifest.resources.find(
        (entry) => entry.id === action.resource,
      );
      if (!definition || !state.workshopMechanisms) return;
      const key = `${manifest.id}:${definition.id}`;
      const current = state.workshopMechanisms.resources[key] ?? definition.initial;
      const next = action.type === 'resource_add' ? current + value : value;
      state.workshopMechanisms.resources[key] = this.clamp(
        next,
        definition.min,
        definition.max,
      );
      this.log(
        state,
        'system',
        `${definition.label}：${current} → ${state.workshopMechanisms.resources[key]}`,
      );
      return;
    }

    const targets =
      action.target === 'all_enemies'
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
        this.addTimedEffect(
          action.type === 'apply_buff' ? target.buffs : target.debuffs,
          status,
          Math.max(1, amount),
          turns,
        );
      }
      this.log(state, 'system', `${label}施加 ${status}，持续 ${turns} 回合。`);
      return;
    }
    if (action.type === 'cleanse') {
      for (const target of targets) this.removeEffects(target.debuffs, amount || 1);
      return;
    }
    if (action.type === 'discard_random') {
      const discarded = this.shuffle(state.player.hand).splice(0, Math.min(amount, state.player.hand.length));
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
    return session;
  }

  private assertPlayerPhase(state: LocalBattleState): void {
    if (state.phase !== 'player') throw new Error('当前不是玩家行动阶段');
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
    const type = skill.effects?.[0]?.type;
    if (type === 'damage') return '攻击';
    if (type === 'shield') return '防御';
    if (type === 'buff') return '强化';
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
    target[key] = {
      value: Math.max(0, value) + (existing?.value ?? 0),
      turns: Math.max(turns, existing?.turns ?? 0),
      ...((options.charges ?? existing?.charges) !== undefined
        ? { charges: (options.charges ?? 0) + (existing?.charges ?? 0) }
        : {}),
      ...(options.undispellable || existing?.undispellable
        ? { undispellable: true }
        : {}),
      ...(options.uncleanseable || existing?.uncleanseable
        ? { uncleanseable: true }
        : {}),
      ...((options.debuff ?? existing?.debuff) !== undefined
        ? { debuff: options.debuff ?? existing?.debuff }
        : {}),
      ...(key === 'blood_burn'
        ? { stacks: (existing ? (existing.stacks ?? 1) : 0) + 1 }
        : {}),
      fresh: true,
    };
  }

  private spendEffectCharge(
    effects: Record<string, BattleTimedEffect>,
    key: string,
  ): void {
    const effect = effects[key];
    if (!effect || effect.charges === undefined) return;
    effect.charges -= 1;
    if (effect.charges <= 0) delete effects[key];
  }

  private triggerBloodBurnAction(
    state: LocalBattleState,
    target: Combatant,
    actionLabel: string,
  ): void {
    if (!target.buffs.blood_burn) return;
    const amount = Math.max(1, Math.floor(target.hpMax * 0.02));
    const stacks = Math.max(1, target.buffs.blood_burn.stacks ?? 1);
    for (let stack = 1; stack <= stacks && target.hp > 0; stack += 1) {
      this.directHpLoss(
        state,
        target,
        amount,
        `烧血·${actionLabel}（${stack}/${stacks}）`,
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
    this.addTimedEffect(
      enemy.debuffs,
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
  ): number {
    const amount = Math.max(0, Math.round(rawAmount));
    if (amount <= 0 || target.hp <= 0) return 0;
    const invincibleFloor =
      state.workshopTest?.playerInvincible && target === state.player
        ? 1
        : state.workshopTest?.dummyInvincible && target !== state.player
          ? 1
          : 0;
    const before = target.hp;
    target.hp = Math.max(invincibleFloor, target.hp - amount);
    const actual = before - target.hp;
    if (actual <= 0) return 0;
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
    const keys = Object.keys(effects).filter(
      (key) => !effects[key]?.undispellable && !effects[key]?.uncleanseable,
    );
    const count =
      amount === 'all'
        ? keys.length
        : Math.min(keys.length, Math.max(1, this.number(amount, 1)));
    for (const key of keys.slice(0, count)) delete effects[key];
    return count;
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
