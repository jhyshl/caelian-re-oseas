// Explicit reset kits. Tokens are compiled at build time, never interpreted from UI text.
import fs from 'node:fs';
import path from 'node:path';
import { describeSkillEffects } from '../src/battle/rework/runtime/skill-description.mjs';
const root=path.resolve(import.meta.dirname,'..');
const file=path.join(root,'src/battle/rework/catalog.json');
const catalog=JSON.parse(fs.readFileSync(file,'utf8'));
const plan=JSON.parse(fs.readFileSync(path.join(root,'src/battle/rework/monster-reset-plan.json'),'utf8'));
const kits=`
slime|d.9,o.35,s.3@s|s.6@s,w1@s
goblin|a20@a,w1@s|d1.5,bonus.3?armor_break,s.2@s
giant_rat|d1,p.3,w1@s|d1.8,s.3@s?poison
skeleton|t1@s,f20@s|d1.3,b15,rmf@s
dire_wolf|w1@s,a15@a|d2/2,bl.3,rmw1@s|swift1|1.3
rafflesia|p.4,s.3@s|h.65@a,f15@a
kobold|s.5@s,f15@s|d1.8,b15?ally_taunt
zombie|d1.2,n30|h1@s,f15@s,l20@s
giant_spider|l20,s.4@s|d1.3,p.4
bandit|w1@s,s.3@s|d1.9,k15?no_shield,rmw1@s|swift1|1.9
giant_bat|d1,l15,w1@s|d2.1/3,rmw1@s|swift1|1.4
orc|a20@s,s.4@a|d2.2/2,b20,v15@s|self_attack|1.6
mimic|t1@s,f25@s,s.6@s?solo|d2.2,l20,b20@s|self_fortitude|1.5
ghost|w1@s,s.5@a|d1,k20,cu.35
stone_golem|t1@s,f20@s|d1.6,k15,rmf@s|self_fortitude|1.2
gargoyle|t1@s,s.6@s|d2.1/3,w1@s,rms.1@s|shield_cost|1.4
ogre|a25@s,f15@s|d2.5,l25,v20@s|self_attack|1.7
shadow_horror|w1@s,s.4@s|d1.3,k20,cu.35
living_armor|t1@s,f25@s|d1.7,s.35@s?self_fortitude
werewolf|w1@s,a20@s|d2.2/3,ls25@s?bleed|swift1|1.5
basilisk|f20@s,s.4@s|d1.4,i1?self_shield
troll|h1@s,f20@s|d1.9,k15,bonus.3?self_fortitude,rmf@s
wyvern|w2@s,s.25@s|d2.2/2,p.35,rmw2@s|swift2|1.5
chimera|a15@s?head_snake,f15@s?head_lion,w1@s?head_goat|d1?head_snake,p.4?head_snake,d1.8?head_lion,s.3@s?head_lion,d1.2?head_goat,k15?head_goat
evil_eye|v15,s.4@s|d2.2/2,cu.3|self_shield+vulnerable|1.5
tumble_crab|t1@s,f20@s|d1.7,w1@s,rmf@s|self_fortitude|1.2
murloc|d1.1,l15,u1|d1.7,w1@a?wet
water_sprite|c1@a,h1@a|s.65@a,w1@a
siren|l20,a15@a|d1.5,z1?slow
kraken_baby|s.7@s,f15@s|d2.3/3,l20,rms@s|self_shield|1.5
wraith|cu.4,w1@s|d1.4,s.4@s?curse
dark_knight|t1@s,f25@s|d2,b20,s.3@a
abyss_spawn|o.4,s.35@s|d1.7,h.65@s?dot2
training_dummy|t1@s,f15@s,s.4@s?solo|d1.2,k10,rmf@s
mandrake_root|k15,s.3@s|h.7@a,f15@a
arcane_bat|w1@s,a15@s|d1.9/3,v10,rmw1@s|swift1|1.3
runic_rat|w1@a,s.25@s|s.5@a,c1@a
failed_homunculus|h.8@s,a15@s,v15@s|d1.9,b15,rma@s
library_mimic|k15,s.35@s|d1.8/3,cu.25
potion_slime|d.9,p.35,l10|h.6@a,w1@a,pay5@s
clockwork_spider|t1@s,s.7@s|d1.7,l25,rms@s|self_shield|1.2
goblin_archer|a20@s,w1@s|d2/2,bl.3,rma@s|self_attack|1.4
urban_thief|w1@s,s.3@s|d1.8/2,b15,rmw1@s|swift1|1.3
blackmarket_hound|k15,a15@a|d1.7,bl.3?weak
grave_crow|d1,cu.3,w1@s|s.5@a,a10@a
luminous_wolf|w1@a,a15@a|d1.3,s.35@s
lake_sprite|c1@a,h.7@a|s.5@a,f15@a
flower_mite|d.9,p.3,w1@s|s.45@a,f10@a
moss_boar|s.6@s,f15@s|d1.9,b15@s
solar_guard|t1@s,f25@s|d1.5,bu.3,s.35@a
church_inquisitor|v15,s.4@s|d1.8,n35?vulnerable
false_priest|h.85@a,a15@a|w1@s,s.45@a
cathedral_shade|s.5@s,w1@s|d1.5,k20,cu.3
silver_automaton|t1@s,f20@a|d1.9/2,s.35@s
lab_chimera|f20@s?direct_pressure,c1@s?dot_pressure,w1@s|d2.2/2,p.3,rmw1@s|swift1|1.5
blood_candle|pay5@s,a20@a,s.3@a|d1,bu.3,s.25@s
royal_duelist|f15@s,w1@s|d2.1,b20,rmw1@s,rmf@s|swift1+unguarded|1.5
murloc_tidecaller|a15@a,w1@a|d1.1,u1,l15
coral_serpent|d1,p.4,w1@s|s.5@s,f15@s
pearl_eye|s.65@a,c1@a|a20@a,w1@s
reef_guardian|t1@s,f25@s|d1.9,l20,rmf@s|self_fortitude|1.3
drowned_singer|cu.4,s.45@a|d1.5,z1?curse
thorn_sprite|s.5@a,f15@a|d1.2,bl.3,s.25@s
oldroot_treant|t1@s,f25@s|h.8@a,s.5@s
dream_moth|l20,w1@s|d1,z1?slow,s.25@s
spore_deer|h.8@a,f15@a|s.45@a,w1@s
venom_vine|p.35,l20|d1.4,h.5@s?poison
forest_stalker|w1@s,a20@s|d2.3,bl.35?slow,v15@s|swift1|1.6
moonlit_panther|w2@s,s.25@s|d2.2/3,b15,rmw2@s|swift2|1.5
ancient_beetle|t1@s,f30@s|d1.8,k20,b20@s
moon_mirror|w1@a,s.4@a|c1@a,f15@a
silver_blood_bat|d1,bl.3,w1@s|d1.8/2,ls20@s?bleed
lunar_duelist|w1@s,f15@s|d2.1/2,k15,rmw1@s|swift1+unguarded|1.5
illusion_servant|w1@a,s.3@s|t1@s,s.35@s
moonlit_wraith|cu.45,w1@s|d1.8,s.5@s?curse2
glass_hound|w2@s,s.3@s|d2.3/3,bl.3,rms@s,rmw2@s|swift2+self_shield|1.5
silver_eye|v15,l15|d1.8,x1?vulnerable
mirror_knight|t1@s,f20@s|d1.8,s.4@a,rmf@s
furnace_imp|a20@a,s.25@s|d1,bu.3,w1@a
iron_mite|d.9,o.35,b15|s.45@a,f10@a
steam_guard|t1@s,f20@s|d1.9,l20,rmf@s,w1@s|self_fortitude|1.3
magma_hound|w1@s,a15@s|d2,bu.4,rmw1@s|swift1|1.4
mine_golem|t1@s,s.8@s|d2.1,b20,rms@s|self_shield|1.4
heat_core|bu.45,s.4@s|a20@a,w1@s,v15@s
blast_dwarf|s.6@s,f15@s|d2.5,bu.3,v20@s|self_shield|1.6
furnace_serpent|f20@s,s.4@s|d1.4,p.25?self_fortitude,bu.25?self_fortitude,rmf@s
black_tide_eel|w2@s,a15@s|d2.2/3,l20,rmw2@s|swift2|1.5
void_anemone|t1@s,s.75@s|d1.4,o.4,f15@a
sunken_armor|t1@s,f25@s|d1.7,o.3,b15,rmf@s|self_fortitude|1.2
deep_eye|l25,s.45@s|d1.6,st1?slow+self_shield
abyssal_murloc|c1@a,a20@a|h.9@a,s.3@s
pressure_crab|t1@s,f30@s|d2.2,l20,b20@s|self_fortitude|1.5
dread_coral|k20,s.4@a|d1.3,n40?weak
leviathan_larva|s.8@s,f20@s|d2.4/2,k15,rms@s|self_shield|1.6
saltbone_sailor|d1.2,bl.35,l15|s.5@a,a15@a
withered_treant|l20,f20@s|d1.5,cu.35,h.6@s?slow
rampaging_vampire|pay8@s,a25@s,w1@s|d2.4/3,bl.35,ls20@s,v20@s|swift1|1.6
`.trim().split('\n').map(row=>row.split('|'));
const targets={s:'self',a:'ally',e:'enemy'};
const debuffs={b:'armor_break',l:'speed_down',v:'vulnerable',k:'weak',n:'healing_down',z:'sleep',i:'petrify',st:'stun',u:'wet'};
const dots={p:'poison',bl:'bleed',bu:'burn',o:'corrosion',cu:'curse'};
function effect(token) {
 const [raw,requirement]=token.split('?'),[body,destination]=raw.split('@');
 const match=body.match(/^([a-z]+)([\d.]*)?(?:\/(\d+))?$/);if(!match)throw Error('Bad effect '+token);
 const [,key,num,hits]=match,n=Number(num||1);
 let e;
 if(key==='d')e={type:'damage',flat:15,atk:n,hits:Number(hits||1),crit:true};
 else if(key==='s'||key==='h')e={type:key==='s'?'shield':'heal',flat:20,[key==='s'?'def':'atk']:n};
 else if(dots[key])e={type:'dot',status:dots[key],atk:n,baseChance:100,turns:2,stacks:1,crit:false};
 else if(debuffs[key])e={type:'debuff',status:debuffs[key],value:['z','i','st','u'].includes(key)?1:n/100,valueUnit:['z','i','st','u'].includes(key)?'count':'ratio',baseChance:['z','i','st'].includes(key)?70:100,turns:['z','i','st'].includes(key)?1:2,cleanseable:true};
 else if(key==='f')e={type:'buff',status:'fortitude',permanentDefenseRatio:n/100,value:n/100,valueUnit:'flat',turns:2};
 else if(key==='a')e={type:'buff',status:'attack_up',value:n/100,valueUnit:'ratio',turns:2};
 else if(key==='w')e={type:'buff',status:'swift',value:1,stacks:n,valueUnit:'count',turns:2};
 else if(key==='t')e={type:'buff',status:'taunt',value:1,valueUnit:'count',turns:1};
 else if(key==='c'||key==='x')e={type:key==='c'?'cleanse':'dispel',amount:n};
 else if(key==='pay')e={type:'hp_cost',currentHpRate:n/100};
 else if(key==='ls')e={type:'lifesteal',actualHpDamageRate:n/100,healCapOwnMaxHp:.1};
 else if(key==='rmw')e={type:'consume_buff',status:'swift',amount:n};
 else if(key==='rmf'||key==='rma')e={type:'consume_buff',status:key==='rmf'?'fortitude':'attack_up'};
 else if(key==='rms')e={type:'shield_cost',maxHpRate:num?Number(num):undefined};
 else if(key==='bonus')e={type:'damage_bonus',atk:n};
 else throw Error('Unmapped effect '+token);
 e.target=targets[destination]||(['buff','shield','heal','cleanse','lifesteal','hp_cost','consume_buff','shield_cost'].includes(e.type)?'self':'enemy');
 if(requirement)e.requires=requirement.split('+');
 if(e.target==='self'&&e.type==='debuff'){e.turns=1;e.selfCost=true;e.cleanseable=false;}
 if(e.type==='buff')e.dispellable=true;
 return e;
}
const basic={fighter:1.5,bruiser:1.5,striker:1.6,guardian:1.2,dot:1.2,controller:1.2,support:1.1,healer:1};
const recovery={fighter:'s.4,f10',bruiser:'s.4,a10',striker:'w1,s.25',guardian:'s.6,f15',dot:'s.35,w1',controller:'s.4,f10',support:'s.4@a,f10@s',healer:'s.35,c1'};
const byId=new Map(kits.map(row=>['mon_'+row[0],row]));
if(byId.size!==97||plan.length!==97)throw Error('Incomplete reset kits');
for(const m of catalog.monsters) {
 const p=plan.find(p=>p.id===m.id),row=byId.get(m.id);if(!row||!p)throw Error('Missing '+m.id);
 const old=m.skills; m.resetVersion=2;m.tactics=p.tactics;
 const definitions=[['基础进攻','d'+basic[m.roleKey],null],['战术整备',recovery[m.roleKey],null],[p.one.split('：')[0],row[1],p.one],[p.two.split('：')[0],row[2],p.two]];
 m.skills=definitions.map(([name,tokens,description],index)=>{
  const effects=tokens.split(',').map(effect);
  const heavy=effects.some(e=>(e.atk||0)>2||e.type==='heal'||e.type==='cleanse'||['sleep','petrify','stun'].includes(e.status));
  const skill={id:m.id+'__reset_'+index,name,target:effects.some(e=>e.target==='enemy')?'enemy':effects.some(e=>e.target==='ally')?'ally':'self',priority:index===0?10:index===1?80:index===2?55:60,condition:'总是',cooldown:index===0?0:index===1?3:heavy?3:2,cooldownGroup:m.id+':reset:'+index,actionCost:1,targetSelection:'复合技能锁定受益者与敌方目标',effects,summary:description||name,telegraph:description||name,fallback:'技能与目标在玩家阶段开始时锁定；准备被拆除时只执行已公告的削弱分支，目标死亡则防御，不抽取其他技能。',reset:{index,breakOn:index===3&&row[3]?row[3].split('+'):[],fallbackAtk:index===3&&row[4]?Number(row[4]):undefined},source:{key:'reset.'+index,name,isNew:true}};
  if(index===3&&row[3])skill.summary+='；准备条件失效：总直伤改为15F＋'+Math.round(Number(row[4])*100)+'%攻击，取消附带敌方减益。';
  return skill;
 });
 m.retiredSkills=m.retiredSkills||old.map((s,i)=>({id:s.id,name:s.name,replacement:m.skills[i===0?0:i%2+2].id}));
 if(m.id==='mon_giant_spider')m.skills[3].effects.find(e=>e.type==='dot').chanceWithSlow=120;
 if(m.id==='mon_moss_boar')m.skills[3].effects.find(e=>e.type==='damage').shieldDamageBonus=.2;
 if(['mon_venom_vine','mon_withered_treant'].includes(m.id))m.skills[3].effects.find(e=>e.type==='heal').requiresHit=true;
 if(m.id==='mon_runic_rat')m.skills[3].effects.find(e=>e.type==='cleanse').allowed=['speed_down','armor_break'];
 if(m.id==='mon_zombie')m.skills[3].reset.maxSelfHp=.45;
 if(m.id==='mon_blood_candle'||m.id==='mon_rampaging_vampire')m.skills[2].reset.minSelfHp=.3;
}

