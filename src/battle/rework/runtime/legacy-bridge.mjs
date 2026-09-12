/* global structuredClone */
// Standalone research asset: no repository imports or filesystem access.
// syncLegacyActors is called after a legacy operation and BEFORE the next project().
// At new-battle creation use importInitialLegacyState: enemy rework stats stay intact.
const number=(v,fallback=0)=>typeof v==='number'&&Number.isFinite(v)?v:fallback;
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v??{},k);
const keyOf=e=>e.canonicalStatus??e.status;
const DOT=new Set(['burn','poison','bleed','curse','corrosion','abyss']);
const nativeNames=new Set(['strength','fortitude','regen','heal_regen','shield_regen','attack_up','defense_up','speed_up','speed_down','armor_break','direct_damage_up','damage_up','direct_damage_reduction','weak','fear','vulnerable','wet','freeze','stun','sleep','petrify','hard_control','silence','taunt','healing_down','counter_preparation']);
const aliases={attack_amp_percent:'direct_damage_up',monster_frenzy:'direct_damage_up',blood_burn:'direct_damage_up',damage_resist:'direct_damage_reduction',damage_halve:'direct_damage_reduction',evidence_barrier:'direct_damage_reduction',defense_amp_percent:'defense_up',healing_amp_percent:'治疗量增加',healing_resist:'healing_down',heal_down:'healing_down',frozen:'freeze',entangle:'hard_control',slow:'speed_down',wetness:'wet',burning:'burn',bleeding:'bleed',toxin:'poison',poisoned:'poison',regeneration:'regen','灼烧':'burn','中毒':'poison','流血':'bleed','蚀魂':'curse','腐蚀':'corrosion','冻结':'freeze','眩晕':'stun','沉眠':'sleep','嘲讽':'taunt','易伤':'vulnerable','虚弱':'weak','湿润':'wet','攻击力增加':'attack_up','防御增加':'defense_up','速度增加':'speed_up','速度降低%':'speed_down','直接增伤':'direct_damage_up','直接伤害提高%':'direct_damage_up','受到直接伤害降低':'direct_damage_reduction'};
const percentKeys=new Set(['attack_amp_percent','monster_frenzy','blood_burn','damage_resist','damage_halve','evidence_barrier','defense_amp_percent','healing_amp_percent','healing_resist','heal_down','attack_up','defense_up','speed_up','speed_down','armor_break','direct_damage_up','damage_up','direct_damage_reduction','healing_down']);
const controlKeys=new Set(['freeze','stun','sleep','petrify','hard_control','taunt','silence','wet']);

export function normalizeLegacyStatus(rawKey,entry){
  const key=['agility','敏捷','迅捷','swift'].includes(rawKey)?'swift':aliases[rawKey]??rawKey;let value=key==='swift'?1:number(entry.value,1),unit='count';
 if(percentKeys.has(rawKey)||percentKeys.has(key)){unit='percent';if(rawKey==='damage_halve')value=50;}
 else if(['weak','vulnerable','fear'].includes(key)){
  unit='percent';if(value===1)value=key==='vulnerable'?40:25;
 }
 else if(controlKeys.has(key))value=1;
 // Unknown/custom IDs stay visible and removable. They are reported to the caller;
 // their separate Workshop behavior must remain attached to the Workshop engine.
  const supported=nativeNames.has(key)||DOT.has(key)||key==='swift'||key==='治疗量增加'||/[\u3400-\u9fff]/.test(key);
 return {key,value,valueUnit:unit,supported};
}

Object.assign(aliases,{agility:'swift','敏捷':'swift','迅捷':'swift'});

