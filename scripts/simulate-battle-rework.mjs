// Usage: node run-final-production-standalone.mjs <repository-directory> <output-directory>
// Read-only for the repository; writes only result JSONL/JSON in the output directory.
import fs,{readFileSync} from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';
const repoURL=pathToFileURL(path.resolve(process.argv[2]??process.cwd())+path.sep),resultURL=pathToFileURL(path.resolve(process.argv[3]??'battle-rework-sim-results')+path.sep);fs.mkdirSync(resultURL,{recursive:true});
const runtimeURL=new URL('src/battle/rework/runtime/',repoURL);const {catalog,seeded}=await import(new URL('physics.mjs',runtimeURL));const {buildPlayer}=await import(new URL('model.mjs',runtimeURL));const {makeOtherDeck}=await import(new URL('players-other.mjs',runtimeURL));const api=await import(new URL('api.mjs',runtimeURL));const {BALANCE_PATCH}=await import(new URL('balance.mjs',runtimeURL));

const starters=JSON.parse(readFileSync(new URL('src/content/generated/cards/starter-decks.json',repoURL),'utf8'));
starters.magician=['mg_quick_cut','mg_quick_cut','mg_card_switch','mg_false_shuffle','mg_forced_draw','mg_advance_notice','mg_sleeve_cache','mg_smoke_and_mirrors','mg_hat_mechanism','mg_inexhaustible_case','mg_inexhaustible_case','mg_card_knife','mg_chain_cards','mg_flying_cards','mg_truth_revealed'];
function starterDeck(id){const ids=[...starters[id]];if(catalog.cards.some(c=>c.id==='party_support_'+id))ids.push('party_support_'+id);return ids.map(id=>{const c=catalog.cards.find(c=>c.id===id);if(!c)throw Error('Starter card missing '+id);return c;});}

