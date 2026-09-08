/* global structuredClone */
import {catalog,actor,makeGame,makeTurnMetrics} from './physics.mjs';
import {encounter} from './model.mjs';
import {BALANCE_PATCH} from './balance.mjs';
import {createMageController,MAGE_IDS} from './players-mages.mjs';
import {createOtherController,OTHER_PROFESSIONS} from './players-other.mjs';
import {createPlayerController} from './common-player.mjs';
import {planEnemy,actEnemy,notifyEnemyDamaged} from './enemies.mjs';
import {initBosses,planBoss,actBoss,contextAction,contextActions,recordBossPlayerCard} from './bosses.mjs';
import {encode,decode} from './snapshot.mjs';
import {syncLegacyActors,importInitialLegacyState,projectLegacyTimed} from './legacy-bridge.mjs';
import {describeBossIntent,describeBossState,describeBossEvent} from './boss-display.mjs';
export {encode,decode};

const cards=new Map(catalog.cards.map(c=>[c.id,c]));
const monsters=new Map([...catalog.monsters,...catalog.bosses].map(c=>[c.id,c]));
const RNG=['rng','hitRng','effectRng','critRng'];
const patch=BALANCE_PATCH;

function controller(id){return MAGE_IDS.includes(id)?createMageController(id):OTHER_PROFESSIONS.includes(id)?createOtherController(id):createPlayerController();}
function wire(g){
  g.catalog=catalog;g.cardCatalog=cards;g.controller=controller(g.player.profession);
  if(g.player.flags.pc)g.player.flags.pc.catalog=cards;
  g.afterIncomingDamage=e=>g.controller.afterIncomingDamage?.(g,e);
  g.notifyEnemyDamaged=notifyEnemyDamaged;
  return g;
}
export function hydrate(data){
  const saved=decode(data),g=makeGame(saved.player,saved.enemies,{seed:saved.seed,trace:true,patch});
  for(const [k,v] of Object.entries(saved))if(!RNG.includes(k)&&k!=='rngStates')g[k]=v;
  for(const key of RNG)g[key].setState(saved.rngStates[key]);
  g.trace=[];g.events=[];wire(g);initBosses(g);return g;
}
export function snapshot(g){g.endAction();g.action=null;return encode({...g,rngStates:Object.fromEntries(RNG.map(k=>[k,g[k].getState()]))});}
function copyStats(p){return {hp:p.hpMax,attack:p.attack,defense:p.defense,speed:p.speed,crit:p.critRate??5,critDamage:p.critDamage??50,ehr:p.effectHit??0,res:p.effectResist??0};}
function customDefinition(e){return {id:e.definitionId,name:e.name,tier:'normal',roleKey:'striker',tags:e.tags??[],statMultipliers:{hp:1,attack:1,defense:1,speed:1},statsAt20:{crit:15,critDamage:50,ehr:0,res:0},skills:[{id:e.definitionId+'__basic',name:'普通攻击',priority:10,condition:'总是',cooldown:0,cooldownGroup:'basic',target:'enemy',targetSelection:catalog.monsters[0].skills[0].targetSelection,effects:[{type:'damage',flat:20,atk:1.6,hits:1,crit:true,target:'enemy'}]}]};}
export function regionLevel(level,region){
  const base=({'圣德里安学院':5,'伊拉亚城':5,'索拉维亚':20,'索拉姆城':20,'艾瑟拉森林':20,'奈亚索斯':40,'奈亚索斯城':40,'炉心城':40,'银月之城':60,'阿必塞海':60})[region]??5;
  const chase=base===60?1:base===40?.9:base===20?.8:.7;
  return Math.max(1,Math.min(100,base===5?Math.min(level,Math.round(base+chase*Math.max(0,level-base))):Math.round(base+chase*Math.max(0,level-base))));
}
export function create(state,options={}){
  const p=actor('player','player',options.level??1,copyStats(state.player));
  Object.assign(p,{hp:Math.min(p.maxHp,state.player.hp),shield:state.player.shield,apMax:state.player.apMax,ap:state.player.apMax,drawCount:Math.min(5,state.player.drawPerTurn),profession:state.player.subclass,gold:state.player.gold??0,star:1});
  const definitions=state.enemies.map(e=>monsters.get(e.definitionId)??customDefinition(e));
  const level=options.explicit?Math.max(1,Math.min(100,options.level??1)):regionLevel(options.level??1,options.region??'');
  const difficulty=({easy:.8,normal:1,hard:1.5,hell:2})[state.difficulty]??1;
  const enemies=encounter(definitions,level,{...patch,hpScale:difficulty,attackScale:difficulty});
  enemies.forEach((a,i)=>Object.assign(a,{id:state.enemies[i].id,name:definitions[i].name,tier:definitions[i].tier,tags:definitions[i].tags??[]}));
  const g=wire(makeGame(p,enemies,{seed:options.seed??1,trace:true,patch}));
  g.round=1;g.allowEscape=!options.locked;g.encounterGoldReward=state.enemies.reduce((n,e)=>n+((e.gold?.[0]??0)+(e.gold?.[1]??0))/2,0)*5;
  const all=[...state.player.hand,...state.player.drawPile,...state.player.discardPile];
  const deck=all.map(c=>({...structuredClone(cards.get(c.cardId)??{id:c.cardId,name:c.cardId,ap:1,effects:[],legacy:true}),uid:c.instanceId,star:c.stars??options.stars?.[c.cardId]??1}));
  g.controller.init(g,catalog.professions.find(c=>c.id===p.profession)??{id:p.profession},deck);
  if(state.companion){const c=actor('caelian','player',p.level,copyStats(state.companion));Object.assign(c,{hp:state.companion.hp,name:state.companion.name,isCompanion:true});g.allies.push(c);}
  initBosses(g);start(g);importInitialLegacyState(g,state);
  const extra=Math.max(0,Math.min(3,(state.player.ap??p.apMax)-p.apMax));p.ap+=extra;p.flags.pc.extraAP+=extra;
  g.controller.draw(g,Math.max(0,(state.player.initialDraw??5)-5),true);
  state.reworkGoldBase=state.player.gold??0;return g;
}
export function start(g){
  g.phase='player';g.log('turn',{phase:'player',turn:g.round});g.workshopStartingPlayer=true;try{g.canAct=g.beginPhase(g.player);g.controller.startTurn(g);}finally{delete g.workshopStartingPlayer;}if(g.canAct)g.workshopProgramEvent?.('turn_start',{sourceId:g.player.id,targetId:g.player.id});
  for(const a of g.livingEnemies()) {
    if(a.definition?.tier==='boss'||a.flags?.bossHelper) planBoss(g,a);
    else planEnemy(g,a);
  }
}
const walk=es=>es.flatMap(e=>[e,...walk(e.effects??[])]);
function counts(g,c,ctx){
  const es=walk(c.effects),m=g.player.thisTurn,kind=k=>es.some(e=>e.kind===k);
  m.cardsPlayed++;m.apSpent+=ctx.paidAP;m.damageCards+=Number(kind('damage')||kind('dot')||kind('chant'));m.defenseCards+=Number(c.type==='defense'||kind('shield'));m.healCards+=Number(kind('heal'));m.buffCards+=Number(kind('buff'));m.drawCards+=Number(kind('draw')||ctx.totals.draw>0);m.spellCards+=Number(c.type==='spell');m.aoeCards+=Number(es.some(e=>e.target==='all_enemies'));m.drawn+=ctx.totals.draw??0;g.totals.cards++;recordBossPlayerCard(g,c,ctx);
}
export function legacyCardCheckpoint(state){
 if(!state.rework)return null;
 const g=hydrate(state.rework),debuffs=Object.fromEntries(state.enemies.map(e=>[e.id,JSON.parse(JSON.stringify(e.debuffs??{}))]));
 return {metrics:{...g.player.thisTurn},hp:state.player.hp,shield:state.player.shield,debuffs};
}
export function recordLegacyCard(state,card,paidAP,before){
 if(!state.rework||!before)return;
 const g=hydrate(state.rework);syncExternal(g,state);const m=g.player.thisTurn;
 const converted=es=>(es??[]).flatMap(e=>[{...e,kind:({apply_buff:'buff',apply_debuff:['poison','burn','bleed','corrosion','curse'].includes(e.debuff)?'dot':'debuff'})[e.type]??e.type},...converted(e.effects),...converted(e.then_effects),...converted(e.else_effects)]);
 const effects=converted(card.effects),delta=k=>Math.max(0,(m[k]??0)-(before.metrics[k]??0));
 const changed=state.enemies.flatMap(e=>Object.entries(e.debuffs??{}).filter(([k,v])=>JSON.stringify(v)!==JSON.stringify(before.debuffs?.[e.id]?.[k])).map(([k])=>k));
 const totals={damage:delta('damage'),hpDamage:delta('hpDamage'),heal:Math.max(delta('healing'),state.player.hp-before.hp),shield:Math.max(delta('shieldGained'),state.player.shield-before.shield),draw:delta('drawn'),debuffs:effects.some(e=>e.kind==='debuff')?changed.length:0,dot:effects.some(e=>e.kind==='dot')?changed.filter(k=>['poison','burn','bleed','corrosion','curse'].includes(k)).length:0,dispel:delta('dispel')};
 if(card.type==='defense'||totals.shield>0)m.defenseAP=(m.defenseAP??0)+paidAP;
 m.healing+=Math.max(0,totals.heal-delta('healing'));m.shieldGained+=Math.max(0,totals.shield-delta('shieldGained'));
 const drawn=m.drawn;counts(g,{...card,effects},{paidAP,totals});m.drawn=drawn;project(g,state);
}
function enableChoices(g,answers=[]){
  let index=0;
  g.choose=(title,pool,max,min=max)=>{
    if(pool.length<=min)return pool.slice(0,max);
    const answer=answers[index++];
    if(!answer){const error=new Error('CHOOSE');error.choice={title,pool:pool.map((c,i)=>({id:c.id??c.uid??String(i),label:c.name??c.summary??c.status??c.action??c.kind,index:i})),max,min};throw error;}
    if(answer.length<min||answer.length>max||new Set(answer).size!==answer.length||answer.some(i=>!Number.isInteger(i)||!pool[i]))throw Error('选择无效');
    return answer.map(i=>pool[i]);
  };
}
export function play(state,index,targetIndex=state.selectedTarget,answers=[],allyTargetId='player',configureGame){
  const original=state.rework,g=hydrate(original);syncExternal(g,state);
  const c=g.player.hand[index],target=g.enemies[targetIndex]??g.livingEnemies()[0];
  if(!c||!g.canAct)throw Error('当前无法行动');if(c.legacy)return false;
  if(walk(c.effects).some(e=>e.target==='ally')&&!g.allies.some(a=>a.id===allyTargetId&&a.hp>0))throw Error('该友方已重伤或不在场，无法作为目标');
  g.selectedAllyId=allyTargetId;g.cardCostOverride=state.reworkCardCostOverride;enableChoices(g,answers);const detach=configureGame?.(g,state);
  try{const ctx=g.controller.playCard(g,c,target);counts(g,c,ctx);g.endAction();delete g.cardCostOverride;delete state.reworkCardCostOverride;delete state.reworkChoice;delete state.player.pendingCardChoice;state.selectedTarget=targetIndex;project(g,state);}
  catch(e){if(!e.choice)throw e;state.rework=original;state.reworkChoice={index,targetIndex,allyTargetId,answers,choice:e.choice};state.player.pendingCardChoice={type:'rework',title:e.choice.title,choices:e.choice.pool.map(c=>c.id),labels:e.choice.pool.map(c=>c.label),pick:e.choice.max,min:e.choice.min,picked:[]};}
  finally{detach?.();}
  return true;
}
export function choose(state,index,finish=false){
  const pending=state.reworkChoice,display=state.player.pendingCardChoice;if(!pending||!display)throw Error('没有待处理的选择');
  const selected=display.picked;
  if(!finish){if(!Number.isInteger(index)||index<0||index>=display.choices.length||selected.includes(index))throw Error('选择无效');selected.push(index);}
  if(selected.length<display.pick&&!finish)return;if(selected.length<(display.min??display.pick))throw Error('选择数量不足');
  const answers=[...pending.answers,[...selected]];delete state.player.pendingCardChoice;delete state.reworkChoice;
  play(state,pending.index,pending.targetIndex,answers,pending.allyTargetId);
}
export function endPlayer(g){if(g.player.hp>0)g.controller.endTurn(g);g.endPhase(g.player);g.endSide('player');}
export function enemiesTurn(g){
  for(const a of [...g.livingEnemies()].sort((a,b)=>(a.slot??0)-(b.slot??0)||a.id.localeCompare(b.id))){
    if(g.player.hp<=0)break;
    if(a.definition?.tier==='boss'||a.flags?.bossHelper)actBoss(g,a);else actEnemy(g,a);
  }
  if(g.player.hp>0&&g.player.flags.pc.escapePending){g.outcome='escaped';g.player.flags.pc.escapePending=false;}
  g.endSide('enemy');
}
export function nextTurn(g){
  if(g.player.hp<=0||!g.livingEnemies().length)return;
  // Finish an already announced action before replacing a saved legacy kit.
  for(const a of g.enemies){const current=monsters.get(a.definition?.id);if(current?.resetVersion===2&&a.definition?.resetVersion!==2){a.definition=structuredClone(current);a.cooldowns={};}if(a.flags?.bossHelper){const owner=g.enemies.find(x=>x.id===a.flags.bossHelper.ownerId),replacement=owner?.definition?.helpers?.find(x=>x.id===a.definition.id);if(replacement?.resetVersion===2&&a.definition.resetVersion!==2)a.definition={...structuredClone(replacement),tier:'boss_helper'};}}
  g.round++;for(const a of [...g.allies,...g.enemies]){g.ensureActor(a);a.lastTurn=a.thisTurn;a.thisTurn=makeTurnMetrics();a.receivedLastTurn=a.receivedThisTurn;a.receivedThisTurn=makeTurnMetrics();}start(g);
}
export function discard(state){
  const g=hydrate(state.rework);syncExternal(g,state);const p=g.player;
  if(!g.canAct||p.ap<1)throw Error('行动点不足');if(p.flags.manualDiscardRound===g.round)throw Error('每回合只能换手牌一次');
  const discarded=p.hand.filter(c=>c.id!=='mg_blank_card');if(!discarded.length)throw Error('没有可弃置手牌');
  p.hand=p.hand.filter(c=>c.id==='mg_blank_card');p.discard.push(...discarded);p.ap--;p.flags.manualDiscardRound=g.round;g.controller.draw(g,3,true);project(g,state);
}

