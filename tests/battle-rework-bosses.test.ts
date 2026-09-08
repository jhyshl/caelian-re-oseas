import { describe, expect, it } from 'vitest';
import { catalog, actor, makeGame, makeTurnMetrics } from '../src/battle/rework/runtime/physics.mjs';
import { initBosses, planBoss, actBoss, contextActions, contextAction, recordBossPlayerCard } from '../src/battle/rework/runtime/bosses.mjs';
import { createPlayerController } from '../src/battle/rework/runtime/common-player.mjs';
import { snapshot, hydrate } from '../src/battle/rework/runtime/api.mjs';

function fixture(index: number) {
  const definition = structuredClone(catalog.bosses[index]);
  const p = actor('player', 'player', 20, { hp: 20000, attack: 100, defense: 100, speed: 100, crit: 0, critDamage: 50, ehr: 0, res: 0 });
  p.ap = 20; p.apMax = 20; p.drawCount = 3;
  const a = actor(definition.id, 'enemy', 20, definition.statsAt20, definition); a.slot = 0;
  const g = makeGame(p, [a], { seed: 17, trace: true, patch: {} }); g.catalog = catalog; g.round = 1; g.phase = 'player';
  // Valid generic player state is needed when API hydrate rewires class hooks.
  g.cardCatalog = new Map(catalog.cards.map((c: any) => [c.id, c]));
  g.controller = createPlayerController(); g.controller.init(g, { id: 'research' }, []);
  initBosses(g);
  return { g, a, p, s: a.flags.boss };
}
function next(g: any) {
  for (const a of [...g.allies, ...g.enemies]) { a.lastTurn = a.thisTurn; a.thisTurn = makeTurnMetrics(); }
  g.round++; g.phase = 'player'; g.player.ap = 20;
}
function lock(g: any, a: any, id: string) {
  const skill = a.definition.skills.find((s: any) => s.id === id);
  if (!skill) throw Error('Unknown test skill ' + id);
  a.intent = { skillId: id, skillName: skill.name, skill: structuredClone(skill), effectTargets: skill.effects.map((e: any) => ({ effect: structuredClone(e), targetIds: [e.target === 'self' ? a.id : e.target === 'ally' ? a.flags.bossHelper?.ownerId || a.id : g.player.id] })), round: g.round, isMajor: !!skill.isMajor, scale: 1, targetId: skill.target === 'self' ? a.id : skill.target === 'ally' ? a.flags.bossHelper?.ownerId || a.id : g.player.id };
  return a.intent;
}
function makeHelpers(index: number) {
  const x = fixture(index), { g, a } = x;
  if (index === 1) { planBoss(g, a); lock(g, a, 'lantern'); actBoss(g, a); next(g); planBoss(g, a); lock(g, a, 'guard'); actBoss(g, a); }
  if (index === 3) { planBoss(g, a); lock(g, a, 'crown'); actBoss(g, a); }
  if (index === 5) { planBoss(g, a); lock(g, a, 'servant'); actBoss(g, a); }
  next(g); planBoss(g, a);
  return x;
}

