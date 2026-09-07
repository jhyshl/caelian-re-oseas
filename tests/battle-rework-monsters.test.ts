import { describe, expect, it } from 'vitest';

import { catalog, actor, makeGame } from '../src/battle/rework/runtime/physics.mjs';
import { encounter } from '../src/battle/rework/runtime/model.mjs';
import { planEnemy, planEnemies, actEnemy, validateEnemyCatalog, isWeakSelfBuff, notifyEnemyDamaged } from '../src/battle/rework/runtime/enemies.mjs';
const patch = { shieldCounter: true, skipWeakSelfBuff: true, attackTierRamp: { normal: 0.2, elite: 0.3 } };
const definitions = new Map<string, any>(catalog.monsters.map((m: any) => [m.id, m]));
const tags = ['water', 'aquatic', 'plant', 'insect', 'fire', 'abyss', 'undead', 'construct', 'mechanical'];
const effectKind = (e: any) => e.kind || e.type;

function fixture(ids = ['mon_goblin'], options: any = {}) {
  const player = actor('player', 'player', 20, { hp: 4000, attack: 100, defense: 100, speed: 100, crit: 0, critDamage: 50, ehr: 0, res: 0 });
  const defs = ids.map(id => structuredClone(definitions.get(id)));
  const enemies = encounter(defs, 20, patch);
  const g = makeGame(player, enemies, { seed: 70277, trace: true, patch: { ...patch, ...options } });
  g.round = 2;
  g.phase = 'player';
  g.catalog = catalog;
  g.notifyEnemyDamaged = notifyEnemyDamaged;
  g.hitRng = () => 1;
  g.effectRng = () => 0;
  g.critRng = () => 1;
  return g;
}

function status(g: any, target: any, name: string, value = 0.15, buff = false) {
  g.addStatus(target, target, { type: buff ? 'buff' : 'debuff', status: name, canonicalStatus: name, value, valueUnit: 'ratio', turns: 5, dispellable: true }, { skipEffectRoll: true });
}
function dot(g: any, target: any, name: string, count = 1) {
  for (let i = 0; i < count; i++) target.dots.push({ canonicalStatus: name, status: name, stacks: 1, snapshotDamage: 5, sourceId: g.player.id, sourceActor: g.player, sourceLevel: 20, firstTickPhase: 99, remaining: 2 });
}
function metrics(g: any, actors: any[]) {
  const m = g.player.lastTurn;
  Object.assign(m, { damageCards: 5, buffCards: 2, defenseCards: 2, healCards: 2, drawCards: 2, spellCards: 3, cardsPlayed: 6, aoeCards: 2, apSpent: 8, damage: 3000, hpDamage: 2500, shieldGained: 1000, healing: 1000, cleanse: 1, dispel: 1, drawn: 4, endShield: 0, endHp: g.player.hp, dotsAtEnd: 2 });
  for (const a of actors) {
    m.hitsByTarget[a.id] = 4;
    m.damageByTarget[a.id] = a.maxHp * 0.3;
    m.hpDamageByTarget[a.id] = a.maxHp * 0.25;
    m.shieldBrokenByTarget[a.id] = 1;
    m.dodgesByTarget[a.id] = 1;
  }
}

