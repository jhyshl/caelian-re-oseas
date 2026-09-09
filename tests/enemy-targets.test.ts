import {describe,expect,it} from 'vitest';
import {actor,catalog,makeGame} from '@/battle/rework/runtime/physics.mjs';
import {encounter} from '@/battle/rework/runtime/model.mjs';
import {chooseEnemyTarget,enemyTargetPool} from '@/battle/rework/runtime/enemy-targets.mjs';
import {planEnemy,actEnemy} from '@/battle/rework/runtime/enemies.mjs';
import {initBosses,planBoss,actBoss} from '@/battle/rework/runtime/bosses.mjs';
import * as api from '@/battle/rework/runtime/api.mjs';

function fixture() {
  const stats={hp:20000,attack:100,defense:100,speed:100,crit:0,critDamage:50,ehr:0,res:0};
  const party=['player','caelian','trelio','summon:1','summon:2'].map(id=>actor(id,'player',20,stats));
  const enemies=encounter([structuredClone(catalog.monsters.find((m:any)=>m.id==='mon_orc'))],20,{});
  const g=makeGame(party[0],enemies,{seed:721,trace:true});g.allies=party;g.round=1;g.phase='player';g.catalog=catalog;
  party[0].lastTurn.hpDamageByTarget[enemies[0].id]=100000;party[0].hp=200;
  enemies[0].definition.skills=enemies[0].definition.skills.filter((s:any)=>s.reset.index===0);
  return g;
}
describe('敌方单体等概率选择我方目标',()=>{
  it('玩家、剧情队友及两只玩家召唤物各占相同的随机区间，不受伤害贡献和血量影响',()=>{
    const g=fixture(),counts=Object.fromEntries(g.allies.map((a:any)=>[a.id,0]));
    for(let i=0;i<1000;i++){g.targetRng=()=>i/1000;const intent=planEnemy(g,g.enemies[0]);counts[intent.targetId]!++;}
    expect(Object.values(counts)).toEqual([200,200,200,200,200]);
  });
  it('97种普通怪和精英的基础单体技能都能选中每个我方单位',()=>{
    for(const definition of catalog.monsters)for(let i=0;i<5;i++){
      const g=fixture(),a=g.enemies[0];a.definition=structuredClone(definition);a.definition.skills=a.definition.skills.filter((s:any)=>s.reset.index===0);g.targetRng=()=> (i+.5)/5;
      const intent=planEnemy(g,a);const rows=intent.effectTargets.filter((r:any)=>r.effect.target==='enemy');
      expect(rows.length,definition.id).toBeGreaterThan(0);expect(rows.every((r:any)=>r.targetIds[0]===g.allies[i].id),definition.id).toBe(true);
    }
  });
  it('八种Boss的单体基础攻击同样等概率锁定，执行时不再次抽签',()=>{
    for(const definition of catalog.bosses)for(let i=0;i<5;i++){
      const g=fixture(),a=actor(definition.id,'enemy',20,definition.statsAt20,structuredClone(definition));g.enemies=[a];initBosses(g);
      const basic=a.definition.skills.find((s:any)=>s.priority===10&&s.effects.some((e:any)=>e.type==='damage'));
      for(const skill of a.definition.skills)if(skill.id!==basic.id)a.cooldowns[skill.id]=99;
      g.targetRng=()=> (i+.5)/5;const intent=planBoss(g,a);
      const rows=intent.effectTargets.filter((r:any)=>r.effect.target==='enemy');expect(rows.length,definition.id).toBeGreaterThan(0);
      expect(rows.every((r:any)=>r.targetIds[0]===g.allies[i].id),definition.id).toBe(true);
      g.targetRng=()=>{throw Error('announced target must stay locked');};expect(()=>actBoss(g,a)).not.toThrow();
    }
  });
  it('排除死亡及不可攻击的单位，嘲讽在计划后生效也会转移整项攻击',()=>{
    const g=fixture(),a=g.enemies[0];g.allies[3].hp=0;g.allies[4].attackable=false;
    expect(enemyTargetPool(g,a).map((x:any)=>x.id)).toEqual(['player','caelian','trelio']);
    g.targetRng=()=>0;planEnemy(g,a);g.addStatus(g.allies[2],g.allies[2],{kind:'buff',status:'taunt',turns:2});
    g.targetRng=()=>{throw Error('single taunter requires no roll');};g.hitRng=()=>1;actEnemy(g,a);
    expect(g.trace.some((e:any)=>e.type==='taunt_redirect'&&e.to==='trelio')).toBe(true);
    expect(g.trace.filter((e:any)=>e.type==='damage'&&e.source===a.id).every((e:any)=>e.target==='trelio')).toBe(true);
  });
  it('锁定目标死亡后只抽取一次新目标',()=>{
    const g=fixture(),a=g.enemies[0];g.targetRng=()=>.25;const intent=planEnemy(g,a);expect(intent.targetId).toBe('caelian');
    let rolls=0;g.allies[1].hp=0;g.targetRng=()=>{rolls++;return .6;};g.hitRng=()=>1;actEnemy(g,a);
    expect(rolls).toBe(1);expect(g.trace.some((e:any)=>e.type==='enemy_target_replaced'&&e.to==='summon:1')).toBe(true);
  });
  it('保存恢复保留选目标随机进度，并兼容没有该随机序列的旧战斗',()=>{
    const g=fixture();chooseEnemyTarget(g,g.enemies[0]);const saved=api.snapshot(g),restored=api.hydrate(saved);
    expect(Array.from({length:30},()=>chooseEnemyTarget(g,g.enemies[0]).id)).toEqual(Array.from({length:30},()=>chooseEnemyTarget(restored,restored.enemies[0]).id));
    const old:any=api.decode(saved);delete old.rngStates.targetRng;expect(()=>chooseEnemyTarget(api.hydrate(api.encode(old)),g.enemies[0])).not.toThrow();
  });
  it('玩家阶段新召唤的单位也进入本次攻击目标池，不必等到下一轮',()=>{
    const g=fixture(),a=g.enemies[0];g.targetRng=()=>0;planEnemy(g,a);
    const summon=actor('new-summon','player',20,{...g.player.stats});g.allies.push(summon);
    let rolls=0;g.targetRng=()=>{rolls++;return .99;};g.hitRng=()=>1;actEnemy(g,a);
    expect(rolls).toBe(1);expect(summon.hp).toBeLessThan(summon.maxHp);
    expect(g.trace.some((e:any)=>e.type==='enemy_target_replaced'&&e.to==='new-summon')).toBe(true);
  });
  it('嘲讽在预告后消失，恢复在全体合法目标之间等概率选择',()=>{
    const g=fixture(),a=g.enemies[0],caelian=g.allies[1];
    g.addStatus(caelian,caelian,{kind:'buff',status:'taunt',turns:2});
    expect(planEnemy(g,a).targetId).toBe('caelian');caelian.buffs=[];
    let rolls=0;g.targetRng=()=>{rolls++;return .99;};g.hitRng=()=>1;actEnemy(g,a);
    expect(rolls).toBe(1);expect(g.allies[4].hp).toBeLessThan(g.allies[4].maxHp);
  });
});
