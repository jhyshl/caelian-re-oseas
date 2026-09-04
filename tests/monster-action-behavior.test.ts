import { afterEach, describe, expect, it } from 'vitest';
import {
  loadMonsterCatalog,
  type MonsterDefinition,
  type MonsterSkillDefinition,
} from '@/content/catalogs/battle';
import type { BattleEnemyState, BattleIntent } from '@/domain/types';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { BattleRepository } from '@/storage/repositories/battle-repository';
import { GameRepository } from '@/storage/repository';

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

interface IntentChooser {
  chooseIntent(
    monster: MonsterDefinition,
    enemy: BattleEnemyState,
    allies?: BattleEnemyState[],
  ): BattleIntent | null;
}

interface MonsterRuntimeHarness extends IntentChooser {
  monsters?: Record<string, MonsterDefinition>;
}

function makeEnemy(
  overrides: Partial<BattleEnemyState> = {},
): BattleEnemyState {
  return {
    id: 'enemy:test',
    definitionId: 'monster:test',
    name: '测试怪物',
    hp: 100,
    hpMax: 100,
    shield: 0,
    attack: 20,
    defense: 10,
    speed: 0,
    difficulty: 'normal',
    tags: [],
    xp: 0,
    gold: [0, 0],
    loot: [],
    buffs: {},
    debuffs: {},
    intent: null,
    ...overrides,
  };
}

function makeChooser(random: () => number): IntentChooser {
  const database = new CaelianDatabase(
    'alpha',
    `caelian-monster-intent-${crypto.randomUUID()}`,
  );
  databases.push(database);
  return new BattleRepository(database, random) as unknown as IntentChooser;
}

async function createStartedBattle(monsterId: string) {
  const database = new CaelianDatabase(
    'alpha',
    `caelian-monster-action-${crypto.randomUUID()}`,
  );
  databases.push(database);
  const game = new GameRepository(database, new EventBus());
  const profile = await game.ensureProfile(`chat:monster-action:${monsterId}`);
  await game.execute(profile.id, {
    id: `monster-action-player:${monsterId}`,
    type: 'player.create',
    payload: {
      name: '怪物行动测试员',
      classMain: 'knight',
      subclass: 'holy_knight',
    },
  });
  const battles = new BattleRepository(database, () => 0.5);
  await battles.prepare();
  await battles.start(profile.id, { monsterId, count: 1 });
  const session = (await database.battleSessions
    .where('profileId')
    .equals(profile.id)
    .first())!;
  session.state.player.hp = session.state.player.hpMax = 1_000;
  session.state.player.shield = 0;
  session.state.player.defense = 0;
  session.state.player.speed = 0;
  session.state.player.passiveEffects = [];
  await database.battleSessions.put(session);
  return { database, profile, battles, session };
}

describe('怪物行动选择', () => {
  it('普通怪依次读取 patterns，低血技能只在阈值下触发一次', async () => {
    const catalog = await loadMonsterCatalog();
    const monster = catalog.mon_withered_treant!;
    const enemy = makeEnemy();
    const chooser = makeChooser(() => 0.5);

    expect(chooser.chooseIntent(monster, enemy)?.skillId).toBe('attack');
    expect(chooser.chooseIntent(monster, enemy)?.skillId).toBe('attack_heavy');
    enemy.hp = 30;
    expect(chooser.chooseIntent(monster, enemy)?.skillId).toBe('low_hp');
    expect(chooser.chooseIntent(monster, enemy)?.skillId).toBe('defend');
    expect(enemy.lastSpecial).toBe('low_hp');
  });

  it('连续辅助后的强制伤害分支也只允许低血技能触发一次', () => {
    const monster: MonsterDefinition = {
      name: '低血强制分支怪',
      skills: {
        low_hp: {
          name: '濒死反击',
          weight: 100,
          effects: [{ type: 'damage', value: 20 }],
        },
        attack: {
          name: '普通攻击',
          weight: 1,
          effects: [{ type: 'damage', value: 5 }],
        },
      },
    };
    const enemy = makeEnemy({ hp: 20, nonDamageActionStreak: 2 });
    const chooser = makeChooser(() => 0);

    expect(chooser.chooseIntent(monster, enemy)?.skillId).toBe('low_hp');
    expect(enemy.lastSpecial).toBe('low_hp');
    expect(chooser.chooseIntent(monster, enemy)?.skillId).toBe('attack');
  });

  it('保留小数权重，并在连续两次非伤害行动后强制攻击', () => {
    const weightedMonster: MonsterDefinition = {
      name: '小数权重怪',
      skills: {
        support: {
          name: '防守',
          weight: 0.25,
          effects: [{ type: 'shield', value: 5 }],
        },
        attack: {
          name: '攻击',
          weight: 1,
          effects: [{ type: 'damage', value: 5 }],
        },
      },
    };
    const chooser = makeChooser(() => 0.3);
    expect(chooser.chooseIntent(weightedMonster, makeEnemy())?.skillId).toBe(
      'attack',
    );

    const supportHeavy: MonsterDefinition = {
      name: '支援怪',
      skills: {
        support: {
          name: '反复防守',
          weight: 100,
          effects: [{ type: 'shield', value: 5 }],
        },
        attack: {
          name: '保底攻击',
          weight: 1,
          effects: [{ type: 'damage', value: 5 }],
        },
      },
    };
    expect(
      makeChooser(() => 0).chooseIntent(
        supportHeavy,
        makeEnemy({ nonDamageActionStreak: 2 }),
      )?.skillId,
    ).toBe('attack');
  });

  it('满血时不使用治疗，无减益时不使用净化', () => {
    const monster: MonsterDefinition = {
      name: '状态判断怪',
      skills: {
        heal: {
          name: '治疗',
          effects: [{ type: 'heal', value: 10 }],
        },
        cleanse: {
          name: '净化',
          effects: [{ type: 'cleanse', amount: 'all' }],
        },
        attack: {
          name: '攻击',
          effects: [{ type: 'damage', value: 5 }],
        },
      },
    };
    const chooser = makeChooser(() => 0);

    expect(chooser.chooseIntent(monster, makeEnemy())?.skillId).toBe('attack');
    expect(chooser.chooseIntent(monster, makeEnemy({ hp: 80 }))?.skillId).toBe(
      'heal',
    );
    expect(
      chooser.chooseIntent(
        monster,
        makeEnemy({ debuffs: { weak: { value: 1, turns: 1 } } }),
      )?.skillId,
    ).toBe('cleanse');
  });
});