function balancedDeck(id){
 const cards=makeOtherDeck(catalog.cards,id),group=c=>c.effects.some(e=>['damage','dot','chant'].includes(e.kind))?'attack':c.effects.some(e=>['heal','shield'].includes(e.kind))?'defense':c.effects.some(e=>e.kind==='summon')?'summon':'utility';
 const picked=[];
 for(const [name,limit]of [['attack',7],['defense',4],['summon',2],['utility',3]]){
  const list=cards.filter(c=>group(c)===name).sort((a,b)=>a.ap-b.ap||a.id.localeCompare(b.id));
  const selected=list.length<=limit?list:Array.from({length:limit},(_,i)=>list[Math.floor(i*(list.length-1)/(limit-1))]);picked.push(...selected);
 }
 for(const c of cards)if(picked.length<16&&!picked.some(a=>a.id===c.id))picked.push(c);
 return picked;
}
function makeState(profession,level,monsterIds,style='balanced',deckMode='mature'){
 const p=buildPlayer(profession,level,style,1,null,profession.id==='apothecary'?.55:1),deck=deckMode==='starter'?starterDeck(profession.id):balancedDeck(profession.id);
 const player={name:profession.name,subclass:profession.id,hp:p.maxHp,hpMax:p.maxHp,attack:p.stats.attack,defense:p.stats.defense,speed:p.stats.speed,critRate:p.stats.crit,critDamage:p.stats.critDamage,effectHit:p.stats.ehr,effectResist:p.stats.res,ap:p.apMax,apMax:p.apMax,drawPerTurn:p.drawCount,shield:0,gold:1000,hand:[],drawPile:deck.map((c,i)=>({cardId:c.id,instanceId:'card:'+i,stars:p.star})),discardPile:[],buffs:{},debuffs:{}};
 const state={id:'research',player,enemies:monsterIds.map((id,i)=>({id:'enemy:'+i,definitionId:id,name:id,hp:1,hpMax:1,shield:0,buffs:{},debuffs:{},gold:[0,0],loot:[]})),selectedTarget:0,log:[],turn:1,phase:'player'};
 return {state,options:{level,explicit:true,seed:1,stars:Object.fromEntries(deck.map(c=>[c.id,p.star]))},allocation:p.allocation};
}
const body=g=>g.enemies.find(a=>a.definition?.tier==='boss'&&a.hp>0);
const contextId=(state,name)=>state.contextActions?.find(c=>c.name===name&&c.available)?.id;
function reserveAP(g,policy){if(policy!=='counter')return 0;const a=body(g);if(!a)return 0;const s=a.flags.boss,id=a.intent?.skillId;
 if(id==='exam'&&a.intent.exam?.exam==='restraint')return 2;
 if(id==='exam'&&a.intent.exam?.exam==='guard')return s.turn.standardGuard?0:1;
 if(id==='reckoning')return Math.min(2,Math.max(0,s.R-1));
 if(id==='high'&&!s.pearlBroken)return 1;
 if(id==='trample'&&s.M>=4)return 1;
 if(id==='copy'&&!s.turn.erased)return 2;
 if(id==='overload'&&s.Q>=68)return 2;
 if(id==='devour_hit'&&!s.turn.anchored)return 2;
 return 0;
}
function strategicActions(state,g,when){
 const a=body(g);if(!a)return 0;let count=0;const s=a.flags.boss;
 const use=name=>{const id=contextId(state,name);if(!id)return false;api.action(state,id);count++;g=api.hydrate(state.rework);return true;};
 if(s.family==='saint'&&s.mode==='collect'&&when==='before'){
  if(!s.evidence.guard)use('举盾作证');if(!s.evidence.art)use('辨明伪典');
 }
 if(when!=='after')return count;
 if(a.intent.skillId==='exam'&&a.intent.exam?.exam==='guard'&&!s.turn.standardGuard)use('标准防御');
 if(a.intent.skillId==='reckoning'){for(let i=0;i<2;i++){g=api.hydrate(state.rework);if(body(g)?.flags.boss.R<=1)break;if(!use('安魂'))break;}}
 if(a.intent.skillId==='high'&&!s.pearlBroken)use('靠岸');
 if(a.intent.skillId==='trample'&&s.M>=4)use('清醒');
 if(a.intent.skillId==='copy'&&!s.turn.erased)use('抹去镜痕');
 if(a.intent.skillId==='overload'){for(let i=0;i<2;i++){g=api.hydrate(state.rework);if(body(g)?.flags.boss.Q<80)break;if(!use('泄压阀'))break;}}
 if(a.intent.skillId==='devour_hit'&&(s.turn.hpDamageByTarget[a.id]||0)<a.maxHp*.08)use('锚定');
 return count;
}
function resolveChoices(state){let n=0;while(state.player.pendingCardChoice){if(++n>50)throw Error('choice_loop');const c=state.player.pendingCardChoice;const index=c.choices.findIndex((_,i)=>!c.picked.includes(i));if(index<0)api.choose(state,0,true);else api.choose(state,index);}return n;}
function simulateActualApi({profession,level,monsterIds,seed=1,style='balanced',policy='counter',maxRounds=40,trace=false,enemyAttackScale=1,enemyHpScale=1,deckMode='mature',runtimePatch=null,botAware=false,targetPolicy='score'}){
 const {state,options,allocation}=makeState(profession,level,monsterIds,style,deckMode);options.seed=seed;
 let g=api.create(state,options);for(const a of g.enemies){a.stats.attack*=enemyAttackScale;a.hp*=enemyHpScale;a.maxHp*=enemyHpScale;a.stats.hp*=enemyHpScale;}if(runtimePatch)g.options.patch={...g.options.patch,...runtimePatch};api.project(g,state);const audit={initial:{player:{...g.player.stats,hp:g.player.maxHp,ap:g.player.ap,draw:g.player.drawCount},allocation,deck:[...g.player.hand,...g.player.deck].map(c=>({id:c.id,star:c.star})),enemies:g.enemies.map(a=>({id:a.definition.id,...a.stats,hp:a.maxHp})),hand:g.player.hand.map(c=>c.id)},rounds:[]};const started=Date.now();let cards=0,contexts=0,choices=0,steps=0,outcome='timeout',minHpFraction=1,maxTurnHpLossFraction=0;
 for(let round=1;round<=maxRounds;round++){
  g=api.hydrate(state.rework);
  const roundAudit={round:g.round,start:{hp:g.player.hp,ap:g.player.ap,shield:g.player.shield,hand:g.player.hand.length,deck:g.player.deck.length,discard:g.player.discard.length},actions:[],intents:g.enemies.filter(a=>a.hp>0).map(a=>({name:a.intent?.skillName,id:a.intent?.skillId,target:a.intent?.targetId,budget:a.intent?.damageEstimate}))};
  if(trace)audit.rounds.push(roundAudit);
  if(policy==='counter')contexts+=strategicActions(state,g,'before');
  for(let action=0;action<80;action++){
   g=api.hydrate(state.rework);
   minHpFraction=Math.min(minHpFraction,g.player.hp/g.player.maxHp);if(!g.canAct||g.player.hp<=0||!g.livingEnemies().length)break;
   if(botAware){g.expectedIncoming=g.livingEnemies().reduce((v,a)=>v+g.stat(a,'attack')*1.5,0);api.project(g,state);}
   const reserve=reserveAP(g,policy),candidates=[];
   for(let i=0;i<g.player.hand.length;i++)for(let target=0;target<g.enemies.length;target++){
    const c=g.player.hand[i],t=g.enemies[target];if(t.hp<=0||c.legacy)continue;
    if(targetPolicy==='limbs'&&body(g)?.flags.boss.family==='leviathan'&&c.effects.some(e=>['damage','dot','chant'].includes(e.kind))){const helpers=g.livingEnemies().filter(a=>a.flags.bossHelper).sort((a,b)=>Number(b.definition.id==='leviathan_tail')-Number(a.definition.id==='leviathan_tail')||a.hp/a.maxHp-b.hp/b.maxHp);if(helpers.length&&t!==helpers[0])continue;}
    if(!g.controller.canPlay(g,c,t)||g.controller.price(g,c,false,t)>g.player.ap-reserve)continue;
    let score=g.controller.scoreCard(g,c,t);if(!Number.isFinite(score))throw Error('invalid_score '+c.id);
    if(policy==='counter'&&t.flags?.bossHelper?.ownerId&&['leviathan_tail','tide_pearl'].includes(t.definition.id))score*=1.15;
    candidates.push({i,target,score,id:c.id});
   }
   candidates.sort((a,b)=>b.score-a.score||a.i-b.i||a.target-b.target);const selected=candidates[0];if(!selected||selected.score<=.1)break;
   if(++steps>1800)throw Error('action_loop');const before={ap:g.player.ap,hp:g.player.hp,shield:g.player.shield,apSpent:g.player.thisTurn.apSpent,extraAP:g.player.flags.pc.extraAP,extraDraw:g.player.flags.pc.extraDraw,hand:g.player.hand.length,deck:g.player.deck.length,discard:g.player.discard.length};api.play(state,selected.i,selected.target);choices+=resolveChoices(state);cards++;if(trace){const after=api.hydrate(state.rework);roundAudit.actions.push({card:selected.id,before,after:{ap:after.player.ap,hp:after.player.hp,shield:after.player.shield,apSpent:after.player.thisTurn.apSpent,extraAP:after.player.flags.pc.extraAP,extraDraw:after.player.flags.pc.extraDraw,hand:after.player.hand.length,deck:after.player.deck.length,discard:after.player.discard.length},paidAP:after.player.thisTurn.apSpent-before.apSpent});}
  }
  g=api.hydrate(state.rework);if(policy==='counter')contexts+=strategicActions(state,g,'after');g=api.hydrate(state.rework);
  if(g.player.hp<=0){outcome='loss';break;}if(!g.livingEnemies().length){outcome='win';break;}
  const phaseBefore={hp:g.player.hp,shield:g.player.shield,damage:g.totals.playerDamage,enemyDamage:g.totals.enemyDamage};api.endPlayer(g);if(g.player.hp>0&&g.livingEnemies().length)api.enemiesTurn(g);api.project(g,state);minHpFraction=Math.min(minHpFraction,g.player.hp/g.player.maxHp);maxTurnHpLossFraction=Math.max(maxTurnHpLossFraction,(phaseBefore.hp-g.player.hp)/g.player.maxHp);if(trace){roundAudit.end={hp:g.player.hp,shield:g.player.shield,ap:g.player.ap,hand:g.player.hand.length,enemyPhaseDamage:g.totals.enemyDamage-phaseBefore.enemyDamage,hpLost:phaseBefore.hp-g.player.hp,cardDamage:g.player.thisTurn.damage,playerHealing:g.player.thisTurn.healing,playerShield:g.player.thisTurn.shieldGained};}
  if(g.player.hp<=0){outcome='loss';break;}if(!g.livingEnemies().length){outcome='win';break;}
  if(g.outcome){outcome=g.outcome;break;}api.nextTurn(g);api.project(g,state);
 }
 g=api.hydrate(state.rework);
 return {profession:profession.id,level,style,policy,monsterIds,seed,outcome,rounds:Math.min(g.round,maxRounds),cards,contexts,choices,hpFraction:g.player.hp/g.player.maxHp,remainingEnemyHp:g.enemies.reduce((n,a)=>n+a.hp,0),playerDamage:g.totals.playerDamage,enemyDamage:g.totals.enemyDamage,allocation,minHpFraction:Math.min(minHpFraction,g.player.hp/g.player.maxHp),maxTurnHpLossFraction,playerHealing:g.totals.playerHealing,playerShield:g.totals.playerShield,enemyHpDamage:g.totals.enemyHpDamage,elapsedMs:Date.now()-started,...(trace?{audit}:{}),enemyAttackScale,enemyHpScale,deckMode,runtimePatch,botAware,targetPolicy};
}
function sample(seed,count,boss=false){const rng=seeded(seed),rows=[];for(let i=0;i<count;i++){const profession=catalog.professions[i%catalog.professions.length],level=1+Math.floor(rng()*100);let monsterIds;if(boss)monsterIds=[catalog.bosses[Math.floor(i/catalog.professions.length)%8].id];else{const n=1+(Math.floor(i/catalog.professions.length)%3),chosen=[];for(let j=0;j<n;j++){const pool=catalog.monsters.filter(m=>!chosen.some(d=>d.id===m.id)&&(!chosen.some(d=>d.roleKey==='healer')||m.roleKey!=='healer')&&(!chosen.some(d=>d.roleKey==='guardian')||m.roleKey!=='guardian'));chosen.push(pool[Math.floor(rng()*pool.length)]);}monsterIds=chosen.map(m=>m.id);}rows.push({profession,level,monsterIds,seed:Math.floor(rng()*0xffffffff)});}return rows;}


