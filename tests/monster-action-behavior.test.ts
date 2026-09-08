import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { BattleRepository } from '@/storage/repositories/battle-repository';
import { GameRepository } from '@/storage/repository';
import * as runtime from '../src/battle/rework/runtime/api.mjs';
import { planEnemy } from '../src/battle/rework/runtime/enemies.mjs';
import { planBoss } from '../src/battle/rework/runtime/bosses.mjs';

const databases: CaelianDatabase[] = [];
afterEach(async () => {
  localStorage.clear();
  await Promise.all(databases.splice(0).map(async database => { database.close(); await database.delete(); }));
});
async function started(monsterId: string) {
  const database = new CaelianDatabase('alpha', `caelian-monster-contract-${crypto.randomUUID()}`);
  databases.push(database);
  const game = new GameRepository(database, new EventBus());
  const profile = await game.ensureProfile(`chat:monster-contract:${crypto.randomUUID()}`);
  await game.execute(profile.id, { id: crypto.randomUUID(), type: 'player.create', payload: { name: '重置战斗测试', classMain: 'knight', subclass: 'holy_knight' } });
  const battles = new BattleRepository(database, () => 0.5);
  await battles.prepare(); await battles.start(profile.id, { monsterId, count: 1 });
  const session = (await database.battleSessions.where('profileId').equals(profile.id).first())!;
  expect(session.state.rework).toBeDefined();
  const core = runtime.hydrate(session.state.rework);
  core.player.hp = core.player.maxHp = 1000;
  core.player.stats.hp = 1000; core.player.shield = 0; core.player.stats.defense = 0; core.player.stats.speed = 1;
  return { database, profile, battles, session, core };
}
async function save(x: Awaited<ReturnType<typeof started>>) {
  runtime.project(x.core, x.session.state); await x.database.battleSessions.put(x.session);
}
async function ended(x: Awaited<ReturnType<typeof started>>) {
  await x.battles.endTurn(x.profile.id, x.session.id);
  const session = (await x.database.battleSessions.get(x.session.id))!;
  return { state: session.state, core: runtime.hydrate(session.state.rework) };
}

// New contract: persisted public-state plans and actual reset effects. There is
// intentionally no call to legacy private chooseIntent, weights or patterns.
describe('正式怪物AI的公开状态与持久化契约', () => {
  it('开始战斗即保存重置技能意图，重新读取不会重新随机选招', async () => {
    const x = await started('mon_goblin');
    const a = x.core.enemies[0];
    expect(a.intent.skillId).toMatch(/^mon_goblin__reset_/);
    const before = JSON.parse(JSON.stringify(a.intent));
    await save(x);
    const restored = runtime.hydrate((await x.database.battleSessions.get(x.session.id))!.state.rework);
    expect(restored.enemies[0].intent).toEqual(before);
    expect(x.session.state.enemies[0]!.intent?.description).not.toContain('[object Object]');
  });

  it('上个玩家阶段攻击行为驱动禁页封印，锁定后不暗换技能', async () => {
    const x = await started('mon_library_mimic'), a = x.core.enemies[0];
    x.core.player.lastTurn.damageCards = 4;
    expect(planEnemy(x.core, a).skillId).toBe('mon_library_mimic__reset_2');
    const locked = a.intent.skillId;
    x.core.player.thisTurn.damageCards = 20; a.hp = a.maxHp * 0.2;
    await save(x); const result = await ended(x);
    expect(result.state.log.some(entry => entry.text.includes('禁页封印'))).toBe(true);
    expect(result.core.enemies[0].flags.enemySkillUses[locked]).toBe(1);
    expect(result.core.player.hp).toBe(1000); // Pure debuff consumed the major action.
  });

  it('满血与无减益时治疗者不浪费治疗/净化，存在伤员时计划真实治疗', async () => {
    const x = await started('mon_water_sprite'), a = x.core.enemies[0];
    const healthy = planEnemy(x.core, a);
    expect(healthy.skill.effects.every((e: any) => !['heal', 'cleanse'].includes(e.type))).toBe(true);
    a.hp = a.maxHp * 0.6;
    const hurt = planEnemy(x.core, a);
    expect(hurt.skillId).toBe('mon_water_sprite__reset_2');
    const hp = a.hp; await save(x); const result = await ended(x);
    expect(result.core.enemies[0].hp).toBeGreaterThan(hp);
    expect(result.core.player.hp).toBe(1000);
  });
});

