/* global structuredClone */
import {catalog,actor,clamp,seeded} from './physics.mjs';
export const BANDS=[[1,10],[11,20],[21,40],[41,60],[61,100]];
export const ALLOCATIONS=['offense','balanced','survival'];
const gain={hp:10,attack:2,defense:5,speed:1,crit:1,critDamage:2,ehr:2,res:2};
const caps={crit:100,critDamage:250,ehr:80,res:80,draw:5};
const cache=new Map();
export function buildPlayer(profession,level,style='balanced',gear=1,star=null,criticalWeight=1){
 const ck=[profession.id,level,style,gear,star,criticalWeight].join(':');if(cache.has(ck))return structuredClone(cache.get(ck));
 const base=profession.baseStatsProposal,p={hp:300+20*(level-1),attack:40+3*(level-1),defense:30+2*(level-1),speed:base.speed,crit:5,critDamage:50,ehr:0,res:0,ap:5,draw:3};
 for(const k of ['hp','attack','defense']){const m=base[k].match(/\*([0-9.]+)$/);if(!m)throw Error('unknown base stat formula '+base[k]);p[k]=Math.round(p[k]*Number(m[1]));}
 p.hp+=gear*(60+6*level);p.attack+=gear*(8+1.2*level);p.defense+=gear*(8+.8*level);
 let left=10*(level-1);const alloc=Object.fromEntries([...Object.keys(gain),'ap','draw'].map(k=>[k,0]));
 const step=k=>{const cost=k==='draw'?5:k==='ap'?(p.ap<10?2:3):1;if(left<cost||p[k]>=(caps[k]??Infinity))return false;left-=cost;alloc[k]+=cost;p[k]=Math.min(caps[k]??Infinity,p[k]+(gain[k]??1));return true;};
 const to=(k,v)=>{while(p[k]<v&&step(k)){/* Spend until the requested target or budget limit. */};};
 if(level>=3)to('draw',5);else if(level===2)to('draw',4);
 to('ap',level<5?6:level<15?8:level<35?10:level<60?12:14);
 const survivalShare=style==='offense'?.12:style==='survival'?.5:.30;
 const survivalPoints=Math.floor(left*survivalShare);for(let i=0;i<survivalPoints;i++)step(i%2?'defense':'hp');
 if(level>=10){to('res',style==='offense'?10:style==='survival'?40:20);to('ehr',Math.min(40,Math.floor(level/5)*4));}
 if(style==='survival'&&level>=20)to('speed',110);
 const budget=left,baseAtk=p.attack,baseCrit=p.crit,baseCd=p.critDamage;
 // Exact grid over the feasible double-critical allocation. Remaining offense points buy attack.
 // Representative direct hit is 20+100%ATK. This is an allocation heuristic, never a damage multiplier.
 let best={score:-Infinity,cr:0,cd:0};
 for(let cr=0;cr<=Math.min(100-baseCrit,budget);cr++)for(let cd=0;cd<=Math.min(Math.ceil((250-baseCd)/2),budget-cr);cd++){
  const atk=baseAtk+2*(budget-cr-cd),score=(20+atk)*(1+criticalWeight*(baseCrit+cr)/100*(baseCd+2*cd)/100);
  if(score>best.score)best={score,cr,cd};
 }
 for(let i=0;i<best.cr;i++)step('crit');for(let i=0;i<best.cd;i++)step('critDamage');while(left>0)step('attack');
 const a=actor('player','player',level,p);a.apMax=p.ap;a.ap=p.ap;a.drawCount=p.draw;a.star=star??(level>=60?3:level>=20?2:1);a.profession=profession.id;a.professionDefinition=profession;a.allocation=alloc;a.allocationStyle=style;a.gear=gear;a.hand=[];a.deck=[];a.discard=[];a.exhaust=[];
 if(Object.values(alloc).reduce((a,b)=>a+b,0)!==10*(level-1))throw Error('Point budget drift');
 cache.set(ck,a);return structuredClone(a);
}
export function anchorHP(level,tier){const rows=catalog.rules.level.anchors.filter(a=>a.tier===tier).sort((a,b)=>a.level-b.level);if(level<=1)return rows[0].hp;for(let i=1;i<rows.length;i++)if(level<=rows[i].level){const a=rows[i-1],b=rows[i];return Math.round(a.hp+(b.hp-a.hp)*(level-a.level)/(b.level-a.level));}throw Error('Enemy level outside 1..100');}
export function monsterStats(def,level){const elite=def.tier==='elite',boss=def.tier==='boss',m=def.statMultipliers;return {hp:Math.round(anchorHP(level,def.tier)*m.hp),attack:Math.round((20+4*level)*m.attack),defense:Math.round((boss?120+6*level:elite?100+5*level:80+4*level)*m.defense),speed:Math.round((100+.15*level)*m.speed),crit:(def.statsAt20.crit??(boss?25:elite?20:15))*clamp((level-1)/9),critDamage:def.statsAt20.critDamage,ehr:def.statsAt20.ehr,res:def.statsAt20.res};}
export function encounter(definitions,level,patch={}){
 const n=definitions.length,boss=definitions.some(d=>d.tier==='boss'),highest=boss?'boss':definitions.some(d=>d.tier==='elite')?'elite':'normal',pool=anchorHP(level,highest)*([0,1,1.25,1.5][n]??1.5),weight=definitions.reduce((a,d)=>a+d.statMultipliers.hp,0);
 return definitions.map((d,i)=>{const stats=monsterStats(d,level);if(n>1&&!boss)stats.hp=Math.round(pool*d.statMultipliers.hp/weight);stats.hp*=(patch.hpScale??1)*(1+(patch.hpLevelRamp?.[d.tier]??0)*clamp((level-1)/99));stats.attack*=(patch.attackScale??1)*(1+(patch.attackTierRamp?.[d.tier]??0)*clamp((level-1)/19))*(1+(patch.attackLevelRamp?.[d.tier]??0)*clamp((level-1)/99));stats.defense*=patch.defenseScale??1;stats.crit*=patch.critScale??1;const a=actor('enemy:'+i+':'+d.id,'enemy',level,stats,d);a.slot=i;a.damageScale=boss?1:[0,1,.62,.48][n];a.encounterScale=a.damageScale;a.skillScale=a.damageScale;a.flags.entryScale=a.damageScale;a.offenseGroupFactor=(patch.groupOffense?.[n]??a.damageScale)/a.damageScale;return a;});
}
const attacking=new Set(['striker','fighter','bruiser','dot','controller']);
export function sampleCases({count=100,seed=90301,regions=false}={}){
 const r=seeded(seed),cases=[];for(let i=0;i<count;i++){
  const band=i%BANDS.length,[lo,hi]=BANDS[band],level=lo+Math.floor(r()*(hi-lo+1));
  let enemyLevel=level,region='same_level';
  if(regions){const choices=catalog.rules.level.regions.filter(x=>x.base<=level+5);const x=choices[Math.floor(r()*choices.length)]??catalog.rules.level.regions[0];enemyLevel=Math.min(100,Math.round(x.base+x.chase*Math.max(0,level-x.base)));region=x.id;}
  const n=1+Math.floor(r()*3),tier=r()<.5?'normal':'elite',pool=catalog.monsters.filter(x=>x.tier===tier);
  let defs=[];for(let j=0;j<n;j++){
   const eligible=pool.filter(x=>!defs.some(d=>d.id===x.id)&&(!defs.some(d=>d.roleKey==='healer')||x.roleKey!=='healer')&&(!defs.some(d=>d.roleKey==='guardian')||x.roleKey!=='guardian')&&(j!==0||n===1||attacking.has(x.roleKey)));
   defs.push(eligible[Math.floor(r()*eligible.length)]);
  }
  cases.push({id:(regions?'region':'same')+':'+seed+':'+i,seed:Math.floor(r()*0xffffffff),level,enemyLevel,band,region,tier,count:n,monsterIds:defs.map(d=>d.id)});
 }
 return cases;
}
export function wilson(w,n){if(!n)return[0,1];const z=1.96,p=w/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return[c-h,c+h];}
export function quantile(a,q){if(!a.length)return null;const v=[...a].sort((a,b)=>a-b);return v[Math.floor((v.length-1)*q)];}