const bossKits={
 boss_academy_arcane_golem:{punch:'d2,s.3@s',mistake:'d1.3,k15,f15@s',rail:'s.8@s,f20@s',exam:'d2.6',restart:'c1@s,s.3@s'},
 boss_ilaya_grave_warden:{scythe:'d1.9,cu.3',whisper:'k15,s.5@a',soil:'f20@s,s.6@s',lantern:'f10@s',guard:'f10@s',reckoning:'d2.8'},
 boss_solavia_hollow_saint:{gaze:'d1.6,k15',prayer:'s.6@s,f15@s',decree:'v15,a15@s',verdict:'d2.8',crack:'',struggle:'d1.4,w1@s'},
 boss_naiathos_tide_queen:{aria:'d1.5',crown:'s.7@s,w1@s',high:'d2.8',ebb:'d1.3',charm:'d1.2,l20,k15',reflux:'c1@s'},
 boss_aethera_dream_stag:{antler:'d1.8,w1@s',pollen:'l20,k15,s.35@s',regen:'c1@s',bloom:'d1.3',trample:'d2.7/2'},
 boss_silvermoon_mirror_duchess:{stab:'d1.8,b15',step:'w2@s,s.4@s',scrutiny:'k15,f15@s',refract:'s.65@s,f15@a',copy:'d2.8/2',servant:'w1@s'},
 boss_hearthforge_overcore:{flame:'d1.6,bu.4',shell:'s.8@s,f25@s',steam:'d1.6,l15',pressure:'a15@s,s.4@s',overload:'d3'},
 boss_abyssal_leviathan_fragment:{bite:'d2,bl.3',blackwater:'s.6@s,f15@s',devour:'s.5@s,a15@s',devour_hit:'d2.9',regrow:'s.3@s'}
};
const names={restart:'术式校准',struggle:'残躯挣扎',ebb:'退潮回声',bloom:'浅梦徘徊',servant:'唤镜代行',pressure:'加压蓄热',blackwater:'深潮护颅'};
const mechanisms=new Set(['exam','reckoning','verdict','high','trample','copy','overload','devour_hit']);
for(const b of catalog.bosses){
 b.resetVersion=2;
 for(const id of Object.keys(bossKits[b.id]))if(!b.skills.some(s=>s.id===id))b.skills.push({id,name:names[id],priority:55,cooldown:3,target:'self',effects:[]});
 b.skills=b.skills.filter(s=>Object.hasOwn(bossKits[b.id],s.id));
 for(const s of b.skills){
  const old=s.effects;const tokens=bossKits[b.id][s.id];
  s.effects=tokens?tokens.split(',').map(effect):[];
  if(names[s.id])s.name=names[s.id];
  if(s.id==='crown'){
   s.effects.push({type:'summon',summonId:'tide_pearl',duration:4,maxSpawns:2});
  }else s.effects.push(...old.filter(e=>['summon','charge','mechanic_state'].includes(e.kind||e.type)));
  if(['reflux','regen'].includes(s.id))s.effects.push({type:'heal',maxHpRatio:.05,target:'self',maxUses:2});
  if(s.id==='high'||s.id==='steam')s.effects.unshift({type:'shield_strip',ratio:s.id==='high'?.35:.2,flatCap:s.id==='high'?100:80,atkCap:s.id==='high'?.8:.6,target:s.id==='high'?'all_enemies':'enemy'});
  if(s.id==='devour'&&!s.effects.some(e=>e.type==='charge'||e.kind==='charge'))s.effects.push({type:'charge',next:'devour_hit'});
  for(const e of s.effects){
   if(e.type==='damage'&&mechanisms.has(s.id)){e.crit=false;if(['exam','high','overload'].includes(s.id)){e.target='all_enemies';e.totalBudgetMultiplier=1.3;e.multiplayerPerTarget=.65;}}
   if(e.target==='ally')e.allyHelper=s.id==='whisper'?'any':'mirror_servant';
  }
  s.target=s.effects.some(e=>e.target==='enemy'||e.target==='all_enemies')?'enemy':'self';
  if(s.priority===10)s.cooldown=0;
  else if(mechanisms.has(s.id)||['crack','devour_hit','ebb','bloom'].includes(s.id))s.cooldown=0;
  else s.cooldown=['restart','mistake','step','reflux','regen','pressure','blackwater'].includes(s.id)?3:2;
  if(s.id==='shell')s.cooldown=4;
  s.resetVersion=2;
 }
}
const helperKits={
 grave_lantern:{soul_heal:'s.25@s',soul_guard:'s.3@a,f10@a'},
 grave_guard:{guard_taunt:'t1@s,f20@s',guard_hit:'d.6,s.2@a'},
 tide_pearl:{pearl_guard:'s.4@s,w1@a'},
 mirror_servant:{mirror_taunt:'t1@s,s.4@s',mirror_chip:'d.6,w1@a'},
 leviathan_tentacle:{tentacle_taunt:'t1@s',tentacle_heal:'s.2@a',tentacle_hit:'d.65,f10@s'},
 leviathan_tail:{tail_prepare:'s.4@s,w1@s',tail_sweep:'d1.2/2,l15',tail_idle:'d.5,s.2@s'}
};
for(const b of catalog.bosses)for(const h of b.helpers||[]){
 h.resetVersion=2;
 if(h.id==='grave_lantern'&&!h.skills.some(s=>s.id==='soul_guard'))h.skills.push({id:'soul_guard',name:'余烬护持',priority:10,cooldown:2,target:'ally',effects:[]});
 for(const s of h.skills){
  const old=s.effects;s.effects=helperKits[h.id][s.id].split(',').map(effect);
  if(['soul_heal','tentacle_heal'].includes(s.id))s.effects.unshift({type:'heal',maxHpRatio:.04,target:'ally',maxUses:2});
  if(s.id==='tentacle_taunt')s.effects.push({type:'buff',status:'direct_damage_reduction',value:.15,valueUnit:'ratio',turns:999999,target:'ally'});
  if(s.id==='tail_prepare')s.effects.push({type:'charge',next:'tail_sweep'});
  for(const e of s.effects){if(e.type==='damage')e.crit=false;if(s.id==='tail_sweep'&&e.target==='enemy'){e.target='all_enemies';e.totalBudgetMultiplier=1.2;}if(s.id==='guard_hit'&&e.type==='shield')e.allyHelper='grave_lantern';}
  s.cooldown=s.id==='pearl_guard'?3:['guard_hit','tentacle_hit','tail_idle'].includes(s.id)?0:2;
  s.resetVersion=2;
 }
}
catalog.counts.monsterSkills=catalog.monsters.reduce((n,m)=>n+m.skills.length,0);
for(const m of [...catalog.monsters,...catalog.bosses,...catalog.bosses.flatMap(b=>b.helpers)])for(const s of m.skills){s.summary=describeSkillEffects(s);s.telegraph=s.summary;if(s.reset?.breakOn.length)s.summary+='；准备被拆除时改为总伤害15F＋'+Math.round(s.reset.fallbackAtk*100)+'%攻击，并取消附带敌方减益。';s.conditionDescription=s.reset?.index===0?'基础进攻':s.reset?.index===1?'生命低于45%且护盾不足时整备；不连续整备':m.tactics||'根据已公告的Boss机制与当前状态选择';}
catalog.counts.bossSkills=catalog.bosses.reduce((n,b)=>n+b.skills.length,0);
catalog.counts.helperSkills=catalog.bosses.reduce((n,b)=>n+b.helpers.reduce((x,h)=>x+h.skills.length,0),0);

catalog.rules.statusFamilies.swift={aliases:['swift','agility','迅捷','敏捷'],name:'迅捷',speedPerStack:.2,maxStacks:null,turns:2,stacking:'additive_independent_expiry',dispel:'whole_group'};
catalog.rules.ai.resetVersion=2;
catalog.rules.ai.reset='97种怪物每种4个技能；复合效果、公开锁定意图、状态选择、独立冷却、治疗与强化协作预约；不随机选技。';
catalog.rules.formulas.battleEvasionCap=.9;
fs.writeFileSync(file,JSON.stringify(catalog)+'\n');
console.log('RESET_MONSTERS_OK',catalog.monsters.length,catalog.monsters.reduce((n,m)=>n+m.skills.length,0));