// A finite, hand-written public-state basis exercises real predicates. It does
// not replace condition functions or use future RNG/hidden hand contents.
const hostileStates = ['', 'poison', 'burn', 'bleed', 'corrosion', 'curse', 'abyss', 'weak', 'wet', 'attack_up', 'defense_up', 'poison,burn', 'weak,burn', 'poison,bleed', 'wet,bleed'];
const profiles = [
  { own: 0.25, friend: 0.55, shield: 0, ownShield: 0, previousShield: 0, ownBuff: false },
  { own: 0.65, friend: 0.55, shield: 0.3, ownShield: 0, previousShield: 0, ownBuff: false },
  { own: 0.25, friend: 0.3, shield: 0.3, ownShield: 0, previousShield: 0.3, ownBuff: false },
  { own: 0.65, friend: 0.55, shield: 0.3, ownShield: 0.2, previousShield: 0.3, ownBuff: true },
  { own: 0.65, friend: 0.3, shield: 0, ownShield: 0.2, previousShield: 0, ownBuff: true },
  { own: 0.25, friend: 0.55, shield: 0.3, ownShield: 0, previousShield: 0, ownBuff: true },
];
function candidateFixture(monster: any, skill: any, profile: typeof profiles[number], hostileState: string) {
  const g = fixture([monster.id, 'mon_stone_golem', 'mon_goblin'], { skipWeakSelfBuff: false });
  const [a, front, support] = g.enemies;
  a.definition.skills = [structuredClone(skill)];
  a.hp = a.maxHp * profile.own;
  a.shield = a.maxHp * profile.ownShield;
  a.flags.lastEnemyActionWasGuard = profile.ownBuff;
  if (profile.ownBuff) { status(g, a, 'attack_up', 0.2, true); a.flags.lastEnemyActionName = '过载升温'; }
  for (const friend of [front, support]) {
    friend.definition.tags = [...tags];
    friend.hp = friend.maxHp * profile.friend;
    friend.shield = 0;
    status(g, friend, 'stun', 1);
    status(g, friend, 'healing_received_down', 0.25);
    dot(g, friend, 'poison', 2);
  }
  front.definition.roleKey = 'guardian';
  support.definition.roleKey = /fighter\/striker\/bruiser|攻击型队友/.test(skill.condition + (skill.targetSelection || '')) ? 'striker' : 'healer';
  support.hp = support.maxHp * Math.min(profile.friend, 0.5);
  g.player.shield = g.player.maxHp * profile.shield;
  if (skill.condition.includes('SPD高于自身')) g.player.stats.speed = a.stats.speed + 20;
  if (skill.condition.includes('SPD不高于自身')) g.player.stats.speed = a.stats.speed - 20;
  for (const name of hostileState.split(',').filter(Boolean)) {
    if (['poison', 'burn', 'bleed', 'corrosion', 'curse', 'abyss'].includes(name)) dot(g, g.player, name);
    else status(g, g.player, name, 0.15, ['attack_up', 'defense_up'].includes(name));
  }
  metrics(g, g.enemies);
  g.player.lastTurn.endShield = g.player.maxHp * profile.previousShield;
  if (skill.effects.some((e: any) => effectKind(e) === 'recorded_counter')) {
    const record = { targetId: g.player.id, casterId: a.id, sourceAttack: a.stats.attack, sourceLevel: a.level, flat: 20, atk: 1.4, scale: a.damageScale, validPlayerRound: g.round, sourceSkill: 'fixture_prepare' };
    a.flags.pendingCounter = record;
    a.flags.counterPreparation = record;
    status(g, a, 'counter_preparation', 1, true);
  }
  return g;
}

describe('重置版普通/精英怪的状态驱动AI', () => {
  it('全部97怪、868技能具备已知条件、目标选择器与效果执行器', () => {
    expect(catalog.monsters).toHaveLength(97);
    expect(catalog.monsters.reduce((n: number, m: any) => n + m.skills.length, 0)).toBe(868);
    const coverage = validateEnemyCatalog(catalog);
    expect(coverage.unsupported).toEqual([]);
    expect(coverage.skills).toBe(868);
  });

  it('逐技能用真实公开状态使全部868项选择条件可达，随后执行锁定技能', () => {
    const unreachable: string[] = [];
    let executed = 0;
    for (const monster of catalog.monsters) for (const skill of monster.skills) {
      let found: any = null;
      for (const profile of profiles) {
        for (const hostileState of hostileStates) {
          const g = candidateFixture(monster, skill, profile, hostileState);
          const a = g.enemies[0];
          if (planEnemy(g, a).skillId === skill.id) { found = g; break; }
        }
        if (found) break;
      }
      if (!found) { unreachable.push(`${monster.id}/${skill.id}: ${skill.condition}`); continue; }
      const a = found.enemies[0];
      const result = actEnemy(found, a);
      expect(result, skill.id).toBeDefined();
      const action = [...found.trace].reverse().find((event: any) => event.type === 'enemy_action');
      expect(action?.executed, skill.id).toBe(skill.id);
      for (const actor of [found.player, ...found.enemies]) {
        expect(Number.isFinite(actor.hp), skill.id).toBe(true);
        expect(Number.isFinite(actor.shield), skill.id).toBe(true);
      }
      executed++;
    }
    expect(unreachable).toEqual([]);
    expect(executed).toBe(868);
  }, 30000);

  it('真实上线策略跳过57个低收益纯自强化，而不删除这批重置定义', () => {
    const skipped = catalog.monsters.flatMap((m: any) => m.skills.filter(isWeakSelfBuff));
    expect(skipped).toHaveLength(57);
    for (const m of catalog.monsters) {
      const g = fixture([m.id]);
      g.enemies[0].hp *= 0.2;
      const selected = planEnemy(g, g.enemies[0]);
      expect(isWeakSelfBuff(selected.skill)).toBe(false);
    }
  });

  it('选招不会读取随机数或尚未打出的玩家手牌，重复计划结果稳定', () => {
    const g = fixture(['mon_goblin', 'mon_stone_golem', 'mon_giant_rat']);
    const forbidden = () => { throw Error('AI读取了随机数'); };
    g.rng = forbidden; g.hitRng = forbidden; g.effectRng = forbidden; g.critRng = forbidden;
    Object.defineProperty(g.player, 'hand', { get() { throw Error('AI读取了手牌'); } });
    const first = planEnemies(g).map((i: any) => [i.skillId, i.targetId]);
    delete g.enemyAI;
    const second = planEnemies(g).map((i: any) => [i.skillId, i.targetId]);
    expect(second).toEqual(first);
  });

  it('玩家本轮改变状态也不会令锁定技能暗换为另一高优先级招式', () => {
    const g = fixture(['mon_goblin']);
    const a = g.enemies[0];
    planEnemy(g, a);
    const announced = a.intent.skillId;
    a.hp = a.maxHp * 0.1;
    g.player.thisTurn.cardsPlayed = 20;
    g.player.thisTurn.damageCards = 20;
    g.player.thisTurn.healing = 9999;
    g.player.shield = g.player.maxHp * 0.6;
    actEnemy(g, a);
    const event = [...g.trace].reverse().find((e: any) => e.type === 'enemy_action');
    expect(event.announced).toBe(announced);
    expect(event.executed === announced || /__fallback_(attack|guard)$/.test(event.executed)).toBe(true);
  });

  it('主动单体攻击遵循玩家同伴嘲讽且只扣同伴生命', () => {
    const g = fixture(['mon_goblin']);
    const pet = actor('ally:guard', 'player', 20, { ...g.player.stats, hp: 1500 });
    pet.slot = 1; g.allies.push(pet);
    status(g, pet, 'taunt', 1, true);
    const a = g.enemies[0];
    const basic = a.definition.skills.find((s: any) => s.condition === '总是' && s.effects.some((e: any) => effectKind(e) === 'damage'));
    a.definition.skills = [basic];
    planEnemy(g, a);
    const playerHP = g.player.hp;
    actEnemy(g, a);
    expect(g.player.hp).toBe(playerHP);
    expect(pet.hp).toBeLessThan(pet.maxHp);
  });
});