const timed=projectLegacyTimed;
function projectActor(a,dst){Object.assign(dst,{hp:Math.max(0,Math.ceil(a.hp)),hpMax:Math.ceil(a.maxHp),shield:Math.max(0,Math.ceil(a.shield)),attack:a.stats.attack,defense:a.stats.defense,speed:a.stats.speed,critRate:a.stats.crit,critDamage:a.stats.critDamage,effectHit:a.stats.ehr,effectResist:a.stats.res,buffs:timed(a,a.buffs),debuffs:timed(a,[...a.debuffs,...a.dots])});}
function cardInstance(c){return {instanceId:String(c.uid),cardId:c.id,stars:c.star??1,...(c.ruleCost!==undefined?{ruleCost:c.ruleCost}:{})};}
function animation(g,state,e,label){
  const source=e.source??e.actor,target=e.target,actors=[...g.allies,...g.enemies];
  const side=id=>id==='player'?'player':id==='caelian'?'companion':actors.find(a=>a.id===id)?.side==='enemy'?'enemy':'summon';
  const kind=e.type==='action_start'?(side(source)==='enemy'?'enemy-action':side(source)==='player'?'card':'companion-action'):['damage','heal','shield','draw','turn'].includes(e.type)?e.type:['buff','debuff','dot_apply','miss'].includes(e.type)?'status':null;
  if(!kind)return;state.animations??=[];
  state.reworkAnimationSequence=(state.reworkAnimationSequence??0)+1;
  state.animations.push({id:'rework-animation:'+state.reworkAnimationSequence,turn:g.round,kind,sourceId:source,sourceSide:source?side(source):'system',targetId:target,targetSide:target?side(target):undefined,amount:Math.round(e.damage??e.amount??e.count??0),hpAfter:e.hp===undefined?undefined:Math.ceil(e.hp),shieldAfter:e.shield===undefined?undefined:Math.ceil(e.shield),phaseAfter:e.type==='turn'?'player':undefined,turnAfter:e.type==='turn'?g.round:undefined,cardInstanceId:e.uid===undefined?undefined:String(e.uid),label:label||e.name||(e.type==='turn'?'第'+g.round+'回合':kind==='draw'?'抽取'+e.count+'张牌':'状态变化')});
  state.animations=state.animations.slice(-160);
}
export function project(g,state,options={}){
  const p=g.player;projectActor(p,state.player);
  Object.assign(state.player,{ap:p.ap,apMax:p.apMax,drawPerTurn:p.drawCount,manualDiscardTurn:p.flags.manualDiscardRound,handLimit:p.handLimit,hand:p.hand.map(cardInstance),drawPile:p.deck.map(cardInstance),discardPile:p.discard.map(cardInstance),classResources:{...p.resources},gold:p.gold,chants:(p.chants??[]).map(c=>({id:c.id,name:c.name??'吟诵',turns:c.remaining,effects:c.effects})),summons:g.allies.filter(a=>(a.isSummon||a.legacySummon)&&a.hp>0).map(a=>{const summon=(state.player.summons??[]).find(x=>x.id===a.id)??{id:a.id};Object.assign(summon,{name:a.name??a.summonName,duration:Math.max(0,a.expiresRound-g.round),hp:a.hp,skills:a.legacySkills??a.skills,attackable:a.attackable!==false,mechanical:a.mechanical});projectActor(a,summon);return summon;})});
  for(const a of g.enemies){let e=state.enemies.find(e=>e.id===a.id);if(!e){e={id:a.id,definitionId:a.definition?.id??a.id,name:a.name??a.definition?.name??'召唤物',level:a.level,difficulty:'normal',tags:[],xp:0,gold:[0,0],loot:[],intent:null};state.enemies.push(e);}projectActor(a,e);e.level=a.level;
    const i=a.intent;if(i){const s=i.skill??{},raw=i.damageEstimate??[0,0],isBoss=a.flags?.boss||a.flags?.bossHelper,condition=typeof i.conditional==='string'?i.conditional:Object.entries(i.conditional??{}).map(([k,v])=>k+' '+v).join('，'),desc=isBoss?describeBossIntent(g,a):[s.summary,condition,s.telegraph,s.fallback,i.description].filter(Boolean).join('；');e.mechanicDescription=isBoss?describeBossState(g,a):undefined;e.intent={skillId:i.skillId??s.id,name:i.skillName??s.name??'机制行动',kind:(s.effects??[]).some(e=>(e.type??e.kind)==='damage')?'attack':'buff',description:desc,amount:Math.round(raw[0]),hits:Math.max(1,...(s.effects??[]).map(e=>e.hits??1)),targetIds:i.effectTargets?.flatMap(r=>r.targetIds)??[i.targetId],cooldown:s.cooldown??0,guardThreshold:i.guardThreshold};}else e.intent=null;
  }
  const companion=g.allies.find(a=>a.isCompanion);if(companion&&state.companion){projectActor(companion,state.companion);if(companion.hp<=0){state.companion.injured=true;state.companion.shield=0;}state.companion.summons=g.allies.filter(a=>a.isCompanionSummon&&a.hp>0).map(a=>{const dto=(state.companion.summons??[]).find(x=>x.id===a.id)??{id:a.id,name:a.name};projectActor(a,dto);return dto;});}
  state.turn=g.round;state.phase=state.status!=='ongoing'?'ended':g.phase==='enemy'?'enemy':'player';state.reworkOutcome=g.outcome;state.contextActions=contextActions(g).map(c=>({id:c.id,name:c.name,ap:c.ap,description:c.effect,available:c.enabled,reason:c.reason,remaining:c.remaining}));
  state.reworkCards=Object.fromEntries(p.hand.map(c=>{const target=g.enemies[state.selectedTarget]??g.livingEnemies()[0];return [String(c.uid),{cost:c.ruleCost??(c.legacy?null:g.controller.price(g,c,false,target)),available:c.legacy?true:g.canAct&&g.controller.canPlay(g,c,target),stars:c.star??1,goldCost:c.id==='me_bribe'?Math.ceil(g.encounterGoldReward*1.5):undefined}];}));
  for(const e of g.trace??[]){let text='';const name=id=>id==='player'?state.player.name:state.enemies.find(a=>a.id===id)?.name??g.allies.find(a=>a.id===id)?.name??id;
    if(e.type==='damage')text=(e.dot?'持续伤害：':'')+name(e.source)+' → '+name(e.target)+' '+Math.round(e.damage)+'伤害'+(e.crits?'（'+e.crits+'段暴击）':'');
    if(e.type==='heal'||e.type==='shield')text=name(e.source)+'为'+name(e.target)+(e.type==='heal'?'恢复':'提供护盾')+Math.round(e.amount);
    if(e.type==='play_card')text='使用「'+(cards.get(e.card)?.name??e.card)+'」，消耗'+e.ap+'AP';
    if(e.type==='enemy_action')text=name(e.actor)+'使用「'+(g.enemies.find(a=>a.id===e.actor)?.definition?.skills?.find(s=>s.id===e.executed)?.name??e.executed)+'」'+(e.fallback?'（按预告回退）':'');
    if(e.type==='miss')text=name(e.target)+'闪避了'+name(e.source)+'的攻击';
    if(e.type.startsWith('boss_'))text=describeBossEvent(g,e)||e.text||e.message||'';
    animation(g,state,e,text);
    if(text)state.log.push({id:'rework:'+g.round+':'+state.log.length,turn:g.round,kind:e.source==='player'||e.type==='play_card'?'player':'enemy',text});
  }
  if(state.workshopTest)state.workshopRuleTrace=structuredClone(p.flags.workshopPrograms?.trace??[]);
  state.log=state.log.slice(-200);g.trace=[];if(options.checkpoint!==false)state.rework=snapshot(g);
}
export function syncExternal(g,state){
  syncLegacyActors(g,state);
  const p=g.player;p.ap=state.player.ap;p.gold=state.player.gold??p.gold;
  const all=[...p.hand,...p.deck,...p.discard,...p.exhaust];
  const restore=list=>list.map(c=>all.find(x=>String(x.uid)===c.instanceId)??{...structuredClone(cards.get(c.cardId)??{id:c.cardId,ap:1,effects:[],legacy:true}),uid:c.instanceId,star:c.stars??1});
  p.hand=restore(state.player.hand);p.deck=restore(state.player.drawPile);p.discard=restore(state.player.discardPile);
}
export function sync(state){if(!state.rework)return;const g=hydrate(state.rework);syncExternal(g,state);project(g,state);}
export function action(state,id,targetId){const g=hydrate(state.rework);syncExternal(g,state);contextAction(g,id,targetId);project(g,state);}
export function legacyDamage(state,sourceId,targetId,amount,label,ignoreDefense=false){
  const g=hydrate(state.rework);syncExternal(g,state);const all=[...g.allies,...g.enemies],source=all.find(a=>a.id===sourceId)??g.player,target=all.find(a=>a.id===targetId);if(!target)return 0;
  g.beginAction(source,{id:'external:'+label,name:label});const out=g.damage(source,target,{flat:Math.max(0,amount),atk:0,crit:true},{flatScale:1,ignoreDefense:ignoreDefense?1:0});project(g,state);return out.hpDamage;
}