describe('8个重置Boss的技能与状态机', () => {
  it('44项本体技能均可由真实状态计划并执行，12项助手技能都有执行路径', () => {
    let planned = 0, executed = 0, helpers = 0;
    for (let index = 0; index < 8; index++) for (const skill of catalog.bosses[index].skills) {
      const { g, a, s, p } = fixture(index); planBoss(g, a);
      for (const other of a.definition.skills) a.cooldowns[other.id] = other.id === skill.id ? 0 : 999;
      const id = skill.id;
      if (index === 0) { s.nextExamRound = 99; p.lastTurn.damageCards = 4; p.lastTurn.hitsByTarget[a.id] = 3; a.hp *= 0.5; if (id === 'exam') s.nextExamRound = 1; if (id === 'restart') g.addStatus(p,a,{kind:'debuff',status:'armor_break',value:.3,turns:3},{skipEffectRoll:true}); }
      if (index === 1) { a.hp *= 0.4; s.R = id === 'reckoning' ? 2 : id === 'lantern' ? -2 : 0; }
      if (index === 1 && id === 'whisper') { lock(g,a,'lantern'); actBoss(g,a); next(g); for(const skill of a.definition.skills)a.cooldowns[skill.id]=skill.id==='whisper'?0:999; }
      if (index === 2) { a.hp *= 0.5; s.last.addedBuffs = 2; if (id === 'verdict') s.collectRound = -1; if (id === 'crack') s.mode = 'complete'; }
      if (index === 2 && id === 'struggle') { s.mode='exposed'; s.exposureEnd=99; }
      if (index === 3) { s.phase = id === 'high' ? 1 : id === 'ebb' ? 2 : id === 'crown' ? 0 : 3; a.hp *= 0.4; p.lastTurn.healing = p.maxHp * 0.2; }
      if (index === 4) { a.hp *= 0.5; p.lastTurn.drawn = 3; p.lastTurn.hitsByTarget[a.id] = 4; s.M = id === 'trample' ? 4 : id === 'bloom' ? 2 : 1; }
      if (index === 5) { a.hp *= 0.4; s.last.offenseAP = 6; s.last.defenseAP = 4; s.last.maxHit = a.maxHp * 0.2; s.C = id === 'copy' ? 2 : 0; }
      if (index === 6) { a.hp *= 0.6; s.Q = id === 'overload' ? 85 : id === 'shell' ? 30 : 50; s.ventPending = id === 'vent'; p.lastTurn.endShield = p.maxHp * 0.3; }
      if (index === 7) { p.lastTurn.shieldGained = p.maxHp * 0.3; p.lastTurn.damageCards = 5; a.hp *= 0.4; if (['regrow', 'devour', 'devour_hit'].includes(id)) for (const h of g.enemies.filter((x: any) => x.flags.bossHelper)) g.rawHit(p, h, h.hp + 9999, {}); if (id === 'devour_hit') s.charged = 'devour_hit'; }
      if (index === 7 && id === 'blackwater') { const h=g.enemies.find((h:any)=>h.definition.id==='leviathan_tentacle');g.rawHit(p,h,h.hp+1,{});s.last.hpDamageByTarget[a.id]=a.maxHp*.2; }
      if (index === 7 && id === 'devour') { g.round=2;s.round=2; }
      expect(planBoss(g, a).skillId, `${a.id}/${id}`).toBe(id); planned++;
      actBoss(g, a); expect(Number.isFinite(p.hp), id).toBe(true); executed++;
    }
    for (let index = 0; index < 8; index++) {
      const { g, a } = makeHelpers(index);
      for (const h of g.enemies.filter((x: any) => x.flags.bossHelper)) for (const skill of h.definition.skills) {
        a.hp = a.maxHp * 0.2; lock(g, h, skill.id); actBoss(g, h); expect(Number.isFinite(h.hp)).toBe(true); helpers++; next(g);
      }
    }
    expect(planned).toBe(44); expect(executed).toBe(44); expect(helpers).toBe(13);
  });

  it('12项助手技能的独立规划条件均可达，CD、嘲讽和治疗占动作', () => {
    let planned = 0;
    for (let index = 0; index < 8; index++) {
      const { g, a } = makeHelpers(index);
      for (const h of g.enemies.filter((x: any) => x.flags.bossHelper)) for (const skill of h.definition.skills) {
        for (const other of h.definition.skills) h.cooldowns[other.id] = other.id === skill.id ? 0 : 999;
        g.teamTauntUntil.enemy = 0; for (const x of g.enemies) x.buffs = x.buffs.filter((e: any) => e.canonicalStatus !== 'taunt');
        a.hp = a.maxHp * (['soul_heal', 'tentacle_heal'].includes(skill.id) ? 0.2 : 0.8);
        h.flags.charged = skill.id === 'tail_sweep' ? 'tail_sweep' : null;
        if (skill.id === 'tail_prepare') h.cooldowns.tail_sweep = 0;
        expect(planBoss(g, h).skillId).toBe(skill.id); planned++;
      }
    }
    expect(planned).toBe(13);
  });

  it('全部9种场景动作可实际付AP执行，不产生职业资源，窗口/次数正确', () => {
    let actions = 0;
    for (let index = 0; index < 8; index++) {
      const { g, a, s, p } = fixture(index);
      if (index === 3) s.phase = 1;
      if (index === 4) s.M = 4;
      if (index === 5) s.C = 2;
      if (index === 6) s.Q = 85;
      if (index === 7) s.charged = 'devour_hit';
      planBoss(g, a);
      for (const action of contextActions(g)) {
        expect(action.enabled, action.name).toBe(true);
        const ap = p.ap, resources = structuredClone(p.resources);
        contextAction(g, action.id); expect(p.ap).toBe(ap - action.ap); expect(p.resources).toEqual(resources); actions++;
        if (!action.limit.includes('最多2次')) expect(contextActions(g).find((c: any) => c.id === action.id).enabled).toBe(false);
      }
    }
    expect(actions).toBe(9);
  });

  it('魔像守势答对先减半电流，第2/4次校准不重复，考试计划不因中途低血追加', () => {
    const { g, a, s } = fixture(0); planBoss(g, a); expect(a.intent.skillId).toBe('exam');
    const exam = a.intent.exam; expect(exam.guardThreshold).toBe(90); expect(exam.healThreshold).toBe(75);
    contextAction(g, '标准防御'); actBoss(g, a); expect(s.examPasses).toBe(1); expect(s.nextExamRound).toBe(4);
    next(g); g.addStatus(g.player,a,{kind:'debuff',status:'armor_break',value:.3,turns:3},{skipEffectRoll:true}); planBoss(g, a); expect(a.intent.skillId).toBe('restart'); actBoss(g, a); expect(g.hasStatus(a,'armor_break')).toBe(false);expect(a.shield).toBeGreaterThan(0);
    next(g); a.hp = a.maxHp * 0.2; planBoss(g, a); expect(a.intent.skillId).not.toBe('exam'); expect(a.intent.skillId).not.toBe('restart');
  });

  it('守望者反噬先检查R，安魂降至1后使用固定低伤并清零，不根据玩家伤害反弹', () => {
    const high = fixture(1), low = fixture(1);
    for (const x of [high, low]) { x.s.R = 3; x.g.hitRng = () => 1; planBoss(x.g, x.a); }
    contextAction(low.g, '安魂'); contextAction(low.g, '安魂');
    const h1 = high.p.hp, h2 = low.p.hp; actBoss(high.g, high.a); actBoss(low.g, low.a);
    expect(h1 - high.p.hp).toBeGreaterThan(h2 - low.p.hp); expect(low.s.R).toBe(0); expect(high.s.R).toBe(0);
  });

  it('圣像同卡至多一证，三证当场去保护并取消裁光，下轮开放完整暴露', () => {
    const { g, a, s, p } = fixture(2); planBoss(g, a);
    recordBossPlayerCard(g, { id: 'mixed', effects: [{ kind: 'damage' }, { kind: 'shield' }, { kind: 'debuff' }] }, { paidAP: 2, totals: { damage: 20, shield: 20, debuffs: 1 } });
    expect(s.evidence).toEqual({ weapon: true, guard: false, art: false });
    contextAction(g, '举盾作证'); contextAction(g, '辨明伪典'); expect(s.mode).toBe('complete');
    expect(a.buffs.some((e: any) => e.bossStateKey === 'saint_protection')).toBe(false);
    lock(g, a, 'verdict'); const hp = p.hp; actBoss(g, a); expect(p.hp).toBe(hp); expect(s.exposureStart).toBe(2); expect(s.exposureEnd).toBe(3);
    next(g); planBoss(g, a); expect(g.hasStatus(a, 'vulnerable')).toBe(true);
  });

  it('歌后破珠与靠岸取较强减伤不相乘，反制不打折有限削盾，退潮窗口先于攻击', () => {
    const single = fixture(3), both = fixture(3);
    for (const x of [single, both]) { x.s.phase = 1; x.s.pearlBroken = true; x.p.shield = 1000; x.g.hitRng = () => 1; planBoss(x.g, x.a); }
    contextAction(both.g, '靠岸'); actBoss(single.g, single.a); actBoss(both.g, both.a);
    expect(both.p.shield).toBeCloseTo(single.p.shield); expect(both.p.hp).toBeCloseTo(single.p.hp); expect(both.s.pearlBroken).toBe(false);
    next(both.g); planBoss(both.g, both.a); expect(both.s.phase).toBe(2); expect(gain(both.a, 'ebb')).toBe(true);
  });

  it('白鹿梦踏低伤反制有效，两条分支在阶段结束后都精确M=1，不追加自然增长', () => {
    for (const counter of [false, true]) {
      const { g, a, s } = fixture(4); s.M = 4; planBoss(g, a); if (counter) contextAction(g, '清醒');
      s.turn.cards = 8; actBoss(g, a); expect(s.M).toBe(1);
      next(g); planBoss(g, a); expect(a.intent.skillId).not.toBe('trample');
    }
  });

  it('镜公爵0AP不充能，实付AP只归一族；抹痕在复写前减半且清空C', () => {
    const { g, a, s } = fixture(5); s.recordFamily = 'offense'; s.C = 2; planBoss(g, a);
    recordBossPlayerCard(g, { id: 'zero', effects: [{ kind: 'damage' }] }, { paidAP: 0, totals: { damage: 10 } }); expect(s.turn.offenseAP).toBe(0);
    recordBossPlayerCard(g, { id: 'mixed', effects: [{ kind: 'damage' }, { kind: 'shield' }] }, { paidAP: 4, totals: { damage: 10, shield: 10 } });
    expect(s.turn.offenseAP).toBe(4); expect(s.turn.defenseAP).toBe(0); contextAction(g, '抹去镜痕'); actBoss(g, a); expect(s.C).toBe(0);
  });

  it('熔炉完整过载阶段结束精确Q=20并空转；降温低伤分支不获过载暴露', () => {
    const full = fixture(6), low = fixture(6);
    for (const x of [full, low]) { x.s.Q = 85; x.g.hitRng = () => 1; planBoss(x.g, x.a); }
    contextAction(low.g, '泄压阀'); actBoss(full.g, full.a); actBoss(low.g, low.a);
    expect(full.s.Q).toBe(20); expect(gain(full.a, 'overload_exposure')).toBe(true);expect(full.a.shield).toBe(0);
    expect(gain(low.a, 'overload_exposure')).toBe(false); expect(low.s.ventPending).toBeFalsy();
    next(full.g); planBoss(full.g, full.a); expect(full.a.intent.skillId).toBe('flame');
  });

  it('利维坦部位有实际HP和独立行动，打头可胜；再生固定最早死亡部位且仅50%HP', () => {
    const { g, a, s, p } = fixture(7); const [tentacle, tail] = g.enemies.filter((x: any) => x.flags.bossHelper);
    expect(tentacle.maxHp).toBeCloseTo(Math.round(a.maxHp * 0.16)); expect(tail.maxHp).toBeCloseTo(Math.round(a.maxHp * 0.18));
    g.rawHit(p, tail, tail.hp + 9999, {}); g.rawHit(p, tentacle, tentacle.hp + 9999, {}); a.hp = a.maxHp * 0.4;
    planBoss(g, a); expect(a.intent.skillId).toBe('regrow'); expect(a.intent.regrowTarget).toBe(tail.id); actBoss(g, a);
    expect(tail.hp).toBe(tail.maxHp * 0.5); expect(tentacle.hp).toBe(0); expect(s.spawnCounts.leviathan_tail).toBe(1);
    g.rawHit(p, a, a.hp + 99999, {}); expect(g.enemies.every((x: any) => x.hp <= 0)).toBe(true);
  });

  it('魂灯真实治疗4%头领HP且次数/总预算受限，触须护首驱散后只恢复15%', () => {
    const x = makeHelpers(1), lantern = x.g.enemies.find((a: any) => a.definition.id === 'grave_lantern');
    x.a.hp = x.a.maxHp * 0.2; lock(x.g, lantern, 'soul_heal'); const hp = x.a.hp; actBoss(x.g, lantern); expect(x.a.hp - hp).toBeCloseTo(x.a.maxHp * 0.04);
    const l = fixture(7), tentacle = l.g.enemies[1]; expect(l.g.incomingReduction(l.a)).toBe(0.15); l.g.dispel(l.a, 1); expect(l.g.incomingReduction(l.a)).toBe(0);
    lock(l.g, tentacle, 'tentacle_taunt'); actBoss(l.g, tentacle); expect(l.g.incomingReduction(l.a)).toBe(0.15);
  });

  it('JSON存档恢复保持锁定意图、强控延后、原始目标、场景使用次数与随机序列', () => {
    const { g, a, s, p } = fixture(4); s.M = 4; planBoss(g, a);
    g.addStatus(p, a, { kind: 'debuff', status: 'freeze', turns: 1, baseChance: 100 }, { skipEffectRoll: true });
    expect(actBoss(g, a).delayed).toBe(true); next(g); planBoss(g, a); contextAction(g, '清醒');
    const restored = hydrate(JSON.parse(JSON.stringify(snapshot(g)))), b = restored.enemies[0];
    expect(b.intent.skillId).toBe('trample'); expect(b.intent.delayed).toBe(true); expect(b.flags.boss.turn.actions['清醒']).toBe(1);
    expect(b.flags.boss.M).toBe(a.flags.boss.M); const hp = restored.player.hp;
    actBoss(g, a); actBoss(restored, b);
    expect(restored.player.hp).toBeCloseTo(g.player.hp); expect(restored.player.hp).toBeLessThan(hp); expect(b.flags.boss.M).toBe(1);
    expect(b.flags.boss.delayedIntent).toBeUndefined();
  });
});
function gain(a: any, key: string) { return a.buffs.some((e: any) => e.bossStateKey === key); }