function restrict(a: any, suffix: string) {
  const skill = a.definition.skills.find((s: any) => s.id.endsWith(suffix));
  if (!skill) throw Error(`缺少测试技能 ${a.definition.id}/${suffix}`);
  a.definition.skills = [skill];
  return skill;
}

describe('重置版怪物协作与执行边界', () => {
  it('队友强化不受敌方抵抗或效果命中影响，同时占一整次主要行动', () => {
    const g = fixture(['mon_goblin', 'mon_stone_golem', 'mon_giant_rat']);
    const a = g.enemies[0]; restrict(a, '__skill_6');
    for (const friend of g.enemies) friend.stats.res = 80;
    g.effectRng = () => { throw Error('友方增益不应骰敌对效果命中'); };
    const announced = planEnemy(g, a);
    const hp = g.player.hp;
    actEnemy(g, a);
    expect(g.player.hp).toBe(hp);
    const targets = announced.effectTargets[0].targetIds;
    expect(targets).toHaveLength(2);
    expect(targets.every((id: string) => g.hasStatus(g.enemies.find((x: any) => x.id === id), 'attack_up'))).toBe(true);
    expect(g.trace.filter((e: any) => e.type === 'enemy_action')).toHaveLength(1);
  });

  it('治疗锁定生命最低的合法队友，目标死亡后公开防御，不改治别人或换强攻', () => {
    const g = fixture(['mon_water_sprite', 'mon_stone_golem', 'mon_goblin']);
    const [healer, tank, support] = g.enemies; restrict(healer, '__skill_9');
    tank.hp *= 0.2; support.hp *= 0.4;
    planEnemy(g, healer);
    expect(healer.intent.targetId).toBe(tank.id);
    tank.hp = 0;
    const supportHP = support.hp, playerHP = g.player.hp;
    actEnemy(g, healer);
    expect(support.hp).toBe(supportHP);
    expect(g.player.hp).toBe(playerHP);
    expect(healer.shield).toBeGreaterThan(0);
    expect([...g.trace].reverse().find((e: any) => e.type === 'enemy_action').executed).toMatch(/__fallback_guard$/);
  });

  it('重复治疗共享施放者与受益者战斗总预算，耗尽后不再选择治疗', () => {
    const g = fixture(['mon_water_sprite', 'mon_stone_golem']);
    const [healer, target] = g.enemies; const skill = restrict(healer, '__skill_9');
    let total = 0;
    for (let i = 0; i < 18; i++) {
      target.hp = target.maxHp * 0.1;
      const hp = target.hp;
      planEnemy(g, healer);
      actEnemy(g, healer);
      total += target.hp - hp;
      g.round += 3;
    }
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(healer.maxHp * 0.36 + 1e-7);
    expect(total).toBeLessThanOrEqual(target.maxHp * 0.30 + 1e-7);
    expect(g.healBudgetRemaining(healer, target)).toBeCloseTo(0);
    expect(planEnemy(g, healer).skillId).not.toBe(skill.id);
  });

  it('治疗与嘲讽遵循CD3，嘲讽不能连续覆盖且授予者不会额外普攻', () => {
    const g = fixture(['mon_stone_golem', 'mon_goblin']);
    const [tank, support] = g.enemies; support.hp *= 0.5;
    const skill = restrict(tank, '__skill_8');
    expect(planEnemy(g, tank).skillId).toBe(skill.id);
    const hp = g.player.hp;
    actEnemy(g, tank);
    expect(g.player.hp).toBe(hp);
    expect(g.hasStatus(tank, 'taunt')).toBe(true);
    expect(tank.cooldowns[skill.cooldownGroup]).toBe(5);
    g.round = 3;
    expect(planEnemy(g, tank).skillId).not.toBe(skill.id);
    actEnemy(g, tank);
    expect(g.hasStatus(tank, 'taunt')).toBe(false);
    g.round = 4;
    expect(planEnemy(g, tank).skillId).not.toBe(skill.id);
    actEnemy(g, tank);
    g.round = 5;
    expect(planEnemy(g, tank).skillId).toBe(skill.id);
  });

  it('净化按强控而非最低HP优先，净化占动作且没有免费伤害', () => {
    const g = fixture(['mon_water_sprite', 'mon_stone_golem', 'mon_goblin']);
    const [caster, stunned, poisoned] = g.enemies; restrict(caster, '__skill_8');
    stunned.hp *= 0.8; poisoned.hp *= 0.2;
    status(g, stunned, 'stun', 1); dot(g, poisoned, 'poison', 2);
    expect(planEnemy(g, caster).targetId).toBe(stunned.id);
    const hp = g.player.hp;
    actEnemy(g, caster);
    expect(g.hasStatus(stunned, 'stun')).toBe(false);
    expect(poisoned.dots).toHaveLength(2);
    expect(g.player.hp).toBe(hp);
  });

  it('纯减益忽略嘲讽和速度骰，附带减益则在直接攻击未命中时不施加', () => {
    const g = fixture(['mon_goblin']);
    const a = g.enemies[0], companion = actor('ally:guard', 'player', 20, { ...g.player.stats, hp: 1500 });
    companion.slot = 1; g.allies.push(companion); status(g, companion, 'taunt', 1, true);
    restrict(a, '__skill_5'); g.player.lastTurn.damageCards = 4;
    g.hitRng = () => { throw Error('纯减益不能判速度'); };
    planEnemy(g, a); actEnemy(g, a);
    expect(g.hasStatus(g.player, 'weak')).toBe(true);
    expect(g.hasStatus(companion, 'weak')).toBe(false);
    const missed = fixture(['mon_goblin']); restrict(missed.enemies[0], '__skill_1');
    missed.hitRng = () => 0;
    missed.player.stats.speed = 1000;
    missed.effectRng = () => { throw Error('直击未命中不能再判附带效果'); };
    planEnemy(missed, missed.enemies[0]); actEnemy(missed, missed.enemies[0]);
    expect(missed.player.hp).toBe(missed.player.maxHp);
    expect(missed.player.dots).toHaveLength(0);
  });

  it('群攻对玩家与同伴分别判命中，攻击未命中的目标不会串用另一目标结果', () => {
    // Ordinary reset entries currently use single-target direct attacks. Derive
    // an all-enemy adapter fixture to cover multiplayer routing used by Bosses/custom content.
    const monster = definitions.get('mon_goblin');
    const skill = structuredClone(monster.skills.find((s: any) => s.id.endsWith('__skill_2')));
    skill.target = 'all_enemies';
    skill.targetSelection = '范围按相对施放者阵营选择，禁止命中相反阵营';
    for (const e of skill.effects) { e.target = 'all_enemies'; e.targetSelection = skill.targetSelection; e.totalMultiplierCap = 2; }
    const g = candidateFixture(monster, skill, profiles[1]!, '');
    const a = g.enemies[0], companion = actor('ally:second', 'player', 20, { ...g.player.stats, hp: 2000 });
    companion.slot = 1; g.allies.push(companion);
    g.player.stats.speed = 1000; companion.stats.speed = 1000;
    const rolls = [0, 1]; let n = 0;
    g.hitRng = () => rolls[n++ % 2];
    planEnemy(g, a);
    const hp = g.player.hp;
    actEnemy(g, a);
    expect(g.player.hp).toBe(hp);
    expect(companion.hp).toBeLessThan(companion.maxHp);
    expect(n).toBe(2);
  });
});