describe('正式重置技能经过BattleRepository.endTurn结算', () => {
  it('生命汲取按实际扣除生命的25%回复，吸血与攻击共用一次行动', async () => {
    const x = await started('mon_werewolf'), a = x.core.enemies[0];
    a.hp = 500; a.maxHp = a.stats.hp = 1000; a.stats.attack = 20;
    x.core.addStatus(a,a,{kind:'buff',status:'swift',turns:3});x.core.addDot(a,x.core.player,{kind:'dot',status:'bleed',atk:0,baseChance:100},{skipEffectRoll:true});
    expect(planEnemy(x.core, a).skillId).toBe('mon_werewolf__reset_3');
    await save(x); const result = await ended(x), loss = 1000 - result.core.player.hp;
    expect(loss).toBeGreaterThan(0);
    expect(result.core.enemies[0].hp - 500).toBeCloseTo(loss * 0.25, 6);
    expect(result.state.log.some(entry => entry.text.includes('月下连噬'))).toBe(true);
  });

  it('生命汲取只打到护盾时不能虚构吸血回复', async () => {
    const x = await started('mon_werewolf'), a = x.core.enemies[0];
    a.hp = 500; a.maxHp = a.stats.hp = 1000; a.stats.attack = 20; x.core.player.shield = 500;
    x.core.addStatus(a,a,{kind:'buff',status:'swift',turns:3});x.core.addDot(a,x.core.player,{kind:'dot',status:'bleed',atk:0,baseChance:100},{skipEffectRoll:true});
    expect(planEnemy(x.core, a).skillId).toBe('mon_werewolf__reset_3');
    await save(x); const result = await ended(x);
    expect(result.core.player.hp).toBe(1000);
    expect(result.core.enemies[0].hp).toBe(500);
  });

  it('空心圣像缺少术证时预告神谕，施加易伤并提供可驱散攻击增益', async () => {
    const x = await started('boss_solavia_hollow_saint'), a = x.core.enemies[0];
    x.core.addStatus(x.core.player, x.core.player, { kind: 'buff', status: 'attack_up', value: 0.2, valueUnit: 'ratio', turns: 5, dispellable: true });
    x.core.addStatus(x.core.player, x.core.player, { kind: 'buff', status: 'speed_up', value: 0.1, valueUnit: 'ratio', turns: 5, dispellable: true });
    a.flags.boss.last.addedBuffs = 2;
    expect(planBoss(x.core, a).skillId).toBe('decree');
    await save(x); const result = await ended(x);
    expect(result.core.hasStatus(result.core.player, 'attack_up')).toBe(true);
    expect(result.core.hasStatus(result.core.enemies[0], 'attack_up')).toBe(true);
    expect(result.core.hasStatus(result.core.player, 'vulnerable')).toBe(true);
    expect(result.core.hasStatus(result.core.player, 'speed_up')).toBe(true);
    expect(result.state.log.some(entry => entry.text.includes('伪神谕令'))).toBe(true);
  });

  it('利维坦开战生成可选真实部位，尾鳍先预告蓄势，下次行动才横扫', async () => {
    const x = await started('boss_abyssal_leviathan_fragment');
    const tentacle = x.core.enemies.find((a: any) => a.definition.id === 'leviathan_tentacle');
    const tail = x.core.enemies.find((a: any) => a.definition.id === 'leviathan_tail');
    expect(tentacle.hp).toBeGreaterThan(0); expect(tail.hp).toBeGreaterThan(0);
    expect(tail.intent.skillId).toBe('tail_prepare');
    await save(x); const result = await ended(x);
    const restoredTail = result.core.enemies.find((a: any) => a.id === tail.id);
    expect(restoredTail.intent.skillId).toBe('tail_sweep');
    expect(restoredTail.flags.charged).toBe('tail_sweep');
    expect(result.state.enemies.find(a => a.id === tail.id)?.intent?.name).toBe('深海横扫');
  });
});
