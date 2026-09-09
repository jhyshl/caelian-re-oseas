import {describe, expect, it} from 'vitest';
import {actor, makeGame} from '@/battle/rework/runtime/physics.mjs';
import {partyTurn, CAELIAN_SKILLS, TRELIO_SKILLS} from '@/battle/rework/runtime/story-party.mjs';
import {statusGain, bestSkillTarget, effectValue} from '@/battle/rework/runtime/tactical-ai.mjs';
import {createCaelianCompanion, syncCompanionTactics} from '@/battle/caelian-companion';
import {planEnemy} from '@/battle/rework/runtime/enemies.mjs';
import type {BattlePlayerState} from '@/domain/types';

function scene(ap=5, count=1) {
  const stats={hp:1000,attack:100,defense:0,speed:100,crit:0,critDamage:50,ehr:0,res:0};
  const player=actor('player','player',20,stats),c=actor('caelian','player',20,stats),t=actor('trelio','player',20,stats);
  c.isCompanion=true;t.isCompanionSummon=true;player.ap=ap;
  const enemies=Array.from({length:count},(_,i)=>actor('enemy:'+i,'enemy',20,stats));
  const g=makeGame(player,enemies,{trace:true,seed:41});g.allies.push(c,t);g.round=1;g.phase='player';
  g.hitRng=()=>1;g.effectRng=()=>0;g.critRng=()=>1;
  return {g,c,t,player,enemies};
}
describe('剧情队友与共享战术评估',()=>{
  it('旧战斗只迁移一次，保留生命比例、状态和重伤，不恢复倒下的特莱奥',()=>{
    const player={hpMax:1000,attack:100,defense:80,speed:150} as BattlePlayerState,c=createCaelianCompanion(20,player);
    delete c.tacticsVersion;c.hpMax=200;c.hp=50;c.summons[0]!.hp=0;c.debuffs.weak={value:10,turns:2};
    syncCompanionTactics(c,player);expect(c.hp).toBe(300);expect(c.summons[0]!.hp).toBe(0);expect(c.debuffs.weak).toBeTruthy();
    c.hp=250;syncCompanionTactics(c,{...player,hpMax:2000});expect(c.hp).toBe(250);expect(c.hpMax).toBe(1200);
  });
  it('完整继承面板战斗属性并移除吸血',()=>{
    const p={hpMax:1000,attack:100,defense:80,speed:150,critRate:30,critDamage:120,effectHit:40,effectResist:50,lifesteal:90} as BattlePlayerState;
    const c=createCaelianCompanion(20,p);
    expect(c).toMatchObject({hp:1200,hpMax:1200,attack:120,defense:96,speed:150,critRate:30,critDamage:120,effectHit:40,effectResist:50,lifesteal:0});
    expect(c.summons[0]).toMatchObject({hp:800,attack:80,defense:64,speed:120,critRate:24,critDamage:96,effectHit:32,effectResist:40,lifesteal:0});
    expect(c.actionSequence).toHaveLength(8);expect(c.summons[0]!.skills).toHaveLength(3);
  });
  it('零AP不行动，1AP由特莱奥补刀，不能绕过共享预算',()=>{
    const none=scene(0);partyTurn(none.g);expect(none.g.trace.filter((e:any)=>e.type==='party_action')).toHaveLength(0);
    const one=scene(1);one.enemies[0].hp=50;partyTurn(one.g);
    expect(one.enemies[0].hp).toBe(0);expect(one.player.ap).toBe(0);
    expect(one.g.trace.filter((e:any)=>e.type==='party_action')).toMatchObject([{source:'trelio',ap:1,apAfter:0}]);
  });
  it('危急时优先救治玩家，不对满血队友空放治疗',()=>{
    const {g,player}=scene(3);player.hp=40;partyTurn(g);
    expect(g.trace.find((e:any)=>e.type==='party_action')).toMatchObject({name:'破晓疗愈',target:'player'});
    expect(player.hp).toBe(184);
    const healthy=scene(3);partyTurn(healthy.g);
    expect(healthy.g.trace.filter((e:any)=>e.type==='party_action').some((e:any)=>e.name==='破晓疗愈')).toBe(false);
  });
  it('AOE技能按真实人数估算，更多剩余AP允许更多行动',()=>{
    const few=scene(1,3),many=scene(10,3);partyTurn(few.g);partyTurn(many.g);
    const actions=many.g.trace.filter((e:any)=>e.type==='party_action');
    expect(actions.length).toBeGreaterThan(few.g.trace.filter((e:any)=>e.type==='party_action').length);
    expect(actions.reduce((n:number,e:any)=>n+e.ap,0)).toBeLessThanOrEqual(10);
    expect(new Set(actions.map((e:any)=>e.name)).size).toBe(actions.length);
    expect(actions.some((e:any)=>['曜光裁决','圣辉镇压','震慑龙息'].includes(e.name))).toBe(true);
    const count=actions.length;partyTurn(many.g);expect(many.g.trace.filter((e:any)=>e.type==='party_action')).toHaveLength(count);
  });
  it('重伤或受控队友不能行动或参与合击',()=>{
    const {g,c,t}=scene(12);c.hp=0;g.addStatus(g.enemies[0],t,{kind:'debuff',status:'freeze',turns:1},{skipEffectRoll:true});
    partyTurn(g);expect(g.trace.filter((e:any)=>e.type==='party_action')).toHaveLength(0);expect(g.player.ap).toBe(12);
  });
  it('所有数值型技能使用固定基础值和攻击倍率，伤害源为实际施法者',()=>{
    const {g,c,enemies}=scene();
    for (const skill of [...CAELIAN_SKILLS,...TRELIO_SKILLS] as any[]) for (const effect of skill.effects) if (['damage','heal','shield'].includes(effect.kind)) {
      expect(effect.flat).toBeGreaterThan(0);expect(effect.atk).toBeGreaterThan(0);
      expect(g.calcBase(c,enemies[0],effect)).toBeCloseTo(effect.flat+effect.atk*100);
      c.stats.attack=200;expect(g.calcBase(c,enemies[0],effect)).toBeCloseTo(effect.flat+effect.atk*200);c.stats.attack=100;
    }
  });
  it('不刷新无收益的已有状态，控制免疫和命中抵抗参与评分',()=>{
    const {g,c,enemies}=scene(),e=enemies[0],buff={kind:'buff',status:'attack_up',value:.2,turns:2,target:'ally'};
    g.addStatus(c,c,{...buff,turns:4});expect(statusGain(g,c,c,buff)).toBe(0);
    expect(bestSkillTarget(g,c,{effects:[buff]})!.target.id).not.toBe('caelian');
    e.flags.controlImmuneUntil=3;const stun={kind:'debuff',status:'stun',value:1,turns:1};
    expect(effectValue(g,c,e,stun)).toBe(0);delete e.flags.controlImmuneUntil;
    const value=effectValue(g,c,e,stun);e.stats.res=80;expect(effectValue(g,c,e,stun)).toBeLessThan(value);
  });
  it('同一队伍两个施法者不重复预订同一种增益，预告不会执行时重选',()=>{
    const {g,enemies,player}=scene(5,2);
    const skills=[{id:'buff',name:'鼓舞',target:'all_allies',condition:'总是',priority:90,cooldown:0,cooldownGroup:'buff',effects:[{type:'buff',status:'attack_up',value:.2,turns:2,target:'all_allies'}]},{id:'hit',name:'攻击',target:'enemy',condition:'总是',priority:1,cooldown:0,cooldownGroup:'attack',effects:[{type:'damage',flat:20,atk:1,target:'enemy'}]}];
    for (const e of enemies) e.definition={id:e.id,name:e.id,skills:skills.map(s=>({...s,reset:{index:0,breakOn:[]}}))};
    const first=planEnemy(g,enemies[0]);const second=planEnemy(g,enemies[1]);
    expect(first.skillId).toBe('buff');expect(second.skillId).toBe('hit');
    const locked=JSON.stringify(second);player.hand=[{id:'secret'}];g.rng=()=>{throw Error('AI must not read RNG');};
    expect(JSON.stringify(enemies[1].intent)).toBe(locked);
  });
});
