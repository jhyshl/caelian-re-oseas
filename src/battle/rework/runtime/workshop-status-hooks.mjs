/* Attach to live cores only. No status timers or source identities are rewritten. */
const attached=new WeakMap();
const finite=v=>typeof v==='number'&&Number.isFinite(v)?v:0;
const cap=(n,min,max)=>Math.max(min,Math.min(max,n));
/**
 * value(actor,type,g) returns the SUM of manifest effect.value * live status stacks.
 * emit(trigger,event,g) is the same noncheckpoint project/run/sync port as damage hooks.
 * turnDamage(actor,amount,g) is optional: use the existing directHpLoss for custom fixed ticks.
 * afterTick(actor,g) can stabilize dummy/player-invincible testing and sync in-place.
 */
export function installWorkshopStatusHooks(g,ports){
 const prior=attached.get(g);if(prior){prior.ports=ports;return;}
 const runtime={ports,depth:0};attached.set(g,runtime);
 const original={directBonus:g.directBonus,incomingReduction:g.incomingReduction,addStatus:g.addStatus,addDot:g.addDot,beginPhase:g.beginPhase};
 const value=(actor,type)=>Math.max(0,finite(runtime.ports.value?.(actor,type,g)));
 function beforeDebuff(source,target,e,opts){
  // Legacy DTO imports already passed the repository's before_debuff / immunity.
  if(e.legacy&&opts.skipEffectRoll)return true;
  const side=target.id==='player'?'player':target.side==='enemy'?'enemy':target.isCompanion?'companion':'summon';
  const event={status:e.canonicalStatus??e.status,target_side:side,target_id:target.id,target_is_player:side==='player'?1:0,target_is_enemy:side==='enemy'?1:0,target_is_summon:side==='summon'?1:0,sourceSide:source.side==='enemy'?'enemy':source.id==='player'?'player':'summon',sourceId:source.id};
  let result=event;
  if(runtime.depth<4){runtime.depth++;try{result=runtime.ports.emit?.('before_debuff',event,g)??event;}finally{runtime.depth--;}}
  if(result.cancel===true||value(target,'debuff_immunity')>0){g.log('workshop_immunity',{source:source.id,target:target.id,status:event.status});return false;}
  return true;
 }
 g.directBonus=(source,target)=>original.directBonus(source,target)+value(source,'damage_bonus')/100;
 g.incomingReduction=target=>cap(original.incomingReduction(target)+value(target,'damage_reduction')/100,0,.6);
 g.addStatus=(source,target,e,opts={})=>!target||target.hp<=0?false:(e.kind??e.type)==='debuff'&&!beforeDebuff(source,target,e,opts)?false:original.addStatus(source,target,e,opts);
 g.addDot=(source,target,e,opts={})=>!target||target.hp<=0||!beforeDebuff(source,target,e,opts)?false:original.addDot(source,target,e,opts);
 g.beginPhase=actor=>{
  const allowed=original.beginPhase(actor);
  // Includes the phase index in serialized actor flags: restores/duplicate phase hooks cannot double-tick.
  if(actor.hp>0&&actor.flags.workshopTickPhase!==actor.phaseCount){
   actor.flags.workshopTickPhase=actor.phaseCount;
   const heal=value(actor,'turn_heal'),shield=value(actor,'turn_shield'),damage=value(actor,'turn_damage');
   if(heal>0)g.heal(actor,actor,heal);
   if(shield>0)g.shield(actor,actor,shield);
   if(damage>0){if(runtime.ports.turnDamage)runtime.ports.turnDamage(actor,damage,g);else g.rawHit(actor,actor,damage,{dot:true,shieldBypass:1,origin:'workshop_status'});}
   runtime.ports.afterTick?.(actor,g);
  }
  return allowed&&actor.hp>0;
 };
}

/** Standalone manifest evaluation from native status records; never from stale DTO aggregates. */
export function workshopNativeStatusValue(actor,type,manifests,activeIds){
 const enabled=new Set(activeIds??[]);let total=0;
 for(const manifest of manifests??[]){if(!enabled.has(manifest.id))continue;
  for(const status of manifest.statuses??[]){
   const key=`workshop_status:${manifest.id}:${status.id}`;
   const list=status.polarity==='buff'?actor.buffs:[...actor.debuffs,...actor.dots];
   const stacks=list.filter(e=>(e.canonicalStatus??e.status)===key).reduce((sum,e)=>sum+Math.max(0,finite(e.value)),0);
   if(stacks>0)for(const effect of status.effects??[])if(effect.type===type)total+=finite(effect.value)*stacks;
  }
 }
 return total;
}