/** Exactly matches api.timed: aggregated presentation only, never a source of timers. */
export function projectLegacyTimed(actor,list){
 const out={};for(const effect of list){const key=keyOf(effect),rawTurns=effect.remaining??Math.max(1,(effect.expireAtPhase??actor.phaseCount+1)-actor.phaseCount),turns=Number.isFinite(rawTurns)?rawTurns:-1,value=effect.snapshotDamage??(effect.valueUnit==='ratio'?(effect.value??0)*100:effect.value??1);
  if(!out[key])out[key]={value,turns,stacks:1,...(effect.ruleLabel?{ruleLabel:effect.ruleLabel,ruleData:structuredClone(effect.ruleData)}:{}),...(effect.ruleHidden?{ruleHidden:true}:{})};else{out[key].value=key.startsWith('workshop_status:')?out[key].value+value:Math.max(out[key].value,value);out[key].turns=out[key].turns<0||turns<0?-1:Math.max(out[key].turns,turns);out[key].stacks++;}
 }return out;
}
function comparable(v){if(!v)return '';return JSON.stringify({value:v.value,turns:v.turns,stacks:v.stacks??1,charges:v.charges,instances:v.instances?.map(i=>({value:i.value,turns:i.turns,charges:i.charges,fresh:i.fresh,undispellable:i.undispellable,uncleanseable:i.uncleanseable}))});}
function sameAggregate(a,b){return !!a&&!!b&&number(a.value)===number(b.value)&&number(a.turns,1)===number(b.turns,1)&&number(a.stacks,1)===number(b.stacks,1)&&a.charges===b.charges;}
function actorById(g,id){return [...g.allies,...g.enemies].find(a=>a.id===id);}
function sourceFor(g,target,bucket,options){return actorById(g,options.sourceId)??(bucket==='buffs'?target:target.side==='enemy'?g.player:g.enemies.find(a=>a.hp>0)??target);}
function cleanable(e,bucket){return bucket==='buffs'?e.dispellable!==false&&!e.undispellable:e.cleanseable!==false&&!e.uncleanseable;}
function removeStatus(actor,key,bucket){
 const pools=bucket==='buffs'?['buffs']:['debuffs','dots'];let count=0;
 for(const pool of pools)actor[pool]=actor[pool].filter(e=>{const remove=keyOf(e)===key&&cleanable(e,bucket);if(remove)count++;return !remove;});return count;
}
function instances(entry){
 if(Array.isArray(entry.instances)&&entry.instances.length)return entry.instances;
 const count=Math.max(1,Math.floor(number(entry.stacks,1)));
 return Array.from({length:count},()=>({...entry,value:number(entry.value)/count,instances:undefined}));
}
function importStatus(g,target,rawKey,entry,bucket,options,summary){
 const n=normalizeLegacyStatus(rawKey,entry),source=sourceFor(g,target,bucket,{...options,sourceId:entry.sourceId??options.sourceId}),turns=entry.turns<0?Infinity:Math.max(1,number(entry.turns,1));
 if(!n.supported)summary.unsupportedStatuses.add(rawKey);
 g.legacyBridge??={sequence:0};const id=`legacy:${options.skillId??'external'}:${rawKey}:${++g.legacyBridge.sequence}`;
 if(bucket==='debuffs'&&DOT.has(n.key)){
  // The old effect has already resolved. Store its exact per-tick amount as a
  // source-attack snapshot; all later ticks use new DEF/shield rules and no crit.
  const candidate={kind:'dot',status:rawKey,canonicalStatus:n.key,sourceId:source.id,sourceActor:source,sourceSkill:id,sourceLevel:source.level,snapshotDamage:Math.max(0,number(entry.value)),remaining:Math.min(2,turns),turns:Math.min(2,turns),firstTickPhase:target.phaseCount+1,addedRound:g.round,legacy:true,legacyKey:rawKey,cleanseable:entry.uncleanseable!==true};
  const group=target.dots.filter(e=>keyOf(e)===n.key&&!e.workshopDot);
  if(group.length>=3){const weakest=group.slice().sort((a,b)=>a.snapshotDamage-b.snapshotDamage)[0];if(candidate.snapshotDamage<=weakest.snapshotDamage)return;target.dots.splice(target.dots.indexOf(weakest),1,candidate);}else target.dots.push(candidate);
  summary.statusesImported++;return;
 }
 const effect={kind:bucket==='buffs'?'buff':'debuff',status:rawKey,canonicalStatus:n.key,value:n.value,valueUnit:n.valueUnit,turns,charges:entry.charges,dispellable:entry.undispellable!==true,cleanseable:entry.uncleanseable!==true,legacy:true,legacyKey:rawKey,stackKey:n.key};
 const oldAction=g.action;g.action=null;
 try{if(g.addStatus(source,target,effect,{skillId:id,skipEffectRoll:true}))summary.statusesImported++;}finally{g.action=oldAction;}
}
function patchExisting(actor,key,entry,bucket){
 const list=(bucket==='buffs'?actor.buffs:[...actor.debuffs,...actor.dots]).filter(e=>keyOf(e)===key);
 if(!list.length)return false;
 // An explicit aggregate edit updates only its strongest source. Other sources
  // keep their original identity, independent expiry and attack snapshots.
 const display=e=>e.snapshotDamage??(e.valueUnit==='ratio'?number(e.value)*100:number(e.value));
 const strongest=list.slice().sort((a,b)=>display(b)-display(a))[0];
 if(!cleanable(strongest,bucket))return true;
 const desired=number(entry.value);
 if(strongest.snapshotDamage!==undefined)strongest.snapshotDamage=Math.max(0,desired);
 else strongest.value=strongest.valueUnit==='ratio'?desired/100:desired;
 const currentTurns=strongest.remaining??Math.max(1,(strongest.expireAtPhase??actor.phaseCount+1)-actor.phaseCount);
 if(number(entry.turns,1)!==currentTurns){if(strongest.remaining!==undefined)strongest.remaining=strongest.workshopDot?(entry.turns<0?Infinity:Math.max(1,number(entry.turns,1))):Math.min(2,Math.max(1,number(entry.turns,1)));else strongest.expireAtPhase=entry.turns<0?Infinity:actor.phaseCount+Math.max(1,number(entry.turns,1));}
 if(entry.charges!==undefined)strongest.charges=number(entry.charges);
 const count=Math.max(1,Math.floor(number(entry.stacks,list.length)));
 if(count<list.length){const keep=new Set(list.slice().sort((a,b)=>display(b)-display(a)).slice(0,count));for(const pool of bucket==='buffs'?['buffs']:['debuffs','dots'])actor[pool]=actor[pool].filter(e=>keyOf(e)!==key||keep.has(e)||!cleanable(e,bucket));}
 return true;
}
function syncStatuses(g,actor,dto,bucket,options,summary){
 if(!own(dto,bucket))return;
 const incoming=dto[bucket]??{},expected=projectLegacyTimed(actor,bucket==='buffs'?actor.buffs:[...actor.debuffs,...actor.dots]);
 actor.flags.legacyBridgeInput??={};const previous=actor.flags.legacyBridgeInput[bucket]??{};
 const next=Object.fromEntries(Object.entries(incoming).map(([k,v])=>[k,comparable(v)]));
 if(!options.initial){for(const key of Object.keys(expected))if(!own(incoming,key)&&!Object.keys(incoming).some(k=>(aliases[k]??k)===key))summary.statusesRemoved+=removeStatus(actor,key,bucket);}
 for(const [rawKey,entry]of Object.entries(incoming)){
  if(!entry||typeof entry!=='object')continue;
  const canonical=aliases[rawKey]??rawKey,projected=expected[rawKey]??expected[canonical];
  if(!options.initial&&comparable(entry)===previous[rawKey])continue;
  if(!options.initial&&sameAggregate(projected,entry)&&!entry.instances?.some(i=>i.fresh))continue;
  const fresh=entry.instances?.filter(i=>i.fresh);
  if(!options.initial&&projected&&fresh?.length){for(const instance of fresh)importStatus(g,actor,rawKey,instance,bucket,options,summary);continue;}
  if(!options.initial&&projected&&rawKey===canonical&&patchExisting(actor,canonical,entry,bucket)){summary.statusesChanged++;continue;}
  for(const instance of instances(entry))importStatus(g,actor,rawKey,instance,bucket,options,summary);
 }
 actor.flags.legacyBridgeInput[bucket]=next;
}
function syncScalars(actor,dto,summary){
 for(const [field,source]of [['hp','hp'],['shield','shield']])if(typeof dto[source]==='number'&&Math.ceil(actor[field])!==dto[source]){actor[field]=Math.max(0,dto[source]);summary.scalarsChanged++;}
 if(typeof dto.hpMax==='number'&&Math.ceil(actor.maxHp)!==dto.hpMax){actor.maxHp=Math.max(1,dto.hpMax);summary.scalarsChanged++;}
 const fields={attack:'attack',defense:'defense',speed:'speed',critRate:'crit',critDamage:'critDamage',effectHit:'ehr',effectResist:'res'};
 for(const [field,stat]of Object.entries(fields))if(typeof dto[field]==='number'&&actor.stats[stat]!==dto[field]){actor.stats[stat]=dto[field];summary.scalarsChanged++;}
}
function newAlly(g,dto,id,kind){
 const owner=kind==='companion-summon'?'caelian':'player',hpMax=Math.max(1,number(dto.hpMax,number(dto.hp,1)));
 const actor={id,side:'player',level:number(dto.level,g.player.level),name:dto.name??id,hp:Math.max(0,number(dto.hp,hpMax)),maxHp:hpMax,shield:Math.max(0,number(dto.shield)),stats:{hp:hpMax,attack:number(dto.attack),defense:number(dto.defense),speed:number(dto.speed,100),crit:number(dto.critRate),critDamage:number(dto.critDamage,50),ehr:number(dto.effectHit),res:number(dto.effectResist)},buffs:[],debuffs:[],dots:[],resources:{},flags:{legacyManaged:true},cooldowns:{},ownerId:owner,star:1,attackable:dto.attackable!==false,mechanical:dto.mechanical===true};
 if(kind==='companion')actor.isCompanion=true;
 if(kind==='companion-summon')actor.isCompanionSummon=true;
 if(kind==='summon'){actor.legacySummon=true;actor.isSummon=false;actor.slot=[0,1].find(i=>!g.allies.some(a=>a.hp>0&&(a.isSummon||a.legacySummon)&&a.slot===i));if(actor.slot===undefined){const old=g.allies.filter(a=>a.hp>0&&(a.isSummon||a.legacySummon)).sort((a,b)=>(a.expiresRound??0)-(b.expiresRound??0)||a.id.localeCompare(b.id))[0];actor.slot=old?.slot??0;if(old){old.hp=0;old.removedByPlayer=true;}}actor.bornRound=g.round;actor.expiresRound=g.round+Math.max(1,number(dto.duration,3));actor.legacySkills=structuredClone(dto.skills??[]);}
 g.ensureActor(actor);g.allies.push(actor);return actor;
}

