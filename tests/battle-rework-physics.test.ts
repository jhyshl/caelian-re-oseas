import { describe, expect, it } from 'vitest';
import { actor, makeGame } from '../src/battle/rework/runtime/physics.mjs';
import { encounter } from '../src/battle/rework/runtime/model.mjs';
import { catalog } from '../src/battle/rework/runtime/physics.mjs';
import { encode, decode, hydrate, snapshot } from '../src/battle/rework/runtime/api.mjs';

function fixture() {
 const p=actor('player','player',20,{hp:10000,attack:100,defense:100,speed:100,crit:50,critDamage:200,ehr:20,res:0});
 const foes=[0,1,2].map(i=>actor('enemy:'+i,'enemy',20,{hp:10000,attack:100,defense:100,speed:100,crit:50,critDamage:200,ehr:0,res:20}));
 const g=makeGame(p,foes,{seed:71,trace:true});g.round=1;g.hitRng=()=>1;g.effectRng=()=>0;g.critRng=()=>1;return g;
}
const direct={kind:'damage',flat:20,atk:1,hits:1,crit:true,target:'enemy'};
describe('重置版数值物理规则',()=>{
 it('基础值加倍率，按攻击方等级减伤；总值分段一次',()=>{
  const g=fixture();g.beginAction(g.player,{id:'attack'});
  expect(g.damage(g.player,g.enemies[0],{...direct,hits:4}).damage).toBeCloseTo(120*200/300);
 });
 it('同一次群攻逐目标逐段独立掷暴击，目标命中缓存不能共用暴击',()=>{
  const g=fixture(),rolls=[.1,.9,.9,.9,.1,.1];let used=0;g.critRng=()=>rolls[used++]!;
  g.beginAction(g.player,{id:'aoe'});const results=g.enemies.map((t:any)=>g.damage(g.player,t,{...direct,hits:2}));
  expect(results.map((r:any)=>r.crits)).toEqual([1,0,2]);
  expect(results.map((r:any)=>r.damage)).toEqual([160,80,240]);expect(used).toBe(6);
 });
 it.each([1,2,3])('%s星只放大固定值和属性倍率，生命比例不放大',(star)=>{
  const g=fixture();g.player.star=star;
  const base=g.calcBase(g.player,g.enemies[0],{flat:20,atk:1,def:.5,maxHp:.01});
  expect(base).toBeCloseTo(170*(1+.1*(star-1))+100);
 });
 it('直接增伤、易伤和减伤分别封顶，暴伤上限250%',()=>{
  const g=fixture();g.player.stats.crit=100;g.player.stats.critDamage=999;g.critRng=()=>0;
  for(const [a,name,value,buff]of [[g.player,'direct_damage_up',9,true],[g.enemies[0],'vulnerable',9,false],[g.enemies[0],'direct_damage_reduction',9,true]]){
   g.addStatus(a,a,{kind:buff?'buff':'debuff',status:name,value,valueUnit:'ratio',turns:2},{skipEffectRoll:true});
  }
  g.beginAction(g.player,direct);expect(g.damage(g.player,g.enemies[0],direct).damage).toBeCloseTo(120*1.6*3.5*200/300*1.4*.4);
 });
 it('效果命中使用基础概率乘命中与抵抗，双方封顶80%',()=>{
  const g=fixture();expect(g.effectChance(g.player,g.enemies[0],{baseChance:60})).toBeCloseTo(.576);
  g.player.stats.ehr=999;g.enemies[0].stats.res=999;
  expect(g.effectChance(g.player,g.enemies[0],{baseChance:100})).toBeCloseTo(.36);
 });
 it('速度只改变相对闪避，最低0最高25%，不改变AP',()=>{
  const g=fixture();g.player.ap=7;g.player.stats.speed=1;g.enemies[0].stats.speed=10000;g.hitRng=()=>.249;
  g.beginAction(g.player,direct);expect(g.damage(g.player,g.enemies[0],direct).hit).toBe(false);
  g.hitRng=()=>.251;g.beginAction(g.player,direct);expect(g.damage(g.player,g.enemies[0],direct).hit).toBe(true);
  g.player.stats.speed=10000;g.enemies[0].stats.speed=1;g.hitRng=()=>0;
  g.beginAction(g.player,direct);expect(g.damage(g.player,g.enemies[0],direct).hit).toBe(true);expect(g.player.ap).toBe(7);
 });
 it('DOT快照攻击、不吃双爆增伤易伤，受防御与盾，目标阶段末共两跳',()=>{
  const g=fixture(),t=g.enemies[0];t.shield=10;g.player.star=3;
  g.addDot(g.player,t,{kind:'dot',status:'poison',atk:.5,baseChance:100});
  g.player.stats.attack=9999;g.player.stats.crit=100;g.critRng=()=>{throw Error('DOT must not roll crit');};
  g.addStatus(g.player,g.player,{kind:'buff',status:'direct_damage_up',value:.6,turns:10});
  g.addStatus(g.player,t,{kind:'debuff',status:'vulnerable',value:.4,turns:10},{skipEffectRoll:true});
  g.beginPhase(t);g.endPhase(t);expect(t.hp).toBeCloseTo(9970);expect(t.dots).toHaveLength(1);
  g.beginPhase(t);g.endPhase(t);expect(t.hp).toBeCloseTo(9930);expect(t.dots).toHaveLength(0);
 });
 it('同种DOT最多3层，每源每轮2层，敌方全队对每目标最多3层',()=>{
  const g=fixture(),t=g.enemies[0],e={kind:'dot',status:'poison',atk:.5,stacks:5,baseChance:100};
  g.addDot(g.player,t,e);expect(t.dots).toHaveLength(2);g.addDot(g.player,t,e);expect(t.dots).toHaveLength(2);
  g.round++;g.addDot(g.player,t,e);expect(t.dots).toHaveLength(3);
  for(const foe of g.enemies)g.addDot(foe,g.player,e);expect(g.player.dots).toHaveLength(3);
 });
 it('DOT强替弱不刷新已有更强层的剩余时间',()=>{
  const g=fixture(),t=g.enemies[0];
  for(let round=1;round<=2;round++){g.round=round;g.addDot(g.player,t,{kind:'dot',status:'poison',atk:1,stacks:2,baseChance:100});}
  t.dots.forEach((d:any)=>d.remaining=1);g.round=3;
  g.addDot(g.player,t,{kind:'dot',status:'poison',atk:.1,baseChance:100});expect(t.dots.every((d:any)=>d.remaining===1)).toBe(true);
  g.addDot(g.player,t,{kind:'dot',status:'poison',atk:2,baseChance:100});expect(t.dots.filter((d:any)=>d.snapshotDamage===200)).toHaveLength(1);
 });
 it('普通怪强控仅跳一次，随后两个行动阶段免疫',()=>{
  const g=fixture(),t=g.enemies[0],e={kind:'debuff',status:'stun',turns:2,baseChance:100};
  g.addStatus(g.player,t,e,{skipEffectRoll:true});expect(g.beginPhase(t)).toBe(false);g.endPhase(t);
  expect(g.addStatus(g.player,t,e,{skipEffectRoll:true})).toBe(false);
  expect(g.beginPhase(t)).toBe(true);g.endPhase(t);
  expect(g.addStatus(g.player,t,e,{skipEffectRoll:true})).toBe(false);
  expect(g.beginPhase(t)).toBe(true);g.endPhase(t);
  expect(g.addStatus(g.player,t,e,{skipEffectRoll:true})).toBe(true);
 });
 it('来源独立且取同类最强值，弱效果不延长强效果',()=>{
  const g=fixture(),p=g.player;
  g.addStatus(p,p,{kind:'buff',status:'attack_up',value:.5,turns:1},{skillId:'strong'});
  g.addStatus(p,p,{kind:'buff',status:'attack_up',value:.1,turns:3},{skillId:'weak'});
  expect(g.stat(p,'attack')).toBe(150);expect(p.buffs).toHaveLength(2);
  g.beginPhase(p);expect(g.stat(p,'attack')).toBeCloseTo(110);
 });
 it('护盾上限60%最大生命，己方下一阶段只保留一半',()=>{
  const g=fixture(),p=g.player;g.beginPhase(p);g.shield(p,p,99999);expect(p.shield).toBe(6000);
  g.beginPhase(p);expect(p.shield).toBe(3000);
 });
 it('群体血池与入场输出预算固定，击杀队友不提高存活怪的伤害系数',()=>{
  const defs=catalog.monsters.filter((m:any)=>m.tier==='normal').slice(0,3);
  const two=encounter(defs.slice(0,2),20),three=encounter(defs,20);
  expect(two[0].damageScale).toBe(.62);expect(three[0].damageScale).toBe(.48);
  const pool=three.reduce((n:number,a:any)=>n+a.hp,0)/two.reduce((n:number,a:any)=>n+a.hp,0);
  expect(pool).toBeCloseTo(1.5/1.25,2);three[1].hp=0;three[2].hp=0;expect(three[0].damageScale).toBe(.48);
 });
 it('JSON图快照保留来源身份、Map/Set与无限时长',()=>{
  const source:any={id:'player'},value:any={source,map:new Map(),set:new Set(),duration:Infinity};value.map.set(source,value);value.set.add(source);
  const copy=decode(JSON.parse(JSON.stringify(encode(value))));
  expect(copy.map.get(copy.source)).toBe(copy);expect(copy.set.has(copy.source)).toBe(true);expect(copy.duration).toBe(Infinity);
 });
 it('读档恢复每个随机流后与不中断的一致',()=>{
  const g=fixture();g.player.profession='holy_knight';g.player.flags.pc={catalog:new Map()};g.hitRng=makeGame(g.player,[],{seed:71}).hitRng;g.effectRng=makeGame(g.player,[],{seed:71}).effectRng;g.critRng=makeGame(g.player,[],{seed:71}).critRng;
  g.hitRng();g.critRng();const saved=snapshot(g),restored=hydrate(JSON.parse(JSON.stringify(saved)));
  expect([restored.rng(),restored.hitRng(),restored.effectRng(),restored.critRng()]).toEqual([g.rng(),g.hitRng(),g.effectRng(),g.critRng()]);
 });
});