describe('怪物技能结算', () => {
  it('吸血技能会伤害玩家并按实际扣血回复怪物', async () => {
    const { database, profile, battles, session } =
      await createStartedBattle('mon_skeleton');
    const enemy = session.state.enemies[0]!;
    enemy.hpMax = 100;
    enemy.hp = 40;
    enemy.attack = 20;
    enemy.intent = {
      skillId: 'drain',
      name: '生命汲取',
      kind: '吸血',
      description: '',
      amount: 0,
      hits: 1,
    };
    const playerHp = session.state.player.hp;
    await database.battleSessions.put(session);

    await battles.endTurn(profile.id, session.id);

    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.hp).toBeLessThan(playerHp);
    expect(current.state.enemies[0]!.hp).toBeGreaterThan(40);
    expect(current.state.log.some((entry) => entry.text.includes('吸血'))).toBe(
      true,
    );
  });

  it('驱散技能会移除可驱散的玩家强化', async () => {
    const { database, profile, battles, session } =
      await createStartedBattle('boss_solavia_hollow_saint');
    const enemy = session.state.enemies[0]!;
    session.state.player.buffs = {
      strength: { value: 4, turns: 2 },
    };
    session.state.player.summons = [
      {
        id: 'dispel-decoy',
        name: '驱散诱饵',
        duration: 3,
        hp: 1_000,
        hpMax: 1_000,
        shield: 0,
        attack: 1,
        defense: 0,
        speed: 0,
        attackable: true,
        mechanical: false,
        buffs: { agility: { value: 9, turns: 2 } },
        debuffs: {},
        skills: [],
      },
    ];
    enemy.intent = {
      skillId: 'action_4',
      name: '伪神谕令',
      kind: '驱散',
      description: '',
      amount: 0,
      hits: 1,
    };
    await database.battleSessions.put(session);

    await battles.endTurn(profile.id, session.id);

    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.buffs.strength).toBeUndefined();
    expect(current.state.player.summons[0]?.buffs?.agility).toBeDefined();
    expect(current.state.log.some((entry) => entry.text.includes('驱散'))).toBe(
      true,
    );
    expect(current.state.animations).toContainEqual(
      expect.objectContaining({
        kind: 'status',
        targetSide: 'player',
        targetId: 'player',
        label: '驱散',
      }),
    );
  });

  it('连续辅助两次后会选中利维坦百分比伤害并按生命上限与封顶值扣血', async () => {
    const { database, profile, battles, session } =
      await createStartedBattle('boss_abyssal_leviathan_fragment');
    const catalog = await loadMonsterCatalog();
    const parts = catalog.boss_abyssal_leviathan_fragment?.parts as
      | Array<Record<string, unknown>>
      | undefined;
    const leftTentacle = parts?.find(
      (part) => part.id === 'boss_leviathan_left_tentacle',
    );
    const actions = (leftTentacle?.skills as { actions?: unknown[] } | undefined)
      ?.actions;
    const drag = actions?.find(
      (action) =>
        Boolean(action) &&
        typeof action === 'object' &&
        (action as { name?: unknown }).name === '拖入海沟',
    );
    expect(drag).toBeDefined();
    const percentDamage = (drag as MonsterSkillDefinition).effects?.find(
      (effect) => effect.type === 'hp_percent_damage',
    );
    expect(percentDamage).toMatchObject({
      type: 'hp_percent_damage',
      percent: 6,
      cap: 38,
    });

    const definitionId = 'test_leviathan_left_tentacle';
    const monster: MonsterDefinition = {
      name: '利维坦左触须',
      skills: {
        support: {
          name: '蓄势',
          weight: 100,
          effects: [{ type: 'shield', value: 5 }],
        },
        action_2: drag as MonsterSkillDefinition,
      },
    };
    const runtime = battles as unknown as MonsterRuntimeHarness;
    runtime.monsters = {
      ...(runtime.monsters ?? {}),
      [definitionId]: monster,
    };
    const enemy = session.state.enemies[0]!;
    enemy.definitionId = definitionId;
    enemy.nonDamageActionStreak = 2;
    enemy.intent = runtime.chooseIntent(monster, enemy);
    expect(enemy.intent?.skillId).toBe('action_2');
    session.state.player.hp = session.state.player.hpMax = 1_000;
    await database.battleSessions.put(session);

    await battles.endTurn(profile.id, session.id);

    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.hp).toBe(962);
    expect(current.state.enemies[0]?.nonDamageActionStreak).toBe(0);
    expect(
      current.state.log.some(
        (entry) => entry.text.includes('拖入海沟') && entry.text.includes('38'),
      ),
    ).toBe(true);
  });
});