/**
 * Imports only explicit changes to the last displayed values. Legacy summon
 * actions stay with BattleRepository; the new core includes them as targets.
 */
export function syncLegacyActors(g,state,options={}){
 const summary={scalarsChanged:0,statusesImported:0,statusesChanged:0,statusesRemoved:0,actorsAdded:[],actorsRemoved:[],unsupportedStatuses:new Set()};
 const rows=[{id:'player',dto:state.player,kind:'player'},...state.enemies.map(dto=>({id:dto.id,dto,kind:'enemy'}))];
 if(state.companion)rows.push({id:'caelian',dto:state.companion,kind:'companion'});
 for(const dto of state.player.summons??[])rows.push({id:dto.id,dto,kind:'summon'});
 for(const dto of state.companion?.summons??[])rows.push({id:dto.id,dto,kind:'companion-summon'});
 for(const row of rows){let actor=actorById(g,row.id);if(!actor&&['summon','companion','companion-summon'].includes(row.kind)){actor=newAlly(g,row.dto,row.id,row.kind);summary.actorsAdded.push(actor.id);}if(!actor)continue;
  g.ensureActor(actor);if(!options.initial||row.kind!=='enemy')syncScalars(actor,row.dto,summary);
  syncStatuses(g,actor,row.dto,'buffs',options,summary);syncStatuses(g,actor,row.dto,'debuffs',options,summary);
  if(actor.legacySummon){const shown=Math.max(0,actor.expiresRound-g.round);if(typeof row.dto.duration==='number'&&shown!==row.dto.duration)actor.expiresRound=g.round+Math.max(0,row.dto.duration);actor.legacySkills=structuredClone(row.dto.skills??actor.legacySkills);}
 }
 if(!options.initial){const present=new Set(rows.map(r=>r.id));for(const actor of g.allies)if((actor.isSummon||actor.legacySummon||actor.isCompanionSummon)&&actor.hp>0&&!present.has(actor.id)){actor.hp=0;actor.removedByPlayer=true;summary.actorsRemoved.push(actor.id);}}
 if(typeof state.player.ap==='number'&&!options.initial)g.player.ap=state.player.ap;
 if(typeof state.player.gold==='number')g.player.gold=state.player.gold;
 return {...summary,unsupportedStatuses:[...summary.unsupportedStatuses]};
}
export function importInitialLegacyState(g,state,options={}){return syncLegacyActors(g,state,{...options,initial:true});}
export function legacySummonActors(g){return g.allies.filter(a=>a.legacySummon&&a.hp>0);}
export function companionSummonActors(g){return g.allies.filter(a=>a.isCompanionSummon&&a.hp>0);}
