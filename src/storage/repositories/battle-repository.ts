import {
  loadBattleRules,
  loadMonsterCatalog,
  loadPassiveCatalog,
  type BattleRules,
  type MonsterDefinition,
  type MonsterSkillDefinition,
  type PassiveDefinition,
} from '@/content/catalogs/battle';
import { loadCardCatalog } from '@/content/catalogs/cards';
import type { CardDefinition, CardEffect } from '@/content/types';
import type {
  BattleAnimationEvent,
  BattleEnemyState,
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

type Combatant = {
  hp: number;
  hpMax: number;
  shield: number;
  attack: number;
  defense: number;
  speed: number;
  buffs: Record<string, BattleTimedEffect>;
  debuffs: Record<string, BattleTimedEffect>;
};

export class BattleRepository {
  private cards?: Record<string, CardDefinition>;
  private monsters?: Record<string, MonsterDefinition>;
  private rules?: BattleRules;
  private passives?: Record<string, PassiveDefinition>;
  private animationSequence = 0;

  constructor(
    private readonly db: CaelianDatabase,
    private readonly random: () => number = Math.random,
  ) {}

  async prepare(): Promise<void> {
    if (this.cards && this.monsters && this.rules && this.passives) return;
    [this.cards, this.monsters, this.rules, this.passives] = await Promise.all([
      loadCardCatalog(),
      loadMonsterCatalog(),
      loadBattleRules(),
      loadPassiveCatalog(),
    ]);
  }

  async start(
    profileId: string,
    input: {
      monsterId?: string;
      count?: number;
      source?: string;
      relatedQuestId?: string;
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

    const [player, deck, loadout, equipment, settings, ownedPassives, world] =
      await Promise.all([
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
      ]);
    if (!player) throw new Error('玩家档案不存在');
    if (!deck || deck.cardIds.length === 0) {
      throw new Error('请先准备至少一张卡牌的出战牌组');
    }
    const region = world?.region || '伊拉亚城';
    const encounter = input.monsterId
      ? [input.monsterId, this.monsters?.[input.monsterId]] as const
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
      status: 'ongoing',
      phase: 'player',
      turn: 1,
      selectedTarget: 0,
      player: battlePlayer,
      enemies,
      rewards: null,
      log: [],
      animations: [],
    };

    this.drawCards(state, battlePlayer.initialDraw);
    this.applyBattleStartPassives(
      state,
      ownedPassives.map((entry) => entry.passiveId),
    );
    for (const enemy of enemies) {
      enemy.intent = this.chooseIntent(monster, enemy);
    }
    this.log(
      state,
      'system',
      `在${region}遭遇 ${enemyCount > 1 ? `${enemyCount} 只` : ''}${monster.name}。抽取 ${battlePlayer.hand.length} 张起始手牌。`,
    );
    const now = Date.now();
    await this.db.battleSessions.add({
      id: battleId,
      profileId,
      active: true,
      source:
        input.source?.trim() ||
        `${world?.location || region} · ${enemyCount > 1 ? '群体遭遇' : monster.name}`,
      relatedQuestId: input.relatedQuestId?.trim() || '',
      turn: state.turn,
      phase: state.phase,
      state,
      updatedAt: now,
    });
  }

  async playCard(
    profileId: string,
    input: {
      battleId: string;
      handIndex: number;
      targetIndex?: number;
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

    const targetIndex = this.resolveTargetIndex(
      state,
      input.targetIndex ?? state.selectedTarget,
    );
    const cost = this.cardCost(card, state, targetIndex);
    const mpCost = Math.max(0, this.number(card.mpCost));
    if (state.player.ap < cost) throw new Error('行动点不足');
    if (state.player.mp < mpCost) throw new Error('魔力不足');

    state.player.ap -= cost;
    state.player.mp -= mpCost;
    state.selectedTarget = targetIndex;
    state.player.hand.splice(input.handIndex, 1);
    this.log(state, 'player', `使用「${card.name}」`);
    this.animation(state, {
      kind: 'card',
      sourceSide: 'player',
      targetSide: 'enemy',
      targetId: state.enemies[targetIndex]?.id,
      apAfter: state.player.ap,
      mpAfter: state.player.mp,
      cardInstanceId: cardInstance.instanceId,
      label: card.name,
    });
    this.applyCardEffects(state, card, targetIndex);
    state.player.discardPile.push(cardInstance);

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
    await this.save(session);
  }

  async endTurn(profileId: string, battleId: string): Promise<void> {
    this.assertPrepared();
    const session = await this.getOngoing(profileId, battleId);
    const state = session.state;
    this.assertPlayerPhase(state);
    state.phase = 'enemy';
    this.log(state, 'system', '结束玩家回合');
    this.animation(state, {
      kind: 'turn',
      sourceSide: 'system',
      phaseAfter: 'enemy',
      turnAfter: state.turn,
      label: '敌方行动',
    });

    this.resolveChants(state);
    this.resolveSummons(state);
    if (this.aliveEnemies(state).length === 0) {
      await this.finishBattle(session, 'victory');
      return;
    }

    for (const enemy of this.aliveEnemies(state)) {
      const monster = this.monsters?.[enemy.definitionId];
      this.resolveEnemyAction(state, enemy, monster);
      if (state.player.hp <= 0) {
        await this.finishBattle(session, 'defeat');
        return;
      }
    }

    this.applyDamageOverTime(state);
    this.tickEffects(state.player);
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
    this.applyTurnStartPassives(state, profileId);
    this.drawCards(state, state.player.drawPerTurn);
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
      mpAfter: state.player.mp,
      phaseAfter: 'player',
      turnAfter: state.turn,
      label: `第 ${state.turn} 回合`,
    });
    await this.save(session);
  }

  async surrender(profileId: string, battleId: string): Promise<void> {
    const session = await this.getOngoing(profileId, battleId);
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
          variance,
      ),
    );
    const gold = Array.isArray(monster.gold)
      ? [
          this.number(monster.gold[0]),
          this.number(monster.gold[1], this.number(monster.gold[0])),
        ]
      : [this.number(monster.gold), this.number(monster.gold)];
    return {
      id: `${definitionId}:${instanceIndex}:${Math.floor(this.random() * 1_000_000)}`,
      definitionId,
      name:
        instanceIndex > 0
          ? `${monster.name} ${instanceIndex + 1}`
          : monster.name,
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
            variance,
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
            variance,
        ),
      ),
      speed: Math.max(
        0,
        Math.round(
          this.number(monster.speed) *
            Math.sqrt(userScale) *
            Math.sqrt(powerScale) *
            variance,
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
            packScale,
        ),
      ),
      gold: [
        Math.max(
          0,
          Math.round(
            Math.min(gold[0]!, gold[1]!) *
              (1 + levelDelta * 0.04) *
              userScale *
              packScale,
          ),
        ),
        Math.max(
          0,
          Math.round(
            Math.max(gold[0]!, gold[1]!) *
              (1 + levelDelta * 0.04) *
              userScale *
              packScale,
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
      intent: null,
    };
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
    const skill = enemy.intent
      ? monster?.skills?.[enemy.intent.skillId]
      : undefined;
    if (!skill) {
      const amount = Math.max(
        1,
        Math.round(enemy.attack * (this.rules?.enemyAttackScale ?? 0.48)),
      );
      this.animation(state, {
        kind: 'enemy-action',
        sourceSide: 'enemy',
        sourceId: enemy.id,
        targetSide: 'player',
        targetId: 'player',
        label: enemy.name,
      });
      this.damage(state, enemy, state.player, amount, 'enemy', enemy.name);
      return;
    }
    this.log(state, 'enemy', `${enemy.name} 使用「${skill.name}」`);
    this.animation(state, {
      kind: 'enemy-action',
      sourceSide: 'enemy',
      sourceId: enemy.id,
      targetSide: 'player',
      targetId: 'player',
      label: skill.name,
    });
    for (const effect of skill.effects ?? []) {
      if (effect.type === 'damage') {
        const hits = Math.max(1, this.number(effect.hits, 1));
        for (let hit = 0; hit < hits; hit += 1) {
          const amount = Math.max(
            1,
            Math.round(this.enemyEffectAmount(enemy, effect) * (0.9 + this.random() * 0.24)),
          );
          this.damage(state, enemy, state.player, amount, 'enemy', enemy.name);
          if (state.player.hp <= 0) break;
        }
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
          state.player.debuffs,
          effectName,
          this.number(effect.value, 1),
          this.number(effect.turns, 1),
        );
        this.animation(state, {
          kind: 'status',
          sourceSide: 'enemy',
          sourceId: enemy.id,
          targetSide: 'player',
          targetId: 'player',
          amount: this.number(effect.value, 1),
          label: effectName,
        });
      }
    }
  }

  private applyCardEffects(
    state: LocalBattleState,
    card: CardDefinition,
    targetIndex: number,
  ): void {
    const target = state.enemies[targetIndex];
    if (!target) return;
    const bonus = this.cardDamageBonus(card, state, target);
    const multiplier = this.cardDamageMultiplier(card, state, target);
    for (const effect of card.effects ?? []) {
      this.applyCardEffect(state, card, effect, targetIndex, bonus, multiplier);
      if (this.aliveEnemies(state).length === 0) break;
    }
  }

  private applyCardEffect(
    state: LocalBattleState,
    card: CardDefinition,
    effect: CardEffect,
    targetIndex: number,
    bonus = 0,
    multiplier = 1,
  ): void {
    const target = state.enemies[targetIndex];
    if (!target) return;
    const targets =
      effect.target === 'all_enemies'
        ? this.aliveEnemies(state)
        : [target].filter((enemy) => enemy.hp > 0);
    switch (effect.type) {
      case 'damage': {
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
            this.damage(
              state,
              state.player,
              enemy,
              Math.max(0, Math.round(base * multiplier)),
              'player',
              card.name,
            );
          }
        }
        break;
      }
      case 'shield': {
        const amount = Math.max(0, this.number(effect.value));
        state.player.shield += amount;
        this.log(state, 'player', `获得 ${amount} 点护盾`);
        this.animation(state, {
          kind: 'shield',
          sourceSide: 'player',
          targetSide: 'player',
          targetId: 'player',
          amount,
          shieldAfter: state.player.shield,
          label: card.name,
        });
        break;
      }
      case 'heal': {
        this.heal(state, state.player, this.number(effect.value), card.name);
        break;
      }
      case 'heal_overflow_shield': {
        const amount = this.number(effect.value);
        const missing = state.player.hpMax - state.player.hp;
        this.heal(state, state.player, amount, card.name);
        const overflow = Math.max(0, amount - missing);
        const shield = Math.round(overflow * this.number(effect.ratio, 1));
        state.player.shield += shield;
        if (shield > 0) {
          this.animation(state, {
            kind: 'shield',
            sourceSide: 'player',
            targetSide: 'player',
            targetId: 'player',
            amount: shield,
            shieldAfter: state.player.shield,
            label: card.name,
          });
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
            : [state.player];
        for (const recipient of recipients) {
          const effectName = String(effect.buff ?? effect.type);
          this.addTimedEffect(
            recipient.buffs,
            effectName,
            this.number(effect.value, 1),
            this.number(effect.turns, 1),
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
      case 'apply_debuff':
      case 'thorns_debuff': {
        const recipients =
          effect.target === 'self' ? [state.player] : targets;
        for (const recipient of recipients) {
          const effectName = String(effect.debuff ?? 'weak');
          this.addTimedEffect(
            recipient.debuffs,
            effectName,
            this.number(effect.value, 1),
            this.number(effect.turns, 1),
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
        const removed = this.removeEffects(state.player.debuffs, effect.amount);
        if (effect.type === 'cleanse_heal_per') {
          this.heal(
            state,
            state.player,
            removed * this.number(effect.value),
            card.name,
          );
        }
        break;
      }
      case 'cleanse_specific':
        delete state.player.debuffs[String(effect.debuff)];
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
        this.damage(
          state,
          state.player,
          target,
          Object.keys(target.debuffs).length * this.number(effect.value),
          'player',
          card.name,
        );
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
        this.damage(
          state,
          state.player,
          target,
          Math.round(state.player.shield * this.number(effect.ratio)),
          'player',
          card.name,
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
        const amount = Math.round(
          state.player.shield * this.number(effect.ratio),
        );
        state.player.shield += amount;
        if (amount > 0) {
          this.animation(state, {
            kind: 'shield',
            sourceSide: 'player',
            targetSide: 'player',
            targetId: 'player',
            amount,
            shieldAfter: state.player.shield,
            label: card.name,
          });
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
      case 'conditional_group': {
        const conditions = Array.isArray(effect.conditions)
          ? effect.conditions
          : [];
        if (conditions.every((condition) => this.conditionMatches(condition, state, target))) {
          const thenEffects = Array.isArray(effect.then_effects)
            ? (effect.then_effects as CardEffect[])
            : [];
          for (const child of thenEffects) {
            this.applyCardEffect(state, card, child, targetIndex);
          }
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

  private damage(
    state: LocalBattleState,
    source: Combatant,
    target: Combatant,
    rawAmount: number,
    kind: BattleLogEntry['kind'],
    label: string,
    ignoreDefense = false,
  ): number {
    let amount = Math.max(0, rawAmount);
    amount += this.effectValue(source.buffs.strength);
    if (source.debuffs.weak) amount *= 0.75;
    if (target.debuffs.vulnerable) amount *= 1.5;
    if (!ignoreDefense) {
      const defenseScale =
        target === state.player
          ? this.rules?.playerDefenseScale ?? 0.28
          : this.rules?.enemyDefenseScale ?? 0.26;
      amount -= Math.floor(target.defense * defenseScale);
    }
    amount = Math.max(rawAmount > 0 ? 1 : 0, Math.round(amount));
    const absorbed = Math.min(target.shield, amount);
    target.shield -= absorbed;
    const hpDamage = amount - absorbed;
    target.hp = Math.max(0, target.hp - hpDamage);
    const sourceIdentity = this.combatantIdentity(state, source);
    const targetIdentity = this.combatantIdentity(state, target);
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
      `${label}造成 ${hpDamage} 点伤害${absorbed ? `（护盾吸收 ${absorbed}）` : ''}`,
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
    return hpDamage;
  }

  private heal(
    state: LocalBattleState,
    target: Combatant,
    rawAmount: number,
    label: string,
  ): number {
    const amount = Math.max(0, Math.round(rawAmount));
    const before = target.hp;
    target.hp = Math.min(target.hpMax, target.hp + amount);
    const restored = target.hp - before;
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
    return restored;
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

  private resolveSummons(state: LocalBattleState): void {
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

  private applyDamageOverTime(state: LocalBattleState): void {
    const playerDot =
      this.effectValue(state.player.debuffs.burn) +
      this.effectValue(state.player.debuffs.poison);
    if (playerDot > 0) {
      this.damage(
        state,
        state.player,
        state.player,
        playerDot,
        'enemy',
        '持续伤害',
        true,
      );
    }
    for (const enemy of this.aliveEnemies(state)) {
      const dot =
        this.effectValue(enemy.debuffs.burn) +
        this.effectValue(enemy.debuffs.poison);
      if (dot > 0) {
        this.damage(
          state,
          state.player,
          enemy,
          dot,
          'player',
          '持续伤害',
          true,
        );
      }
    }
  }

  private tickEffects(target: Combatant): void {
    for (const effects of [target.buffs, target.debuffs]) {
      for (const [key, effect] of Object.entries(effects)) {
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
      if (effect.type === 'battle_start_shield') {
        state.player.shield += this.number(effect.value);
      } else if (effect.type === 'battle_start_mp') {
        state.player.mp = Math.min(
          state.player.mpMax,
          state.player.mp + this.number(effect.value),
        );
      } else if (effect.type === 'extra_draw') {
        state.player.drawPerTurn += this.number(effect.value);
      }
      this.log(state, 'system', `被动「${passive.name}」生效`);
    }
  }

  private applyTurnStartPassives(
    state: LocalBattleState,
    profileId: string,
  ): void {
    void profileId;
    // extra_draw is folded into drawPerTurn at battle start. Remaining common
    // passives are represented by the browser-local records already copied in.
    for (const passive of Object.values(this.passives ?? {})) {
      if (passive.effect?.type !== 'turn_start_heal') continue;
      // Only apply catalog entries that the battle start log marked as owned.
      if (!state.log.some((entry) => entry.text === `被动「${passive.name}」生效`)) {
        continue;
      }
      this.heal(
        state,
        state.player,
        this.number(passive.effect.value),
        passive.name,
      );
    }
  }

  private cardCost(
    card: CardDefinition,
    state: LocalBattleState,
    targetIndex: number,
  ): number {
    let cost = Math.max(0, this.number(card.cost));
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
    return card.effects?.some(
      (effect) =>
        effect.type === 'conditional_double' &&
        this.conditionMatches(effect, state, target),
    )
      ? 2
      : 1;
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
      case 'self_no_debuff':
        return Object.keys(state.player.debuffs).length === 0;
      case 'self_has_debuff':
        return Object.keys(state.player.debuffs).length > 0;
      case 'enemy_has_debuff':
        return Object.keys(target.debuffs).length > 0;
      case 'enemy_has_specific_debuff':
        return Boolean(target.debuffs[String(detail.debuff)]);
      case 'enemy_has_shield':
        return target.shield > 0;
      case 'low_hp':
      case 'self_low_hp':
        return state.player.hp <= state.player.hpMax * 0.5;
      default:
        return false;
    }
  }

  private async finishBattle(
    session: BattleSessionRecord,
    status: 'victory' | 'defeat',
  ): Promise<void> {
    const state = session.state;
    state.status = status;
    state.phase = 'ended';
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
    await this.applyRewards(session.profileId, state, rewards, status);
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

  private calculateRewards(state: LocalBattleState): BattleRewards {
    const enemies = state.enemies;
    const experience = enemies.reduce((sum, enemy) => sum + enemy.xp, 0);
    const gold = enemies.reduce((sum, enemy) => {
      const [min, max] = enemy.gold;
      return sum + Math.round(min + this.random() * Math.max(0, max - min));
    }, 0);
    const items = enemies.flatMap((enemy) =>
      enemy.loot
        .filter((item) => this.random() <= item.chance)
        .map((item) => ({ id: item.id, name: item.name, quantity: 1 })),
    );
    return {
      experience,
      gold: gold * 5,
      guildExperience: Math.round(experience * 0.35),
      items,
    };
  }

  private async applyRewards(
    profileId: string,
    state: LocalBattleState,
    rewards: BattleRewards,
    status: 'victory' | 'defeat',
  ): Promise<void> {
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
    player.experience += rewards.experience;
    player.gold += rewards.gold;
    while (player.experience >= player.experienceToNext) {
      player.experience -= player.experienceToNext;
      player.level += 1;
      player.statPoints += 1;
      player.experienceToNext = 100 + (player.level - 1) * 50;
    }
    player.updatedAt = Date.now();
    await this.db.playerStates.put(player);
    if (guild) {
      guild.experience += rewards.guildExperience;
      guild.updatedAt = Date.now();
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
  ): void {
    const existing = target[key];
    target[key] = {
      value: Math.max(value, existing?.value ?? 0),
      turns: Math.max(turns, existing?.turns ?? 0),
    };
  }

  private removeEffects(
    effects: Record<string, BattleTimedEffect>,
    amount: unknown,
  ): number {
    const keys = Object.keys(effects);
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
  ): { side: 'player' | 'enemy'; id: string } {
    if (combatant === state.player) {
      return { side: 'player', id: 'player' };
    }
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

  private clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
  }

  private assertPrepared(): void {
    if (!this.cards || !this.monsters || !this.rules || !this.passives) {
      throw new Error('战斗内容尚未加载');
    }
  }
}
