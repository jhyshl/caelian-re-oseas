import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { BattleRepository } from '@/storage/repositories/battle-repository';
import { GameRepository } from '@/storage/repository';
import {
  normalizeWorkshopMechanism,
  saveWorkshopMechanism,
  workshopStatusKey,
} from '@/workshop-mechanisms';
import {
  compileVisualWorkshopResource,
  compileVisualWorkshopStatus,
} from '@/workshop-visual-builder';
import {
  normalizeWorkshopPack,
  saveWorkshopPack,
} from '@/workshop';

const databases: CaelianDatabase[] = [];

afterEach(async () => {
  localStorage.clear();
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

function workshopClass(
  cards: Array<Record<string, unknown>>,
  mechanismIds: string[],
  id = 'custom_class_state_resource_test',
): Record<string, unknown> {
  const cardIds = cards.map((card) => String(card.id));
  return {
    id,
    main: 'freelance',
    name: '状态资源测试师',
    talent: { name: '无', description: '无额外效果', effects: [] },
    cards,
    cardPool: [...cardIds, ...cardIds],
    starterDeck: [...cardIds, ...cardIds.slice(0, 7)],
    mechanismIds,
  };
}

function fillerCards(prefix: string): Array<Record<string, unknown>> {
  return Array.from({ length: 8 }, (_, index) => ({
    id: `${prefix}_${index}`,
    name: `${prefix}填充牌${index + 1}`,
    type: 'skill',
    cost: 2,
    effects: [{ type: 'draw', value: 1, target: 'self' }],
  }));
}

describe('创意工坊自定义状态与资源', () => {
  it('视觉编译器将同名状态和资源拆成互不碰撞的独立机制', () => {
    const status = compileVisualWorkshopStatus({
      id: 'shared-name',
      statusId: 'shared-effect',
      name: '星辉',
      description: '一个真正的战斗状态。',
      polarity: 'buff',
      effects: [
        { type: 'damage_reduction', value: 25 },
        { type: 'debuff_immunity', value: 0 },
      ],
    });
    const resource = compileVisualWorkshopResource({
      id: 'shared-name',
      resourceId: 'shared-effect',
      name: '星辉',
      description: '一个可获取和消费的战斗资源。',
      min: 0,
      max: 10,
      initial: 3,
      visible: true,
      gains: [],
      thresholds: [],
    });

    expect(status.id).toBe('visual.status.shared-name');
    expect(resource.id).toBe('visual.resource.shared-name');
    expect(status.id).not.toBe(resource.id);
    expect(status.resources).toEqual([]);
    expect(status.statuses).toEqual([
      expect.objectContaining({
        id: 'shared-effect',
        polarity: 'buff',
        effects: [
          { type: 'damage_reduction', value: 25 },
          { type: 'debuff_immunity', value: 1 },
        ],
      }),
    ]);
    expect(resource.statuses).toEqual([]);
    expect(resource.resources).toEqual([
      expect.objectContaining({
        id: 'shared-effect',
        min: 0,
        max: 10,
        initial: 3,
      }),
    ]);

    expect(normalizeWorkshopMechanism(status)).toMatchObject({
      resources: [],
      statuses: [{ id: 'shared-effect', polarity: 'buff' }],
      rules: [],
    });
    expect(normalizeWorkshopMechanism(resource)).toMatchObject({
      resources: [{ id: 'shared-effect' }],
      statuses: [],
      rules: [],
    });
  });

  it('资源阈值只匹配从阈值下方越界，并按固定值或全部消费', () => {
    const resource = compileVisualWorkshopResource({
      id: 'thresholds',
      resourceId: 'charge',
      name: '充能',
      min: 0,
      max: 10,
      initial: 4,
      visible: true,
      gains: [{ trigger: 'after_card', amount: 2, cardType: 'attack' }],
      thresholds: [
        {
          value: 5,
          consume: 'fixed',
          consumeValue: 2,
          outcome: { type: 'damage', target: 'all_enemies', value: 7 },
        },
        {
          value: 10,
          consume: 'all',
          outcome: { type: 'shield', target: 'player', value: 9 },
        },
      ],
    });

    const fixed = resource.rules.find((rule) =>
      rule.id.endsWith('threshold-1'),
    );
    expect(fixed).toMatchObject({
      trigger: 'resource_changed',
      condition: {
        type: 'all',
        conditions: [
          {
            left: { op: 'event', key: 'before' },
            operator: 'lt',
            right: 5,
          },
          {
            left: { op: 'event', key: 'after' },
            operator: 'gte',
            right: 5,
          },
        ],
      },
      actions: [
        { type: 'damage', target: 'all_enemies', value: 7 },
        { type: 'resource_add', resource: 'charge', value: -2 },
      ],
    });
    expect(resource.rules.find((rule) => rule.id.endsWith('threshold-2')))
      .toMatchObject({
        actions: [
          { type: 'shield', target: 'player', value: 9 },
          { type: 'resource_set', resource: 'charge', value: 0 },
        ],
      });
  });

  it('职业包拒绝缺失的状态引用和资源引用', () => {
    const status = compileVisualWorkshopStatus({
      id: 'reference-status',
      statusId: 'guard',
      name: '守护',
      polarity: 'buff',
      effects: [{ type: 'damage_reduction', value: 20 }],
    });
    const resource = compileVisualWorkshopResource({
      id: 'reference-resource',
      resourceId: 'energy',
      name: '能量',
      min: 0,
      max: 10,
      initial: 0,
      visible: true,
      gains: [],
      thresholds: [],
    });

    const badStatusCards = fillerCards('missing_status');
    badStatusCards[0] = {
      id: 'missing_status_0',
      name: '错误状态牌',
      type: 'skill',
      cost: 2,
      effects: [
        {
          type: 'apply_workshop_status',
          mechanismId: status.id,
          statusId: 'not-found',
          value: 1,
          turns: 2,
          target: 'self',
        },
      ],
    };
    expect(() =>
      normalizeWorkshopPack({
        packName: '缺失状态引用',
        mechanisms: [status],
        classes: [workshopClass(badStatusCards, [status.id])],
      }),
    ).toThrow('引用了不存在的自定义状态 not-found');

    const badResourceCards = fillerCards('missing_resource');
    badResourceCards[0] = {
      id: 'missing_resource_0',
      name: '错误资源牌',
      type: 'skill',
      cost: 2,
      effects: [
        {
          type: 'workshop_resource_change',
          mechanismId: resource.id,
          resourceId: 'not-found',
          mode: 'add',
          value: 1,
        },
      ],
    };
    expect(() =>
      normalizeWorkshopPack({
        packName: '缺失资源引用',
        mechanisms: [resource],
        classes: [
          workshopClass(
            badResourceCards,
            [resource.id],
            'custom_class_missing_resource',
          ),
        ],
      }),
    ).toThrow('引用了不存在的自定义资源 not-found');
  });

  it('同 ID 机制升级时始终按职业包内的新定义校验', () => {
    const oldResource = compileVisualWorkshopResource({
      id: 'same-id-upgrade',
      resourceId: 'legacy-energy',
      name: '旧资源',
      min: 0,
      max: 10,
      initial: 0,
      visible: true,
      gains: [],
      thresholds: [],
    });
    saveWorkshopMechanism(oldResource);
    const newStatus = normalizeWorkshopMechanism({
      ...compileVisualWorkshopStatus({
        id: 'same-id-upgrade',
        statusId: 'new-guard',
        name: '新状态',
        polarity: 'buff',
        effects: [{ type: 'damage_reduction', value: 10 }],
      }),
      id: oldResource.id,
    });
    const cards = fillerCards('same_id_upgrade');
    cards[0] = {
      id: 'same_id_upgrade_0',
      name: '使用新状态',
      type: 'skill',
      cost: 2,
      effects: [
        {
          type: 'apply_workshop_status',
          mechanismId: newStatus.id,
          statusId: 'new-guard',
          target: 'self',
          value: 1,
          turns: 2,
        },
      ],
    };
    expect(() =>
      normalizeWorkshopPack({
        packName: '同 ID 正常升级',
        mechanisms: [newStatus],
        classes: [workshopClass(cards, [newStatus.id])],
      }),
    ).not.toThrow();

    const staleCards = fillerCards('same_id_stale');
    staleCards[0] = {
      id: 'same_id_stale_0',
      name: '错误沿用旧资源',
      type: 'skill',
      cost: 2,
      effects: [
        {
          type: 'workshop_resource_change',
          mechanismId: newStatus.id,
          resourceId: 'legacy-energy',
          mode: 'add',
          value: 1,
        },
      ],
    };
    expect(() =>
      normalizeWorkshopPack({
        packName: '同 ID 陈旧引用',
        mechanisms: [newStatus],
        classes: [workshopClass(staleCards, [newStatus.id])],
      }),
    ).toThrow('引用了不存在的自定义资源 legacy-energy');
  });

  it('声明式机制拒绝规则内部不存在的状态与资源引用', () => {
    const base = {
      format: 'caelian_workshop_mechanism',
      version: 1,
      id: 'invalid-internal-reference',
      name: '错误内部引用',
      resources: [],
      statuses: [],
    };
    expect(() =>
      normalizeWorkshopMechanism({
        ...base,
        rules: [
          {
            id: 'missing-action-resource',
            trigger: 'turn_start',
            actions: [
              { type: 'resource_add', resource: 'not-found', value: 1 },
            ],
          },
        ],
      }),
    ).toThrow('引用了不存在的资源 not-found');
    expect(() =>
      normalizeWorkshopMechanism({
        ...base,
        rules: [
          {
            id: 'missing-formula-resource',
            trigger: 'turn_start',
            actions: [
              {
                type: 'shield',
                target: 'player',
                value: { op: 'resource', id: 'not-found' },
              },
            ],
          },
        ],
      }),
    ).toThrow('公式引用了不存在的资源 not-found');
    expect(() =>
      normalizeWorkshopMechanism({
        ...base,
        rules: [
          {
            id: 'missing-status',
            trigger: 'battle_start',
            actions: [
              {
                type: 'apply_status',
                target: 'player',
                status: 'not-found',
                value: 1,
                turns: 2,
              },
            ],
          },
        ],
      }),
    ).toThrow('引用了不存在的状态 not-found');
  });

  it('真实战斗把状态放入 buffs/debuffs，并结算效果与标准净化驱散', async () => {
    const mechanismId = 'visual.status.runtime';
    const guardId = 'guardian';
    const rotId = 'rot';
    const mechanism = normalizeWorkshopMechanism({
      format: 'caelian_workshop_mechanism',
      version: 1,
      id: mechanismId,
      name: '状态运行时',
      resources: [],
      statuses: [
        {
          id: guardId,
          label: '星辉守护',
          polarity: 'buff',
          effects: [
            { type: 'damage_reduction', value: 25 },
            { type: 'debuff_immunity', value: 1 },
            { type: 'turn_heal', value: 5 },
            { type: 'turn_shield', value: 4 },
            { type: 'damage_bonus', value: 50 },
          ],
        },
        {
          id: rotId,
          label: '腐化',
          polarity: 'debuff',
          effects: [{ type: 'turn_damage', value: 3 }],
        },
      ],
      rules: [],
    });
    const cards: Array<Record<string, unknown>> = [
      {
        id: 'status_apply_rot_self',
        name: '承受腐化',
        type: 'skill',
        cost: 2,
        effects: [
          {
            type: 'apply_workshop_status',
            mechanismId,
            statusId: rotId,
            value: 2,
            turns: 3,
            target: 'self',
          },
        ],
      },
      {
        id: 'status_apply_guard_self',
        name: '自我守护',
        type: 'skill',
        cost: 2,
        effects: [
          {
            type: 'apply_workshop_status',
            mechanismId,
            statusId: guardId,
            value: 2,
            turns: 3,
            target: 'self',
          },
        ],
      },
      {
        id: 'status_damage',
        name: '状态增伤测试',
        type: 'attack',
        cost: 2,
        effects: [{ type: 'damage', value: 10, target: 'enemy' }],
      },
      {
        id: 'status_cleanse',
        name: '标准净化',
        type: 'skill',
        cost: 2,
        effects: [{ type: 'cleanse', amount: 'all', target: 'self' }],
      },
      {
        id: 'status_apply_guard_enemy',
        name: '敌方守护',
        type: 'skill',
        cost: 2,
        effects: [
          {
            type: 'apply_workshop_status',
            mechanismId,
            statusId: guardId,
            value: 2,
            turns: 3,
            target: 'enemy',
          },
        ],
      },
      {
        id: 'status_dispel',
        name: '标准驱散',
        type: 'skill',
        cost: 2,
        effects: [{ type: 'dispel', amount: 'all', target: 'enemy' }],
      },
      ...fillerCards('status_runtime').slice(0, 2),
    ];
    const pack = {
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: '状态运行时测试包',
      mechanisms: [mechanism],
      classes: [workshopClass(cards, [mechanismId])],
    };
    saveWorkshopPack(pack);

    const database = new CaelianDatabase(
      'alpha',
      `caelian-workshop-status-runtime-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:workshop-status-runtime');
    await game.execute(profile.id, {
      id: 'workshop-status-player-create',
      type: 'player.create',
      payload: {
        name: '状态测试玩家',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const battles = new BattleRepository(database, () => 0.5);
    await battles.prepare();
    await battles.start(profile.id, {
      workshopTest: {
        professionId: 'custom_class_state_resource_test',
        mechanismIds: [],
        dummyCount: 1,
        dummyHp: 500,
        dummyAttack: 20,
        dummyDefense: 0,
        dummyInvincible: false,
        dummyAttackEnabled: true,
        autoRespawn: false,
        playerInvincible: true,
        attributes: {
          hpMax: 4,
          mpMax: 0,
          attack: 0,
          defense: 0,
          speed: 0,
          actionPointsPerTurn: 10,
        },
      },
    });
    let session = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .first())!;
    const battleId = session.id;
    let sequence = 0;
    const play = async (cardId: string): Promise<void> => {
      session = (await database.battleSessions.get(battleId))!;
      session.state.player.hand.unshift({
        instanceId: `custom-status-test:${sequence++}`,
        cardId,
      });
      session.state.player.ap = 99;
      await database.battleSessions.put(session);
      await battles.playCard(profile.id, {
        battleId,
        handIndex: 0,
        targetIndex: 0,
      });
      session = (await database.battleSessions.get(battleId))!;
    };
    const guardKey = workshopStatusKey(mechanismId, guardId);
    const rotKey = workshopStatusKey(mechanismId, rotId);

    await play('status_apply_rot_self');
    expect(session.state.player.debuffs[rotKey]).toMatchObject({
      value: 2,
      turns: 3,
    });
    expect(session.state.player.buffs[rotKey]).toBeUndefined();

    await play('status_apply_guard_self');
    expect(session.state.player.buffs[guardKey]).toMatchObject({
      value: 2,
      turns: 3,
    });
    expect(session.state.player.debuffs[guardKey]).toBeUndefined();

    session.state.player.hp = 50;
    session.state.player.shield = 0;
    session.state.player.attack = 0;
    session.state.player.defense = 0;
    session.state.enemies[0]!.definitionId = 'mon_goblin';
    session.state.enemies[0]!.intent = {
      skillId: 'debuff_weak',
      name: '虚弱打击',
      kind: '减益',
      description: '测试标准减益免疫。',
      amount: 1,
      hits: 1,
    };
    await database.battleSessions.put(session);
    await battles.endTurn(profile.id, battleId);
    session = (await database.battleSessions.get(battleId))!;
    expect(session.state.player.debuffs.weak).toBeUndefined();
    expect(session.state.player.hp).toBe(54);
    expect(session.state.player.shield).toBe(8);
    expect(session.state.player.buffs[guardKey]?.turns).toBe(3);
    expect(session.state.player.debuffs[rotKey]?.turns).toBe(3);

    session.state.enemies[0]!.hp = 100;
    session.state.enemies[0]!.hpMax = 500;
    session.state.enemies[0]!.defense = 0;
    await database.battleSessions.put(session);
    await play('status_damage');
    expect(session.state.enemies[0]!.hp).toBe(80);

    session.state.player.hp = 50;
    session.state.player.shield = 0;
    session.state.player.defense = 0;
    session.state.enemies[0]!.definitionId = 'workshop_dummy';
    session.state.enemies[0]!.attack = 20;
    session.state.enemies[0]!.intent = {
      skillId: 'workshop-test-hit',
      name: '测试攻击',
      kind: 'attack',
      description: '测试减伤。',
      amount: 20,
      hits: 1,
    };
    await database.battleSessions.put(session);
    await battles.endTurn(profile.id, battleId);
    session = (await database.battleSessions.get(battleId))!;
    expect(session.state.player.hp).toBe(49);
    expect(session.state.player.shield).toBe(8);
    expect(session.state.player.buffs[guardKey]?.turns).toBe(2);
    expect(session.state.player.debuffs[rotKey]?.turns).toBe(2);

    await play('status_cleanse');
    expect(session.state.player.debuffs[rotKey]).toBeUndefined();
    expect(session.state.player.buffs[guardKey]).toBeDefined();

    await play('status_apply_guard_enemy');
    expect(session.state.enemies[0]!.buffs[guardKey]).toMatchObject({
      value: 2,
      turns: 3,
    });
    await play('status_dispel');
    expect(session.state.enemies[0]!.buffs[guardKey]).toBeUndefined();
  });

  it('真实战斗支持资源增减、固定/全部消费和单次阈值结算', async () => {
    const resource = compileVisualWorkshopResource({
      id: 'runtime-energy',
      resourceId: 'energy',
      name: '战意',
      min: 0,
      max: 10,
      initial: 4,
      visible: true,
      gains: [],
      thresholds: [
        {
          value: 5,
          consume: 'fixed',
          consumeValue: 2,
          outcome: { type: 'damage', target: 'all_enemies', value: 7 },
        },
      ],
    });
    const cards: Array<Record<string, unknown>> = [
      {
        id: 'resource_gain',
        name: '获得战意',
        type: 'skill',
        cost: 2,
        effects: [
          {
            type: 'workshop_resource_change',
            mechanismId: resource.id,
            resourceId: 'energy',
            mode: 'add',
            value: 2,
          },
        ],
      },
      {
        id: 'resource_reduce',
        name: '失去战意',
        type: 'skill',
        cost: 2,
        effects: [
          {
            type: 'workshop_resource_change',
            mechanismId: resource.id,
            resourceId: 'energy',
            mode: 'add',
            value: -3,
          },
        ],
      },
      {
        id: 'resource_spend_fixed',
        name: '固定支付战意',
        type: 'skill',
        cost: 2,
        effects: [
          {
            type: 'conditional_group',
            logic: 'and',
            conditions: [
              {
                type: 'spend_workshop_resource',
                mechanismId: resource.id,
                resourceId: 'energy',
                amount: 2,
              },
            ],
            then_effects: [{ type: 'damage', value: 3, target: 'enemy' }],
            else_effects: [],
          },
        ],
      },
      {
        id: 'resource_spend_all',
        name: '全部支付战意',
        type: 'skill',
        cost: 2,
        effects: [
          {
            type: 'conditional_group',
            logic: 'and',
            conditions: [
              {
                type: 'spend_workshop_resource',
                mechanismId: resource.id,
                resourceId: 'energy',
                amount: 'all',
              },
            ],
            then_effects: [{ type: 'damage', value: 4, target: 'enemy' }],
            else_effects: [],
          },
        ],
      },
      ...fillerCards('resource_runtime').slice(0, 4),
    ];
    saveWorkshopPack({
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: '资源运行时测试包',
      mechanisms: [resource],
      classes: [
        workshopClass(
          cards,
          [resource.id],
          'custom_class_resource_runtime_test',
        ),
      ],
    });

    const database = new CaelianDatabase(
      'alpha',
      `caelian-workshop-resource-runtime-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:workshop-resource-runtime');
    await game.execute(profile.id, {
      id: 'workshop-resource-player-create',
      type: 'player.create',
      payload: {
        name: '资源测试玩家',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const battles = new BattleRepository(database, () => 0);
    await battles.prepare();
    await battles.start(profile.id, {
      workshopTest: {
        professionId: 'custom_class_resource_runtime_test',
        mechanismIds: [],
        dummyCount: 1,
        dummyHp: 500,
        dummyAttack: 0,
        dummyDefense: 0,
        dummyInvincible: false,
        dummyAttackEnabled: false,
        autoRespawn: false,
        playerInvincible: true,
        attributes: {
          hpMax: 0,
          mpMax: 0,
          attack: 0,
          defense: 0,
          speed: 0,
          actionPointsPerTurn: 10,
        },
      },
    });
    let session = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .first())!;
    const battleId = session.id;
    const resourceKey = `${resource.id}:energy`;
    let sequence = 0;
    const play = async (cardId: string): Promise<void> => {
      session = (await database.battleSessions.get(battleId))!;
      session.state.player.hand.unshift({
        instanceId: `custom-resource-test:${sequence++}`,
        cardId,
      });
      session.state.player.ap = 99;
      await database.battleSessions.put(session);
      await battles.playCard(profile.id, {
        battleId,
        handIndex: 0,
        targetIndex: 0,
      });
      session = (await database.battleSessions.get(battleId))!;
    };

    expect(session.state.workshopMechanisms?.resources[resourceKey]).toBe(4);

    await play('resource_gain');
    expect(session.state.workshopMechanisms?.resources[resourceKey]).toBe(4);
    expect(session.state.enemies[0]!.hp).toBe(493);

    await play('resource_gain');
    expect(session.state.workshopMechanisms?.resources[resourceKey]).toBe(4);
    expect(session.state.enemies[0]!.hp).toBe(486);

    await play('resource_reduce');
    expect(session.state.workshopMechanisms?.resources[resourceKey]).toBe(1);
    expect(session.state.enemies[0]!.hp).toBe(486);

    await play('resource_gain');
    expect(session.state.workshopMechanisms?.resources[resourceKey]).toBe(3);
    expect(session.state.enemies[0]!.hp).toBe(486);

    await play('resource_spend_fixed');
    expect(session.state.workshopMechanisms?.resources[resourceKey]).toBe(1);
    expect(session.state.enemies[0]!.hp).toBe(483);

    await play('resource_spend_all');
    expect(session.state.workshopMechanisms?.resources[resourceKey]).toBe(0);
    expect(session.state.enemies[0]!.hp).toBe(479);

    await play('resource_spend_fixed');
    expect(session.state.workshopMechanisms?.resources[resourceKey]).toBe(0);
    expect(session.state.enemies[0]!.hp).toBe(479);
  });

  it('职业天赋可独立施加永久状态，并在战斗与回合开始改变资源', async () => {
    const status = compileVisualWorkshopStatus({
      id: 'talent-guard',
      statusId: 'guard',
      name: '天赋守护',
      polarity: 'buff',
      effects: [{ type: 'damage_reduction', value: 10 }],
    });
    const resource = compileVisualWorkshopResource({
      id: 'talent-energy',
      resourceId: 'energy',
      name: '天赋能量',
      min: 0,
      max: 10,
      initial: 0,
      visible: true,
      gains: [],
      thresholds: [],
    });
    const profession = workshopClass(
      fillerCards('talent_runtime'),
      [status.id, resource.id],
      'custom_class_talent_runtime_test',
    );
    profession.talent = {
      name: '状态资源天赋',
      description: '分别使用状态与资源。',
      effects: [
        {
          type: 'apply_workshop_status',
          mechanismId: status.id,
          statusId: 'guard',
          target: 'self',
          value: 1,
          turns: -1,
        },
        {
          type: 'workshop_resource_change',
          mechanismId: resource.id,
          resourceId: 'energy',
          trigger: 'battle_start',
          mode: 'add',
          value: 2,
        },
        {
          type: 'workshop_resource_change',
          mechanismId: resource.id,
          resourceId: 'energy',
          trigger: 'turn_start',
          mode: 'add',
          value: 1,
        },
      ],
    };
    const normalized = saveWorkshopPack({
      packName: '天赋状态资源包',
      mechanisms: [status, resource],
      classes: [profession],
    });
    expect(normalized.classes[0]!.talent.effects).toHaveLength(3);

    const missingStatus = structuredClone(profession);
    (missingStatus.talent as Record<string, unknown>).effects = [
      {
        type: 'apply_workshop_status',
        mechanismId: status.id,
        statusId: 'not-found',
        target: 'self',
        value: 1,
        turns: -1,
      },
    ];
    expect(() =>
      normalizeWorkshopPack({
        packName: '错误天赋状态包',
        mechanisms: [status],
        classes: [missingStatus],
      }),
    ).toThrow('引用了不存在的自定义状态 not-found');

    const database = new CaelianDatabase(
      'alpha',
      `caelian-workshop-talent-runtime-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:workshop-talent-runtime');
    await game.execute(profile.id, {
      id: 'workshop-talent-player-create',
      type: 'player.create',
      payload: {
        name: '天赋测试玩家',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const battles = new BattleRepository(database, () => 0.5);
    await battles.prepare();
    await battles.start(profile.id, {
      workshopTest: {
        professionId: 'custom_class_talent_runtime_test',
        mechanismIds: [],
        dummyCount: 1,
        dummyHp: 500,
        dummyAttack: 0,
        dummyDefense: 0,
        dummyInvincible: false,
        dummyAttackEnabled: false,
        autoRespawn: false,
        playerInvincible: true,
        attributes: {
          hpMax: 0,
          mpMax: 0,
          attack: 0,
          defense: 0,
          speed: 0,
          actionPointsPerTurn: 10,
        },
      },
    });
    let session = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .first())!;
    const statusKey = workshopStatusKey(status.id, 'guard');
    const resourceKey = `${resource.id}:energy`;
    expect(session.state.player.buffs[statusKey]).toMatchObject({
      value: 1,
      turns: -1,
    });
    expect(session.state.workshopMechanisms?.resources[resourceKey]).toBe(2);

    await battles.endTurn(profile.id, session.id);
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.player.buffs[statusKey]?.turns).toBe(-1);
    expect(session.state.workshopMechanisms?.resources[resourceKey]).toBe(3);
  });
});