const bite=catalog.bosses.find(b=>b.id==='boss_abyssal_leviathan_fragment').skills.find(s=>s.id==='bite');if(bite.effects[0].atk!==2.4)throw Error('Expected production Leviathan bite 2.4');if(BALANCE_PATCH.attackLevelRamp.boss!==2||BALANCE_PATCH.hpLevelRamp?.boss)throw Error('Unexpected production balance config');
const probe=makeState(catalog.professions[0],100,['boss_abyssal_leviathan_fragment']),core=api.create(probe.state,probe.options);if(core.enemies[0].stats.attack!==1386||core.enemies[0].maxHp!==103144)throw Error('Pressure duplicate/missing '+core.enemies[0].stats.attack+'/'+core.enemies[0].maxHp);
const runtimeDir=new URL('src/battle/rework/runtime/',repoURL),manifest=Object.fromEntries(fs.readdirSync(runtimeDir).filter(n=>n.endsWith('.mjs')).map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(new URL(n,runtimeDir))).digest('hex')]));manifest.catalog=crypto.createHash('sha256').update(fs.readFileSync(new URL('src/battle/rework/catalog.json',repoURL))).digest('hex');
const rng=seeded(917024),cases=[],attacking=new Set(['striker','fighter','bruiser','dot','controller']);
for(let j=0;j<8;j++)for(let ci=0;ci<25;ci++){
 const tier=j<3?'normal':j<6?'elite':'boss',deckMode=j%2===0?'starter':'mature',level=1+Math.floor(rng()*100);let monsterIds;
 if(tier==='boss')monsterIds=[catalog.bosses[(ci+j)%8].id];else{const n=j%3+1,chosen=[];for(let k=0;k<n;k++){const pool=catalog.monsters.filter(d=>d.tier===tier&&!chosen.some(m=>m.id===d.id)&&(!chosen.some(m=>m.roleKey==='healer')||d.roleKey!=='healer')&&(!chosen.some(m=>m.roleKey==='guardian')||d.roleKey!=='guardian')&&(k!==0||n===1||attacking.has(d.roleKey)));chosen.push(pool[Math.floor(rng()*pool.length)]);}monsterIds=chosen.map(m=>m.id);}
 cases.push({group:'random',tier,profession:catalog.professions[ci],level,deckMode,monsterIds,seed:Math.floor(rng()*0xffffffff),style:'balanced',policy:'counter',runtimePatch:{smartFlying:true,smartPriest:true},botAware:true,targetPolicy:'limbs'});
}
for(const id of ['holy_knight','magician','apothecary','priest'])for(const level of [1,20,60,100])for(const deckMode of ['starter','mature'])for(const boss of ['boss_abyssal_leviathan_fragment','boss_hearthforge_overcore'])cases.push({group:'boss_matrix',tier:'boss',profession:catalog.professions.find(p=>p.id===id),level,deckMode,monsterIds:[boss],seed:910523,style:'balanced',policy:'counter',runtimePatch:{smartFlying:true,smartPriest:true},botAware:true,targetPolicy:'limbs'});
const rows=[],start=Date.now(),file=new URL('final-production-cases.jsonl',resultURL);fs.writeFileSync(file,'');
for(let i=0;i<cases.length;i++){const c=cases[i];let r;try{r={...simulateActualApi(c),group:c.group,tier:c.tier};}catch(e){r={...c,profession:c.profession.id,outcome:'error',error:e.message,stack:e.stack};}rows.push(r);fs.appendFileSync(file,JSON.stringify(r)+'\n');if((i+1)%40===0)console.log(JSON.stringify({done:i+1,total:cases.length,errors:rows.filter(r=>r.outcome==='error').length,seconds:(Date.now()-start)/1000}));}
const stats=a=>{const ok=a.filter(r=>r.outcome!=='error'),avg=k=>ok.reduce((n,r)=>n+(r[k]||0),0)/ok.length;return {n:a.length,wins:a.filter(r=>r.outcome==='win').length,losses:a.filter(r=>r.outcome==='loss').length,timeouts:a.filter(r=>r.outcome==='timeout').length,other:a.filter(r=>!['win','loss','timeout','error'].includes(r.outcome)).length,errors:a.filter(r=>r.outcome==='error').length,rounds:avg('rounds'),hp:avg('hpFraction'),lowHp:avg('minHpFraction'),maxRoundLoss:avg('maxTurnHpLossFraction'),contexts:avg('contexts')};};
const group=(test,key)=>Object.fromEntries([...new Set(rows.filter(test).map(key))].map(k=>[k,stats(rows.filter(r=>test(r)&&key(r)===k))]));const summary={date:new Date().toISOString(),manifest,seconds:(Date.now()-start)/1000,config:BALANCE_PATCH,probe:{level:100,leviAttack:core.enemies[0].stats.attack,leviHp:core.enemies[0].maxHp,biteAtk:bite.effects[0].atk},design:{random:200,classes:25,eachClass:8,levels:'uniform integer1..100',starter:100,mature:100,normal:75,elite:75,boss:50,ordinary:'1..3 without repeats, max1 healer and guardian; attack role leads groups',fixedBoss:64,policy:'actual public API, bounded score bot with public counters and keep defense/draw in magician discard; choice pool is public; max40 rounds',gear:'model default gear1, stars1<20/2>=20/3>=60, exact10*(L-1) allocation',scales:'production default; external enemyAttackScale1 and enemyHpScale1',merchant:'starter only3 nonattack cards; timeout does not mean mature merchant cannot fight'},all:stats(rows),random:stats(rows.filter(r=>r.group==='random')),byGroupDeckTier:group(()=>true,r=>r.group+':'+r.deckMode+':'+r.tier),randomClass:group(r=>r.group==='random',r=>r.profession),randomLevel:group(r=>r.group==='random',r=>(r.level<=10?'1-10':r.level<=20?'11-20':r.level<=40?'21-40':r.level<=60?'41-60':'61-100')+':'+r.deckMode),matrixLevel:group(r=>r.group==='boss_matrix',r=>r.level+':'+r.deckMode),matrixBoss:group(r=>r.group==='boss_matrix',r=>r.monsterIds[0]+':'+r.deckMode),failed:rows.filter(r=>r.outcome!=='win')};fs.writeFileSync(new URL('final-production-summary.json',resultURL),JSON.stringify(summary,null,2));console.log(JSON.stringify({done:true,random:summary.random,groups:summary.byGroupDeckTier,matrix:summary.matrixLevel,errors:summary.failed.filter(r=>r.outcome==='error').map(r=>({class:r.profession,error:r.error}))}));
