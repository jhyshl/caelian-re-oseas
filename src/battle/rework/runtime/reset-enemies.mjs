import {effectValue} from './tactical-ai.mjs';
import {chooseEnemyTarget} from './enemy-targets.mjs';
// Conditions are explicit, deterministic and use public state only.
const alive=a=>a&&a.hp>0;
const hp=a=>a.hp/a.maxHp;
const key=e=>e.canonicalStatus||e.status;
const hard=new Set(['hard_control','freeze','sleep','stun','petrify']);
const team=(g,a)=>g.friendTeam(a);
const foes=(g,a)=>g.foeTeam(a);
const cleanable=a=>[...a.debuffs,...a.dots].filter(e=>e.cleanseable!==false);
const stable=(a,b)=>(a.slot??0)-(b.slot??0)||a.id.localeCompare(b.id);
const has=(g,a,s)=>g.hasStatus(a,s);
const shieldReady=a=>Math.min(a.shield,a.flags.resetShieldRemaining??a.shield)>0;
export function resetRequirement(g,a,t,requirements=[]) {
 return requirements.every(name=>{
  if(name==='solo')return team(g,a).length===1;
  if(name==='self_shield')return shieldReady(a);
  if(name==='shield_cost')return Math.min(a.shield,a.flags.resetShieldRemaining??a.shield)>=a.maxHp*.1;
  if(name==='self_fortitude')return has(g,a,'fortitude');
  if(name==='self_attack')return has(g,a,'attack_up');
  if(name==='swift1'||name==='swift2')return g.status(a,'swift')>=Number(name.slice(-1));
  if(name==='ally_taunt')return team(g,a).some(x=>x!==a&&has(g,x,'taunt'));
  if(name==='no_shield')return t.shield<=0;
  if(name==='dot2')return t.dots.length>=2;
  if(name==='curse2')return g.status(t,'curse')>=2;
  if(name==='slow')return has(g,t,'speed_down');
  if(name==='unguarded')return (g.player.thisTurn.defenseAP??0)<1;
  if(name==='dot_pressure')return a.dots.length>0;
  if(name==='direct_pressure')return a.dots.length===0;
  if(name.startsWith('head_'))return ['snake','lion','goat'][a.flags.resetHead??0]===name.slice(5);
  if(['poison','bleed','curse','weak','vulnerable','wet','armor_break'].includes(name))return has(g,t,name);
  throw Error('Unknown reset condition '+name);
 });
}
export function selectResetTargets(g,a,s,e,hostileTarget){
 if(e.target==='self')return [a];
 if(e.target==='enemy')return [chooseEnemyTarget(g,a,hostileTarget?.id)].filter(Boolean);
 if(e.target==='all_enemies')return foes(g,a).sort(stable);
 if(e.target==='all_allies')return team(g,a).sort(stable);
 const helpful=s.effects.filter(x=>x.target==='ally');
 const healing=helpful.some(x=>x.type==='heal'),cleanse=helpful.find(x=>x.type==='cleanse');
 const support=helpful.some(x=>x.status==='attack_up'||x.status==='swift');
 const pool=team(g,a);
 const supportValue=x=>helpful.reduce((n,e)=>n+effectValue(g,a,x,e,{reservations:true}),0);
 const cleanScore=x=>cleanable(x).filter(b=>!cleanse?.allowed||cleanse.allowed.includes(key(b))).reduce((n,b)=>n+(hard.has(key(b))?100:key(b)==='healing_down'?80:20),0);
 pool.sort((x,y)=>{
  if(healing){const available=x=>g.healBudgetRemaining(a,x,{type:'heal',maxHp:1})>0&&x.hp+(g.enemyAI?.reservedHealing?.[x.id]??0)<x.maxHp;return Number(available(y))-Number(available(x))||hp(x)-hp(y)||cleanScore(y)-cleanScore(x)||stable(x,y);}
  if(cleanse){const diff=cleanScore(y)-cleanScore(x);if(diff)return diff;}
  if(support){const gain=supportValue(y)-supportValue(x);if(gain)return gain;const ready=x=>x!==a&&x.flags.enemyActionRound!==g.round&&['fighter','striker','bruiser'].includes(x.definition?.roleKey);return Number(ready(y))-Number(ready(x))||Number(has(g,x,'attack_up'))-Number(has(g,y,'attack_up'))||g.status(x,'swift')-g.status(y,'swift')||g.stat(y,'attack')-g.stat(x,'attack')||stable(x,y);}
  return hp(x)-hp(y)||x.shield/x.maxHp-y.shield/y.maxHp||Number(x===a)-Number(y===a)||stable(x,y);
 });
 return pool.slice(0,1);
}
export function resetEligible(g,a,t,s,entries){
 const index=s.reset.index, friends=team(g,a).filter(x=>x!==a),previous=a.flags.lastEnemyActionGroup===s.cooldownGroup;
 if(index===0)return true;
 if(previous)return false;
 if(s.reset.maxSelfHp&&hp(a)>=s.reset.maxSelfHp)return false;
 if(s.reset.minSelfHp&&hp(a)<=s.reset.minSelfHp)return false;
 if(index===1)return hp(a)<.45&&a.shield<a.maxHp*.08||a.receivedLastTurn?.damage>=a.maxHp*.2&&a.shield<a.maxHp*.05;
 const effects=s.effects;
 const damage=effects.some(e=>e.type==='damage'||e.type==='dot'&&e.target==='enemy');
 const heals=entries.filter(row=>row.effect.type==='heal');
 if(heals.length&&!damage){
  const clean=effects.some(e=>e.type==='cleanse');
  if(!heals.some(row=>row.targetIds.some(id=>{const x=team(g,a).find(t=>t.id===id);return alive(x)&&hp(x)<.8&&x.hp+(g.enemyAI?.reservedHealing?.[x.id]??0)<x.maxHp&&(g.healBudgetRemaining(a,x,row.effect)>0||clean&&has(g,x,'healing_down'));})))return false;
 }
 const cleanse=entries.filter(row=>row.effect.type==='cleanse'&&resetRequirement(g,a,t,row.effect.requires));
 if(cleanse.length&&!damage&&!heals.length&&!cleanse.some(row=>row.targetIds.some(id=>{const x=team(g,a).find(t=>t.id===id);return alive(x)&&cleanable(x).some(e=>!row.effect.allowed||row.effect.allowed.includes(key(e)));})))return false;
 if(effects.some(e=>e.status==='taunt')){
  const solo=effects.some(e=>e.requires?.includes('solo'));
  if(!friends.length&&!solo)return false;
  if(friends.length&&(hp(a)<.35||!friends.some(x=>hp(x)<.8||['striker','healer','support','controller'].includes(x.definition?.roleKey)||x.intent?.isMajor)))return false;
 }
 if(index===3&&!damage&&!heals.length&&!cleanse.length&&effects.every(e=>e.target==='self')&&hp(a)>.65)return false;
 // Don't repeatedly prepare an already sufficient personal stance just to add speed.
 if(index===2&&!damage&&!heals.length&&effects.every(e=>e.target==='self')){
  const next=a.definition.skills[3];
  if(next?.reset?.breakOn.length&&resetRequirement(g,a,g.player,next.reset.breakOn))return false;
 }
 return true;
}
export function resetPriority(g,a,t,s){
 if(!s.reset)return s.priority;
 if(s.reset.index===3&&s.reset.breakOn.length&&!resetRequirement(g,a,t,s.reset.breakOn))return 12;
 const heal=s.effects.some(e=>e.type==='heal');
 if(heal&&hp(t)<.45)return 100;
 if(heal&&hp(t)<.8)return 85;
 if(s.effects.some(e=>e.type==='cleanse')&&cleanable(t).some(e=>hard.has(key(e))))return 105;
 if(s.reset.index===2&&['royal_duelist','lunar_duelist','shadow_horror','library_mimic'].some(id=>a.definition.id==='mon_'+id))return (g.player.lastTurn.damageCards??0)>=3?70:40;
 if(s.reset.index===2&&a.definition.id==='mon_church_inquisitor')return (g.player.lastTurn.healing??0)+(g.player.lastTurn.shieldGained??0)>0?75:50;
 return s.priority;
}
export function resolveResetEntries(g,a,intent,rows,preview=false){
 if(!intent.skill.reset)return rows;
 const t=foes(g,a).find(t=>rows.some(r=>r.targetIds.includes(t.id)))??g.player;
 const broken=!resetRequirement(g,a,t,intent.skill.reset.breakOn);
 let resolved=rows.filter(row=>resetRequirement(g,a,t,row.effect.requires)).map(row=>({...row,effect:{...row.effect}}));
 const bonus=resolved.filter(row=>row.effect.type==='damage_bonus').reduce((sum,row)=>sum+(row.effect.atk??0),0);
 resolved=resolved.filter(row=>row.effect.type!=='damage_bonus');
 let applied=false;
 for(const row of resolved){
  const e=row.effect;
  if(e.permanentDefenseRatio!==undefined)e.value=(a.stats.defense??0)*e.permanentDefenseRatio;
  if(e.chanceWithSlow&&has(g,t,'speed_down'))e.baseChance=e.chanceWithSlow;
  if(e.type==='damage'&&!applied){e.atk+=bonus;applied=true;}
 }
 if(broken&&intent.skill.reset.fallbackAtk!==undefined){
  resolved=resolved.filter(row=>!(row.effect.target==='enemy'&&['debuff','dot','dispel'].includes(row.effect.type)));
  for(const row of resolved)if(row.effect.type==='damage')row.effect.atk=intent.skill.reset.fallbackAtk;
  if(!preview)g.log('enemy_preparation_broken',{actor:a.id,skill:intent.skillId,atk:intent.skill.reset.fallbackAtk});
 }
 return resolved;
}
