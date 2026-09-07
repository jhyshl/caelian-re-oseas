// Attach only to the live runtime. These callbacks are deliberately not serialized.
const installed=new WeakMap();
const safe=(value,fallback=0)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const side=a=>a.id==='player'?'player':a.side==='enemy'?'enemy':a.isCompanion?'companion':'summon';
const identity=(source,target)=>({sourceSide:side(source),sourceId:source.id,targetSide:side(target),targetId:target.id,target_is_player:target.id==='player'?1:0,target_is_enemy:target.side==='enemy'?1:0,target_is_summon:target.side!=='enemy'&&target.id!=='player'&&!target.isCompanion?1:0});
/**
 * ports.emit(trigger,event,g) must:
 * 1. Project the live core to its transaction DTO WITHOUT snapshot/endAction.
 * 2. Run BattleRepository.runWorkshopMechanisms against that DTO.
 * 3. Sync DTO mutations back into THIS core, never hydrate another core.
 * ports.currentCard() returns the repository's activeMechanismCard metadata.
 */
export function installWorkshopDamageHooks(g,ports){
 if(installed.has(g)){installed.get(g).ports=ports;return;}
 const runtime={ports,depth:0};installed.set(g,runtime);
 const originalDamage=g.damage,originalRawHit=g.rawHit,originalBase=g.calcBase;
 function event(trigger,data){if(runtime.depth>=4)return data;runtime.depth++;try{return runtime.ports.emit(trigger,data,g)??data;}finally{runtime.depth--;}}
 function cardData(){const c=runtime.ports.currentCard?.()??{};return {cardId:c.id??'',cardName:c.name??'',cardType:c.type??'',cardTags:c.tags??[]};}
 // The override is an already-scaled base packet. Applying it here avoids
 // multiplying card stars, group share or action outputScale for a second time.
 g.calcBase=(source,target,e,options={})=>typeof options.workshopBaseOverride==='number'?options.workshopBaseOverride:originalBase(source,target,e,options);
 g.damage=(source,target,e,options={})=>{
  if(!source||!target||source.hp<=0||target.hp<=0)return originalDamage(source,target,e,options);
  const origin=options.origin??(e.dotConversion||options.dotConversion?'dot':'attack');
  const base=originalBase(source,target,e,options),hadIgnoreDefense=options.ignoreDefense===1;
  const before={...identity(source,target),...cardData(),amount:base,ignoreDefense:options.ignoreDefense===1,origin};
  const modified=origin==='defense_reflect'?before:event('before_damage',before);
  if(modified.cancel===true){g.action?.hitCache?.set(source.id+'>'+target.id,false);return {damage:0,hpDamage:0,shieldDamage:0,hit:false,crits:0,cancelled:true};}
  const next={...options,workshopBaseOverride:Math.max(0,safe(modified.amount,base))};
  if(modified.ignoreDefense===true)next.ignoreDefense=1;
  else if(modified.ignoreDefense===false&&hadIgnoreDefense)next.ignoreDefense=0;
  return originalDamage(source,target,e,next);
 };
 g.rawHit=(source,target,amount,options={})=>{
  const result=originalRawHit(source,target,amount,options);
  if(result.hpDamage>0&&(target.id==='player'||target.side==='enemy'))event(target.id==='player'?'player_damaged':'enemy_damaged',{...identity(source,target),...cardData(),amount:result.hpDamage,absorbed:result.shieldDamage,dot:options.dot===true,origin:options.dot?'dot':options.origin??'attack'});
  runtime.ports.afterDamage?.(result,g);
  return result;
 };
}

/** Keep nested mechanism/companion hits inside the active core and restore the parent action. */
export function damageOnLiveCore(g,sourceId,targetId,amount,label,options={}){
 const all=[...g.allies,...g.enemies],source=all.find(a=>a.id===sourceId),target=all.find(a=>a.id===targetId);
 if(!source||!target||amount<=0)return {damage:0,hpDamage:0,shieldDamage:0,hit:false,crits:0};
 const parent=g.action;g.action=null;
 try{g.beginAction(source,{id:'legacy:'+label,name:label});return g.damage(source,target,{kind:'damage',flat:Math.max(0,safe(amount)),atk:0,crit:options.fixedAmount?false:options.crit!==false,hits:1},{...options,flatScale:1,star:1,ignoreDefense:options.ignoreDefense?1:0,forceHit:options.fixedAmount||options.ignoreAgility?true:options.forceHit,ignoreDirectBonuses:options.fixedAmount===true||options.ignoreDirectBonuses===true,secondary:options.secondary===true,origin:options.origin??'attack'});}
 finally{g.endAction();g.action=parent;}
}
