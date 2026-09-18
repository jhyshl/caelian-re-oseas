import {describe,it,expect} from 'vitest';
import {actor,makeGame,catalog} from '@/battle/rework/runtime/physics.mjs';
import {encode,decode} from '@/battle/rework/runtime/api.mjs';
const stats={hp:1000,attack:100,defense:120,speed:100,crit:0,critDamage:50,ehr:0,res:0};
function fixture(){const p=actor('player','player',20,stats),def=catalog.monsters.find((m:any)=>m.id==='mon_potion_slime'),e=actor('mon_potion_slime:0:test','enemy',18,{...stats,hp:3000},def);return {p,e,g:makeGame(p,[e],{trace:true})};}
const attack={type:'damage',flat:15,atk:1.2,crit:false};
describe('受伤结算的异常属性恢复',()=>{
 it.each([NaN,Infinity,null,'20%'])('读档后防御出现 %s 时保留最近合法基础防御，敌方伤害继续结算',(invalid)=>{
  const {p,e,g}=fixture();expect(g.stat(p,'defense')).toBe(120);p.stats.defense=invalid;
  const saved=decode(JSON.parse(JSON.stringify(encode(g))));const restored=makeGame(saved.player,saved.enemies,{trace:true});
  expect(restored.damage(saved.enemies[0],saved.player,attack,{forceHit:true}).damage).toBeCloseTo(g.calcBase(e,p,attack)*190/(190+120));
  expect(saved.player.stats.defense).toBe(120);expect(restored.trace.some((x:any)=>x.type==='numeric_recovery')).toBe(true);
 });
 it('异常减伤与防御状态不污染正常增益，合法状态数值保持不变',()=>{
  const {p,e,g}=fixture();g.addStatus(p,p,{kind:'buff',status:'defense_up',value:.2,valueUnit:'ratio',turns:3});g.addStatus(p,p,{kind:'buff',status:'direct_damage_reduction',value:.2,valueUnit:'ratio',turns:3});
  const baseline=g.damage(e,p,attack,{forceHit:true}).damage;
  const bad={kind:'buff',status:'defense_up',canonicalStatus:'defense_up',value:'20%',valueUnit:'ratio',sourceId:'bad',sourceSkill:'import'};p.buffs.push(bad,{...bad,status:'direct_damage_reduction',canonicalStatus:'direct_damage_reduction',value:NaN});
  expect(g.damage(e,p,attack,{forceHit:true}).damage).toBeCloseTo(baseline);expect(g.stat(p,'defense')).toBe(144);expect(g.incomingReduction(p)).toBe(.2);
  expect(g.trace.some((x:any)=>x.type==='numeric_recovery')).toBe(true);
 });
 it('已有状态数值变坏后恢复最近合法值，整场持续时间仍可为 Infinity',()=>{
  const {p,g}=fixture();g.addStatus(p,p,{kind:'buff',status:'defense_up',value:.2,valueUnit:'ratio',turns:Infinity});expect(g.stat(p,'defense')).toBe(144);p.buffs[0].value=Infinity;expect(g.stat(p,'defense')).toBe(144);expect(p.buffs[0].value).toBe(.2);expect(p.buffs[0].expireAtPhase).toBe(Infinity);
 });
 it('选择同类最强减伤前先恢复状态值，损坏层数不凭空补为一层',()=>{
  const {p,g}=fixture();g.addStatus(p,p,{kind:'buff',status:'direct_damage_reduction',value:.4,valueUnit:'ratio',turns:3});expect(g.incomingReduction(p)).toBe(.4);p.buffs[0].value=NaN;
  g.addStatus(p,p,{kind:'buff',status:'direct_damage_reduction',value:.2,valueUnit:'ratio',turns:3},{skillId:'other'});expect(g.incomingReduction(p)).toBe(.4);
  p.buffs.push({status:'strength',value:NaN,valueUnit:'count'});expect(g.status(p,'strength')).toBe(0);expect(g.stat(p,'attack')).toBe(100);
 });
 it('属性运算溢出时恢复最近合法结果，但不把无效最终伤害当作零伤害',()=>{
  const {p,e,g}=fixture();expect(g.stat(p,'defense')).toBe(120);p.stats.defense=Number.MAX_VALUE;g.addStatus(p,p,{kind:'buff',status:'defense_up',value:2,valueUnit:'ratio',turns:3});expect(g.stat(p,'defense')).toBe(120);expect(()=>g.rawHit(e,p,NaN)).toThrow('Invalid damage');
 });
});
