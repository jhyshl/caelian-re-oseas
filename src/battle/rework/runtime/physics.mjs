import catalogData from '../catalog.json' with { type: 'json' };
export const catalog=catalogData;
export const clamp=(x,lo=0,hi=1)=>Math.max(lo,Math.min(hi,x));
export function seeded(seed){let x=seed>>>0;const rng=()=>{x=(x+0x6D2B79F5)>>>0;let t=x;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};rng.getState=()=>x;rng.setState=v=>{x=v>>>0;};return rng;}
export function makeTurnMetrics(){return {damageCards:0,buffCards:0,defenseCards:0,healCards:0,drawCards:0,spellCards:0,cardsPlayed:0,aoeCards:0,apSpent:0,damage:0,hpDamage:0,shieldGained:0,healing:0,cleanse:0,dispel:0,drawn:0,endShield:0,endHp:0,dotsAtEnd:0,anyDodge:false,hpDamageByTarget:{},hitsByTarget:{},damageByTarget:{},shieldBrokenByTarget:{},dodgesByTarget:{}};}
export function actor(id,side,level,stats,definition=null){return {id,side,level,hp:stats.hp,maxHp:stats.hp,shield:0,stats:{...stats},definition,buffs:[],debuffs:[],dots:[],resources:{},flags:{},cooldowns:{},phaseCount:0,healingGiven:0,healingReceived:0,receivedThisTurn:makeTurnMetrics(),receivedLastTurn:makeTurnMetrics(),thisTurn:makeTurnMetrics(),lastTurn:makeTurnMetrics()};}
const hard=new Set(['hard_control','freeze','sleep','stun','petrify']);
const aliases={...catalog.rules.statusFamilies.dotAliases,'易伤':'vulnerable','虚弱':'weak','速度降低%':'speed_down','速度增加':'speed_up','攻击力增加':'attack_up','防御增加':'defense_up','嘲讽':'taunt','冻结':'freeze','眩晕':'stun','沉眠':'sleep','光缚':'hard_control','石化':'petrify','禁疗':'healing_down','受到直接伤害降低':'direct_damage_reduction'};
export const canonical=s=>['agility','敏捷','迅捷'].includes(s)?'swift':aliases[s]??s;
export function ratio(e){if(e.valueUnit==='count')return e.value??1;if(e.valueUnit==='percent')return (e.value??0)/100;if(e.valueUnit==='ratio')return e.value??0;return Math.abs(e.value??0)>1?(e.value??0)/100:e.value??0;}
const key=e=>canonical(e.canonicalStatus??e.status??'');
const uniqueStrong=(items)=>{const m=new Map();for(const e of items){const k=e.stackKey??key(e);if(!m.has(k)||ratio(e)>ratio(m.get(k)))m.set(k,e);}return [...m.values()];};
export function makeGame(player,enemies,options={}){
 const g={player,enemies,allies:[player],round:0,phase:'init',events:[],trace:options.trace?[]:null,seed:options.seed??1,rng:seeded((options.seed??1)^0x824234),hitRng:seeded((options.seed??1)^0x889aad),effectRng:seeded((options.seed??1)^0x775399),critRng:seeded((options.seed??1)^0x237aab),options,action:null,teamTauntUntil:{player:0,enemy:0},teamDotApplications:{},audit:{effects:{},statusUnitsCorrected:0},totals:{playerDamage:0,playerHpDamage:0,enemyDamage:0,enemyHpDamage:0,playerShield:0,playerHealing:0,enemyHealing:0,enemyShield:0,dotDamage:0,cards:0,crits:0,controls:0,enemyActions:0,maxPlayerHitFraction:0,maxPlayerTurnLossFraction:0}};
 g.ensureActor=a=>{a.phaseCount??=0;a.flags??={};a.buffs??=[];a.debuffs??=[];a.dots??=[];a.thisTurn??=makeTurnMetrics();a.lastTurn??=makeTurnMetrics();a.receivedThisTurn??=makeTurnMetrics();a.receivedLastTurn??=makeTurnMetrics();a.healingGiven??=0;a.healingReceived??=0;return a;};
 g.livingEnemies=()=>g.enemies.filter(a=>a.hp>0);
 g.livingAllies=()=>g.allies.filter(a=>a.hp>0);
 g.log=(type,detail={})=>{if(g.trace)g.trace.push({round:g.round,...detail,detailType:detail.type,type});};
 g.endAction=()=>{if(g.action?.chargeUsed)for(const e of g.action.chargeUsed){if(e.charges>0)e.charges--;for(const a of [...g.allies,...g.enemies]){a.buffs=a.buffs.filter(x=>x.charges!==0);a.debuffs=a.debuffs.filter(x=>x.charges!==0);}}g.action=null;};
 g.beginAction=(source,skill={})=>{g.endAction();g.action={source,skill,hitCache:new Map(),effectHitCache:new Map(),chargeUsed:new Set()};g.log('action_start',{source:source.id,name:skill.name??skill.id,uid:skill.uid});};
 g.status=(a,name)=>{const k=canonical(name);if(k==='swift')return a.buffs.filter(e=>key(e)===k).length;const dots=a.dots.filter(e=>key(e)===k);if(dots.length)return dots.length;return Math.max(0,...[...a.buffs,...a.debuffs].filter(e=>key(e)===k||e.status===name).map(e=>e.value??1));};
 g.hasStatus=(a,name)=>{if(!a)return false;const k=canonical(name);return [...a.buffs,...a.debuffs,...a.dots].some(e=>key(e)===k||e.status===name);};
 g.statusRatio=(a,name)=>Math.max(0,...[...a.buffs,...a.debuffs].filter(e=>key(e)===canonical(name)).map(ratio));
 g.stat=(a,k)=>{
  g.ensureActor(a);let v=a.stats[k]??0;
  if(k==='attack'){v+=g.status(a,'strength');v*=1+g.statusRatio(a,'attack_up');}
  if(k==='defense')v+=g.status(a,'fortitude');
  if(k==='defense')v*=Math.max(0,(1+g.statusRatio(a,'defense_up'))*(1-g.statusRatio(a,'armor_break')));
  if(k==='speed'){
   const up=a.buffs.filter(e=>key(e)==='speed_up'),down=a.debuffs.filter(e=>key(e)==='speed_down');
   const flat=up.filter(e=>e.speedFlat).map(e=>e.value);
   v=v*(1+.2*g.status(a,'swift')+Math.max(0,...up.filter(e=>!e.speedFlat).map(ratio)))+Math.max(0,...flat);
   v*=1-Math.max(0,...down.map(ratio));v=Math.max(1,v);
  }
  if(k==='res')v=clamp(v+100*g.statusRatio(a,'效果抵抗增加'),0,80);
  if(['ehr','res'].includes(k))v=clamp(v,0,80);if(k==='crit')v=clamp(v,0,100);if(k==='critDamage')v=clamp(v,0,250);
  return Math.max(0,v);
 };
 g.friendTeam=s=>s.side==='enemy'?g.livingEnemies():g.livingAllies();
 g.foeTeam=s=>(s.side==='enemy'?g.livingAllies():g.livingEnemies()).filter(a=>a.attackable!==false);
 g.targets=(source,effect,chosen)=>{
  const t=effect.target??'enemy',friends=g.friendTeam(source),foes=g.foeTeam(source);
  if(t==='self')return [source];
  if(t==='all_enemies')return foes;
  if(t==='all_allies')return effect.selector?.includes('召唤')?friends.filter(a=>a!==g.player):friends;
  if(t==='ally'||t==='lowest_hp_ally'||t==='ally_lowest_hp')return [chosen?.side===source.side&&chosen.hp>0?chosen:[...friends].sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.id.localeCompare(b.id))[0]].filter(Boolean);
  if(t==='all_other_allies')return friends.filter(a=>a!==source);
  let target=chosen?.side!==source.side&&chosen?.hp>0?chosen:foes[0];
  if(['damage','dot','debuff','dispel'].includes(effect.kind??effect.type)&&!effect.ignoreTaunt){target=foes.find(a=>g.hasStatus(a,'taunt'))??target;}
  return target?[target]:[];
 };
 g.effectChance=(source,target,e)=>clamp((e.baseChance??100)/100*(1+g.stat(source,'ehr')/100)*(1-g.stat(target,'res')/100));
 g.evasion=(source,target)=>clamp(.05+.5*(g.stat(target,'speed')-g.stat(source,'speed'))/Math.max(1,g.stat(target,'speed')+g.stat(source,'speed'))+g.statusRatio(target,'evasion_up')-g.statusRatio(target,'evasion_down'),0,.9);
 g.effectSucceeds=(source,target,e,opts={})=>{const cache=opts.secondary?null:g.action?.effectHitCache;const k=source.id+'>'+target.id+':'+key(e);if(cache?.has(k))return cache.get(k);const success=g.effectRng()<g.effectChance(source,target,e);cache?.set(k,success);return success;};
 g.directBonus=(source,target)=>{
  let v=0;for(const e of uniqueStrong(source.buffs)){
   const s=key(e);if(/下张|下一|本卡|同名连击|理智献祭/.test(s))continue;
   if(['直接增伤','直接伤害提高%','direct_damage_up','damage_up'].includes(s))v+=ratio(e);
   if(s==='血月猎杀')v+=.2;
   if(s==='召唤直接伤害提高%'&&source.isSummon)v+=ratio(e);
   if(s==='对吸血鬼或不死直接增伤'&&target.definition?.tags?.some(t=>/undead|vampire|不死|吸血鬼/.test(t)))v+=ratio(e);
  }return v;
 };
 g.incomingReduction=target=>clamp(uniqueStrong(target.buffs).filter(e=>key(e)==='direct_damage_reduction'||key(e)==='下一次直接受伤降低%').reduce((a,e)=>a+ratio(e),0),0,.6);
 g.calcBase=(source,target,e,opts={})=>{
  const sf=1+.1*((opts.star??source.star??1)-1),flat=(e.flat??0)*(opts.flatScale??(source.side==='enemy'?(20+2*source.level)/60:1)),atk=opts.attackOverride??opts.sourceSnapshot?.attack??g.stat(source,'attack');
  const h=(e.maxHp??e.maxHpRatio??e.hpRatio??0)*target.maxHp;
  return ((flat+(e.atk??0)*atk+(e.def??0)*g.stat(source,'defense'))*sf+h)*(opts.scale??1)*(g.action?.source?.id===source.id?(g.action.outputScale??1):1);
 };
 g.rawHit=(source,target,amount,{dot=false,secondary=false,hit=true,crits=0,...rest}={})=>{
  if(!Number.isFinite(amount)||amount<0)throw new Error('Invalid damage '+JSON.stringify({amount,source:source.id,target:target.id}));
  g.ensureActor(source);g.ensureActor(target);const beforeHP=target.hp,beforeShield=target.shield,absorbed=Math.min(target.shield,amount*(1-clamp(rest.shieldBypass??0))),shieldDamage=absorbed+Math.min(Math.max(0,target.shield-absorbed),absorbed*Math.max(0,rest.shieldDamageBonus??0));if(!dot&&hit)target.debuffs=target.debuffs.filter(e=>key(e)!=='sleep');target.shield-=shieldDamage;
  let hpDamage=Math.min(target.hp,Math.max(0,amount-absorbed));
  if(hpDamage>=target.hp&&target.hp>1){const save=target.buffs.find(e=>key(e)==='濒死保留1HP');if(save){hpDamage=target.hp-1;target.buffs.splice(target.buffs.indexOf(save),1);}}
  target.hp-=hpDamage;const actual=hpDamage+shieldDamage;
  const ally=source.side!=='enemy';g.totals[ally?'playerDamage':'enemyDamage']+=actual;g.totals[ally?'playerHpDamage':'enemyHpDamage']+=hpDamage;if(dot)g.totals.dotDamage+=actual;
  if(target===player)g.totals.maxPlayerHitFraction=Math.max(g.totals.maxPlayerHitFraction,actual/target.maxHp);
  const metric=ally?player.thisTurn:source.thisTurn;metric.damage+=actual;metric.hpDamage+=hpDamage;if(!dot)metric.damageByTarget[target.id]=(metric.damageByTarget[target.id]??0)+actual;metric.hpDamageByTarget[target.id]=(metric.hpDamageByTarget[target.id]??0)+hpDamage;
  if(!dot)metric.hitsByTarget[target.id]=(metric.hitsByTarget[target.id]??0)+1;
  if(beforeShield>0&&target.shield===0)metric.shieldBrokenByTarget[target.id]=(metric.shieldBrokenByTarget[target.id]??0)+1;
  target.receivedThisTurn.damage+=actual;target.receivedThisTurn.hpDamage+=hpDamage;
  const out={source,target,damage:actual,hpDamage,shieldDamage,hit,crits,crit:crits>0,dot,secondary,...rest};
  g.events.push(out);if(g.events.length>100)g.events.shift();
  g.log('damage',{source:source.id,target:target.id,damage:actual,hpDamage,shieldDamage,dot,crits,hp:target.hp,shield:target.shield});
  if(target.side==='enemy')g.notifyEnemyDamaged?.(g,target,source,out);if(!dot)g.afterIncomingDamage?.(out);
  if(beforeHP>0&&target.hp<=0){g.log('death',{id:target.id});g.onDeath?.(target,source);}
  return out;
 };
 g.damage=(source,target,e,opts={})=>{
  if(!target||target.hp<=0||source.hp<=0&&!opts.allowDeadSource)return {damage:0,hpDamage:0,shieldDamage:0,hit:false,crits:0};
  const secondary=e.secondary||opts.secondary,hitKey=source.id+'>'+target.id,cache=!secondary?g.action?.hitCache:null;
  let hit=opts.attackHit??opts.forceHit??cache?.get(hitKey);
   if(hit===undefined){const ev=g.evasion(source,target);hit=g.hitRng()>=Math.max(0,ev-(opts.hitBonus??0));cache?.set(hitKey,hit);}
  if(!hit){const m=source.side==='enemy'?source.thisTurn:player.thisTurn;m.anyDodge=true;m.dodgesByTarget[target.id]=(m.dodgesByTarget[target.id]??0)+1;target.flags.dodgedThisRound=true;g.log('miss',{source:source.id,target:target.id});return {damage:0,hpDamage:0,shieldDamage:0,hit:false,crits:0};}
  const K=100+5*source.level,def=g.stat(target,'defense')*(1-clamp(opts.ignoreDefense??e.ignoreDefense??0));
  const ignoreDirect=opts.ignoreDirectBonuses||e.ignoreDirectBonuses||e.dotConversion||opts.dotConversion;
  const weak=ignoreDirect?0:Math.max(g.statusRatio(source,'weak'),g.statusRatio(source,'fear'))+g.statusRatio(source,'本回合直接伤害降低%');
  if(!ignoreDirect)for(const e of source.debuffs)if(['weak','fear'].includes(key(e))&&e.charges>0)g.action?.chargeUsed?.add(e);
  if(!ignoreDirect){const oneShot=target.buffs.filter(e=>key(e)==='下一次直接受伤降低%'&&e.charges>0).sort((a,b)=>ratio(b)-ratio(a))[0];if(oneShot)g.action?.chargeUsed?.add(oneShot);}
  const bonus=ignoreDirect?0:clamp(g.directBonus(source,target)+(opts.directBonus??0),0,.6);
  const vuln=ignoreDirect?0:clamp(g.statusRatio(target,'vulnerable'),0,.4);
  const base=g.calcBase(source,target,e,opts)*(1+bonus)*Math.max(0,1-weak)*K/(K+def)*(1+vuln)*(ignoreDirect?1:1-g.incomingReduction(target))*(target.flags.sanityLow&&!ignoreDirect?1.15:1);
  let amount=0,crits=0,maxHit=0;const hits=Math.max(1,e.hits??1),cr=clamp(opts.sourceSnapshot?.crit??g.stat(source,'crit'),0,100),cd=clamp(opts.sourceSnapshot?.critDamage??g.stat(source,'critDamage'),0,250);
  for(let i=0;i<hits;i++){const c=e.crit!==false&&g.critRng()<cr/100;const part=base/hits*(c?1+cd/100:1);amount+=part;maxHit=Math.max(maxHit,part);crits+=Number(c);}
  g.totals.crits+=crits;
  return g.rawHit(source,target,Math.max(1,amount),{hit:true,crits,maxHit:Math.min(maxHit,target.hp+target.shield),secondary,dot:Boolean(e.dotConversion||opts.dotConversion),shieldBypass:e.shieldBypass??0,shieldDamageBonus:e.shieldDamageBonus??0,skillId:g.action?.skill?.id});
 };
 g.healBudgetRemaining=(source,target)=>{
  if(source.side!=='enemy')return Math.max(0,target.maxHp-target.hp);
  const tier=source.definition?.tier??'normal',targetTier=target.definition?.tier??'normal';
  const casterCap=source.maxHp*(tier==='boss'?.15:tier==='elite'?.36:.24);
  const recipientCap=target.maxHp*(targetTier==='boss'?.15:.30);
  return Math.max(0,Math.min(target.maxHp-target.hp,casterCap-(source.healingGiven??0),recipientCap-(target.healingReceived??0)));
 };
 g.heal=(source,target,e,opts={})=>{
  if(!target||target.hp<=0)return 0;let amount=typeof e==='number'?e:g.calcBase(source,target,e,opts);
  if(!opts.finalAmount){const up=g.statusRatio(source,'治疗量增加')+g.statusRatio(source,'治疗与护盾提高%');amount*=1+up;amount*=1-g.statusRatio(target,'healing_down');}
  const originalAmount=Math.max(0,amount),event={sourceId:source.id,targetId:target.id,amount:originalAmount,originalAmount};
  g.workshopProgramEvent?.('before_heal',event);const remaining=event.cancel?0:Math.max(0,event.amount),absorbed=Math.max(0,originalAmount-remaining),overflow=Math.max(0,remaining-(target.maxHp-target.hp));
  amount=Math.max(0,Math.min(remaining,g.healBudgetRemaining(source,target,e)));target.hp+=amount;source.healingGiven=(source.healingGiven??0)+amount;target.healingReceived=(target.healingReceived??0)+amount;
  const owner=source.side==='enemy'?source:player;owner.thisTurn.healing+=amount;g.totals[source.side==='enemy'?'enemyHealing':'playerHealing']+=amount;
  const result={sourceId:source.id,targetId:target.id,amount,originalAmount,absorbed,overflow};g.lastHealResult=result;
  g.log('heal',{source:source.id,target:target.id,amount,hp:target.hp,shield:target.shield});g.workshopProgramEvent?.('after_heal',result);g.lastHealResult=result;return amount;
 };
 g.shield=(source,target,e,opts={})=>{
  if(!target||target.hp<=0)return 0;let amount=typeof e==='number'?e:g.calcBase(source,target,e,opts);
  if(!opts.finalAmount)amount*=1+g.statusRatio(source,'治疗与护盾提高%');
  const before=target.shield;amount=Math.max(0,Math.min(amount,target.maxHp*Math.min(e.capTargetMaxHp??.6,target.side==='enemy'?.6:(g.options.patch?.playerShieldCap??.6))-before));target.shield+=amount;
  (source.side==='enemy'?source:player).thisTurn.shieldGained+=amount;g.totals[source.side==='enemy'?'enemyShield':'playerShield']+=amount;g.log('shield',{source:source.id,target:target.id,amount,hp:target.hp,shield:target.shield});return amount;
 };
 g.addStatus=(source,target,e,opts={})=>{
  if(!target||target.hp<=0)return false;g.ensureActor(target);g.ensureActor(source);const kind=e.kind??e.type,k=key(e),isDebuff=kind==='debuff';
  if(isDebuff&&!opts.skipEffectRoll&&!g.effectSucceeds(source,target,e,opts))return false;
  if(hard.has(k)&&target.phaseCount+1<=(target.flags.controlImmuneUntil??-1))return false;
  if(k==='taunt'){
   if((g.teamTauntUntil[target.side]??0)>g.round||g.friendTeam(target).some(a=>a!==target&&g.hasStatus(a,'taunt')))return false;
   if(g.hasStatus(target,'taunt'))return false;
   g.teamTauntUntil[target.side]=g.round+2;
  }
  const record={...e,canonicalStatus:k,sourceId:source.id,sourceSkill:opts.skillId??g.action?.skill?.id??'',addedRound:g.round,turns:e.turns??(k==='swift'?2:1),charges:e.charges??(String(e.status).includes('禁言：下次支援')?1:undefined),sourceActor:source};
  if(k==='swift'){
   const count=Math.max(1,Math.floor(Number(e.stacks??1)));if(!Number.isSafeInteger(count))throw Error('Invalid swift stack count');
   const active=target.flags.phaseRound===g.round&&g.phase===target.side;
   for(let i=0;i<count;i++)target.buffs.push({...record,status:'swift',value:1,valueUnit:'count',stacks:1,expireMode:'end',expireAtPhase:target.phaseCount+Math.max(1,record.turns)-(active?1:0)});
   g.log('buff',{source:source.id,target:target.id,status:'swift',value:count});return true;
  }
  record.speedFlat=k==='speed_up'&&e.status==='速度增加'&&Math.abs(e.value)>1;
  if(record.speedFlat)g.audit.statusUnitsCorrected++;
  if(isDebuff){record.expireAtPhase=target.phaseCount+Math.max(1,record.turns);record.expireMode='end';}
  else{record.expireAtPhase=target.phaseCount+Math.max(1,record.turns)+(source.side===target.side&&target!==source&&target.flags.phaseRound!==g.round?1:0);record.expireMode='start';}
  if(k==='taunt'){record.expireMode='opponent_end';record.expireSide=target.side==='enemy'?'player':'enemy';record.expireRound=g.round+(target.side==='enemy'?1:0)+Math.max(0,record.turns-1);}
  const list=isDebuff?target.debuffs:target.buffs,idx=list.findIndex(x=>key(x)===k&&x.sourceId===record.sourceId&&x.sourceSkill===record.sourceSkill);
  if(idx>=0&&ratio(list[idx])<=ratio(record))list.splice(idx,1);list.push(record);g.log(kind,{source:source.id,target:target.id,status:k,value:e.value});return true;
 };
 g.addDot=(source,target,e,opts={})=>{
  if(!target||target.hp<=0||!opts.skipEffectRoll&&!g.effectSucceeds(source,target,e,opts))return false;
  const k=key(e),targetKey=target.id+':'+g.round;
  source.flags.dotApplications??={};let room=Math.max(0,2-(source.flags.dotApplications[g.round+':'+target.id]??0));
  if(source.side==='enemy')room=Math.min(room,3-(g.teamDotApplications[targetKey]??0));
  const count=Math.min(e.stacks??1,room);if(!count)return false;
  let applied=0;for(let i=0;i<count;i++){
   const snapshot=(opts.sourceSnapshot?.attack??g.stat(source,'attack'))*(e.atk??0)*(1+.1*((opts.star??source.star??1)-1))*(opts.scale??1);
   const rec={...e,canonicalStatus:k,sourceId:source.id,sourceActor:source,snapshotDamage:snapshot,sourceLevel:source.level,remaining:2,turns:2,firstTickPhase:target.phaseCount+1,addedRound:g.round};
   const same=target.dots.filter(x=>key(x)===k);
   if(same.length>=3){const weak=[...same].sort((a,b)=>a.snapshotDamage-b.snapshotDamage)[0];if(snapshot>weak.snapshotDamage){target.dots.splice(target.dots.indexOf(weak),1,rec);}else continue;}else target.dots.push(rec);
   applied++;source.flags.dotApplications[g.round+':'+target.id]=(source.flags.dotApplications[g.round+':'+target.id]??0)+1;if(source.side==='enemy')g.teamDotApplications[targetKey]=(g.teamDotApplications[targetKey]??0)+1;
  }
  g.log('dot_apply',{source:source.id,target:target.id,status:k,count:applied});return applied>0;
 };
 g.cleanse=(target,n=1)=>{
  let count=0;const max=n==='all'||n===Infinity?Infinity:Number(n);
   const priority=e=>hard.has(key(e))?100:key(e)==='healing_down'?80:20;
   const keys=[...target.debuffs,...target.dots].filter(e=>e.cleanseable!==false).sort((a,b)=>priority(b)-priority(a));
   for(const e of keys){if(count>=max)break;const k=key(e);if(![...target.debuffs,...target.dots].some(x=>key(x)===k&&x.cleanseable!==false))continue;for(const prop of ['debuffs','dots'])target[prop]=target[prop].filter(x=>key(x)!==k||x.cleanseable===false);count++;}
  if(target.side!=='enemy')player.thisTurn.cleanse+=count;return count;
 };
 g.dispel=(target,n=1)=>{
  let count=0;const max=n==='all'||n===Infinity?Infinity:Number(n);
  target.buffs.sort((a,b)=>(key(b)==='taunt')-(key(a)==='taunt'));
   for(let i=0;i<target.buffs.length&&count<max;)if(target.buffs[i].dispellable!==false){const k=key(target.buffs[i]);if(k==='swift')target.buffs=target.buffs.filter(e=>key(e)!==k||e.dispellable===false);else target.buffs.splice(i,1);count++;}else i++;
  if(target.side==='enemy')player.thisTurn.dispel+=count;return count;
 };
 g.applyEffects=(effects,source,target,opts={})=>{
  const out={damage:0,hpDamage:0,shieldDamage:0,heal:0,shield:0,debuff:0,debuffs:0,dot:0,cleanse:0,dispel:0,hit:false,crits:0,crit:false};
  for(const e of effects){const kind=e.kind??e.type;g.audit.effects[kind]=(g.audit.effects[kind]??0)+1;
   if(e.condition)throw new Error('Unresolved effect condition: '+e.condition);
   const targets=opts.forceTarget?[target].filter(Boolean):g.targets(source,e,target),scale=(opts.scale??1)*Math.min(1,2/Math.max(1,targets.length));
   for(const t of targets){const o={...opts,scale};let r;
    if(['dot','debuff'].includes(kind)){
     const hit=opts.attackHit??g.action?.hitCache?.get(source.id+'>'+t.id);if(hit===false)continue;
    }
    if(kind==='damage'){r=g.damage(source,t,e,o);for(const k of ['damage','hpDamage','shieldDamage','crits'])out[k]+=r[k]??0;out.hit||=r.hit;out.crit||=r.crits>0;}
    else if(kind==='shield')out.shield+=g.shield(source,t,e,o);
    else if(kind==='heal')out.heal+=g.heal(source,t,e,o);
    else if(kind==='buff')g.addStatus(source,t,e,o);
    else if(kind==='debuff'){const ok=g.addStatus(source,t,e,o);out.debuff+=Number(ok);out.debuffs+=Number(ok);}
    else if(kind==='dot')out.dot+=Number(g.addDot(source,t,e,o));
    else if(kind==='cleanse')out.cleanse+=g.cleanse(t,e.amount??e.value??1);
    else if(kind==='dispel')out.dispel+=g.dispel(t,e.amount??e.value??1);
    else if(kind==='shield_damage'){const v=Math.min(t.shield,g.calcBase(source,t,e,o));t.shield-=v;out.shieldDamage+=v;out.damage+=v;}
    else throw new Error('Unknown primitive effect '+kind+' '+JSON.stringify(e));
   }
  }return out;
 };
 g.resolve=g.applyEffects;
 g.beginPhase=a=>{
  g.ensureActor(a);a.flags.phaseRound=g.round;a.phaseCount=(a.phaseCount??0)+1;a.buffs=a.buffs.filter(e=>e.expireMode!=='start'||e.expireAtPhase>a.phaseCount);
  if(a.phaseCount>1)a.shield*=a.side==='enemy'?.5:(g.options.patch?.playerShieldCarry??.5);
  for(const e of a.buffs.filter(e=>e.legacy&&['regen','heal_regen','shield_regen'].includes(e.legacyKey))){if(e.legacyKey==='shield_regen')g.shield(a,a,e.value??0);else g.heal(a,a,e.value??0);}
  const control=a.debuffs.find(e=>hard.has(key(e)));let canAct=true;
  if(control){
   if(a.definition?.tier==='boss'){a.flags.bossControlled=true;g.addStatus(player,a,{kind:'debuff',status:'weak',value:.2,turns:1,baseChance:100},{skipEffectRoll:true});a.flags.controlImmuneUntil=a.phaseCount+2;}
   else{canAct=false;a.flags.controlImmuneUntil=a.phaseCount+2;g.totals.controls++;}
   a.debuffs=a.debuffs.filter(e=>!hard.has(key(e)));
  }
  return canAct;
 };
 g.endPhase=a=>{
  g.endAction();for(const d of [...a.dots])if(a.hp>0&&a.phaseCount>=d.firstTickPhase){const K=100+5*d.sourceLevel;g.rawHit(d.sourceActor,a,d.snapshotDamage*K/(K+g.stat(a,'defense')),{dot:true});d.remaining--;}
  a.dots=a.dots.filter(d=>d.remaining>0);a.debuffs=a.debuffs.filter(e=>e.expireMode!=='end'||e.expireAtPhase>a.phaseCount);a.buffs=a.buffs.filter(e=>e.expireMode!=='end'||e.expireAtPhase>a.phaseCount);
  a.thisTurn.endShield=a.shield;a.thisTurn.endHp=a.hp;a.thisTurn.dotsAtEnd=a.dots.length;
 };
 g.endSide=side=>{for(const a of [...g.allies,...g.enemies])a.buffs=a.buffs.filter(e=>e.expireMode!=='opponent_end'||e.expireSide!==side||e.expireRound>g.round);};
 g.beginEnemyAction=a=>{g.phase='enemy';return a.hp>0&&g.beginPhase(a);};
 g.endEnemyAction=a=>g.endPhase(a);
 g.beforeEnemyAction=(a,skill)=>{g.beginAction(a,skill);const affected=skill.effects?.some(e=>['heal','shield','buff','cleanse','dot','debuff'].includes(e.kind??e.type))||/法术|魔法|咒|术|秘仪|魔弹|魔能|元素/.test(skill.name??'');const silence=a.debuffs.find(e=>String(e.status).includes('禁言：下次支援')&&e.charges>0);if(affected&&silence){g.action.outputScale=1-ratio(silence);g.action.chargeUsed.add(silence);}g.controller?.beforeEnemyAction?.(g,a,skill);g.totals.enemyActions++;};
 return g;
}