/** Hit/non-critical preview from a disposable graph; never reads future combat rolls. */
export function preview(state,cardId,targetIndex,allyTargetId='player'){
 const g=hydrate(state.rework);syncExternal(g,state);g.selectedAllyId=allyTargetId;
 const result={enemyDamage:state.enemies.map(()=>0),playerHp:0,playerHpCost:0,companionHp:0,playerMp:0,playerMpCost:0};
 const card=g.player.hand.find(c=>c.id===cardId);if(!card||card.legacy)return result;
 const before=g.allies.map(a=>({id:a.id,hp:a.hp}));g.hitRng=()=>1;g.critRng=()=>1;g.effectRng=()=>0.5;g.rng=()=>0.5;
 try{const ctx=g.controller.playCard(g,card,g.enemies[targetIndex]);result.playerHpCost=ctx.totals.selfDamage;
  for(const event of g.events){const i=state.enemies.findIndex(a=>a.id===event.target.id);if(i>=0)result.enemyDamage[i]+=event.hpDamage;}
  result.playerHp=Math.max(0,g.player.hp-before[0].hp+result.playerHpCost);
  const c=g.allies.find(a=>a.isCompanion),old=before.find(a=>a.id===c?.id);result.companionHp=c&&old?Math.max(0,c.hp-old.hp):0;
 }catch{/* A card awaiting a player choice has no single numeric preview. */}
 return result;
}

export function planActor(g,a){return a.definition?.tier==='boss'||a.flags?.bossHelper?planBoss(g,a):planEnemy(g,a);}
