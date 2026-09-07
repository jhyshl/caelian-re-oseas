/* global structuredClone */
// Deterministic Boss state machines for the reviewed 2026-09-07 catalog.
// Integration: initBosses once after creating/hydrating physics; planBoss for every
// Boss/helper at player-phase start; recordBossPlayerCard after successful card
// resolution; actBoss for every Boss/helper in stable slot order at enemy phase.
// State is data-only. Functions/hooks are installed again after hydration.
const installedGames = new WeakSet();
const IDS = {
 golem:'boss_academy_arcane_golem',grave:'boss_ilaya_grave_warden',saint:'boss_solavia_hollow_saint',
 tide:'boss_naiathos_tide_queen',stag:'boss_aethera_dream_stag',mirror:'boss_silvermoon_mirror_duchess',
 forge:'boss_hearthforge_overcore',leviathan:'boss_abyssal_leviathan_fragment'
};
const primitive = new Set(['damage','heal','shield','buff','debuff','dot','cleanse']);
const alive = a => !!a && a.hp > 0;
const clamp = (n,lo,hi) => Math.max(lo,Math.min(hi,n));
const statusKey = e => e.canonicalStatus || e.status;
const kind = e => e.kind || e.type;
const stable = (a,b) => (a.slot ?? 0)-(b.slot ?? 0)||a.id.localeCompare(b.id);
const stat = (g,a,k) => g.stat ? g.stat(a,k) : a.stats[k] || 0;
const pct = a => a.hp/a.maxHp;
const last = (g,k) => g.player.lastTurn?.[k] ?? 0;
const has = (g,a,k) => g.hasStatus(a,k);
const all = g => [...new Map([g.player,...(g.allies || []),...(g.playerAllies || []),...g.enemies].map(a=>[a.id,a])).values()];
const foes = (g,a) => all(g).filter(t=>alive(t)&&t.side!==a.side).sort(stable);
const bossOf = (g,a) => a.flags?.bossHelper ? g.enemies.find(t=>t.id===a.flags.bossHelper.ownerId) : a;
const data = a => a.flags.boss;
const def = (g,a) => a.definition || g.catalog.bosses.find(b=>b.id===a.id);
const familyOf = a => Object.keys(IDS).find(k=>IDS[k]===a.definition?.id);
const helpers = (g,a,includeDead=false) => g.enemies.filter(h=>h.flags?.bossHelper?.ownerId===a.id&&(includeDead||alive(h)));
const helper = (g,a,id) => helpers(g,a).find(h=>h.definition.id===id);
const uses = (a,id) => a.flags.bossSkillUses?.[id] || 0;
const log = (g,type,x={}) => g.log?.(type,x);
const scalar = a => (20+2*a.level)/60;
const raw = (g,a,e) => (e.flat||0)*scalar(a)+(e.atk||0)*stat(g,a,'attack')+(e.def||0)*stat(g,a,'defense');
const baseline = (g,a) => def(g,a).skills.find(s=>s.priority===10&&s.effects.some(e=>kind(e)==='damage'));
const skillBy = (g,a,id) => def(g,a).skills.find(s=>s.id===id);
const sumResult = (a,b={}) => {for(const k of ['damage','hpDamage','shieldDamage','heal','shield','crits','debuff','dot','cleanse','dispel'])a[k]=(a[k]||0)+(b[k]||0);return a;};
const flatten = es => (es||[]).flatMap(e=>[e,...flatten(e.effects||[])]);
const progress = () => ({offenseAP:0,defenseAP:0,scheduleAP:0,lastFamily:null,damageCards:0,directCards:0,defenseCards:0,addedBuffs:0,maxHit:0,hpDamageByTarget:{},hitsByTarget:{},damageByTarget:{},cards:0,wetCooling:false,actions:{},proofCards:[],offenseR:0,defenseR:0});
function ensure(g,a) {
 g.ensureActor(a);a.flags.bossSkillUses ??= {};a.cooldowns ??= {};
 if(!a.flags.boss) a.flags.boss={family:familyOf(a),round:0,turn:progress(),last:progress(),spawnCounts:{},deadParts:[],R:0,M:1,Q:30,C:0,phase:0,nextExamRound:1,examPasses:0,calibrated:[],examHistory:[],examInterval:3,examSample:{defense:0,ap:0,rounds:0},evidence:{weapon:false,guard:false,art:false},collectRound:1,proofWindow:1,proofActions:{},mode:'collect',recordFamily:null,exposureEnd:0,naturalHeat:12};
 return a.flags.boss;
}
function ownState(g,a,key,status,value,turns=1,dispellable=false) {
 a.buffs=a.buffs.filter(e=>e.bossStateKey!==key);
 if(!value)return;
 g.addStatus(a,a,{kind:'buff',status,canonicalStatus:status,value,valueUnit:'percent',turns,dispellable,bossStateKey:key,stackKey:'boss:'+key},{skillId:'mechanic:'+key,skipEffectRoll:true});
}
function stripState(a,key){a.buffs=a.buffs.filter(e=>e.bossStateKey!==key);}
function expose(g,a,key,value,turns=1) {ownState(g,a,key,'vulnerable',value,turns,false);}
function markProof(g,a,proof) {
 const s=data(a);if(s.mode!=='collect'||s.evidence[proof])return false;s.evidence[proof]=true;
 log(g,'boss_proof',{actor:a.id,proof,evidence:{...s.evidence}});
 if(Object.values(s.evidence).every(Boolean)){s.mode='complete';s.proofCompleteRound=g.round;stripState(a,'saint_protection');log(g,'boss_protection_removed',{actor:a.id});}
 return true;
}
function openExposure(g,a) {
 const s=data(a);if(s.mode==='exposed')return;
 s.mode='exposed';s.exposureStart=g.round+1;s.exposureEnd=g.round+(pct(a)<.4?1:2);a.shield=0;
 // Installed at the next player phase; does not consume a fraction of a phase now.
 log(g,'boss_exposure_scheduled',{actor:a.id,start:s.exposureStart,end:s.exposureEnd});
}
function recordDeath(g,target,source) {
 const meta=target.flags?.bossHelper;if(!meta)return;const boss=bossOf(g,target);if(!boss)return;const s=data(boss);
 if(!s.deadParts.some(p=>p.actorId===target.id))s.deadParts.push({actorId:target.id,helperId:target.definition.id,round:g.round,order:s.deadParts.length});
 if(target.definition.id==='tide_pearl'){s.pearlBroken=true;log(g,'boss_pearl_counter',{actor:boss.id});}
 if(target.definition.id==='leviathan_tentacle')stripState(boss,'leviathan_guard');
 if(target.definition.id==='leviathan_tail')s.tailExposeRound=g.round+1;
 log(g,'boss_helper_destroyed',{actor:target.id,owner:boss.id,source:source?.id});
}
function spawn(g,a,id,{duration,hpRatio=1,initial=false,reuseId}={}) {
 const s=data(a),h=def(g,a).helpers.find(x=>x.id===id);if(!h)throw Error('Unknown Boss helper '+id);
 if(helpers(g,a).length>=2||helper(g,a,id))return null;
 const count=s.spawnCounts[id]||0;if(!reuseId&&count>=(h.maxSpawns||1))return null;
 const inherit=h.inherit,stats={hp:Math.max(1,Math.round(a.maxHp*h.hpRatioOfBoss)),attack:stat(g,a,'attack')*inherit.attack,defense:stat(g,a,'defense')*inherit.defense,speed:stat(g,a,'speed')*inherit.speed,crit:inherit.crit,critDamage:inherit.critDamage,ehr:inherit.ehr,res:inherit.res};
 let pet=reuseId?g.enemies.find(x=>x.id===reuseId):null;
 if(!pet){pet={id:a.id+':'+id+':'+(count+1),side:'enemy',level:a.level,hp:stats.hp,maxHp:stats.hp,shield:0,stats,definition:{...h,tier:'boss_helper'},flags:{},buffs:[],debuffs:[],dots:[],cooldowns:{},resources:{},phaseCount:0,healingGiven:0,healingReceived:0,slot:Math.max(0,...g.enemies.map(x=>x.slot||0))+1};g.enemies.push(pet);s.spawnCounts[id]=count+1;}
 else {pet.hp=pet.maxHp*hpRatio;pet.shield=0;pet.buffs=[];pet.debuffs=[];pet.dots=[];delete pet.intent;/* preserve helper CD and lifetime uses on regeneration */}
 pet.hp=pet.maxHp*hpRatio;pet.flags.bossHelper={ownerId:a.id,spawnRound:initial?0:g.round,expiresRound:typeof(duration??h.duration)==='number'?g.round+(duration??h.duration):null};pet.flags.bossSkillUses ??= {};g.ensureActor(pet);
 log(g,'boss_helper_spawn',{actor:pet.id,owner:a.id,helperId:id,hp:pet.hp,canActFrom:pet.flags.bossHelper.spawnRound+1});return pet;
}
function tauntReady(g,a) {
 return g.round>=(g.teamTauntUntil?.[a.side]||0)&&!all(g).some(t=>alive(t)&&t.side===a.side&&has(g,t,'taunt'));
}
function targetIds(g,a,e,chosen) {
 if(e.target==='self')return [a.id];if(e.target==='ally')return [bossOf(g,a).id];
 if(e.target==='all_allies')return [bossOf(g,a),...helpers(g,bossOf(g,a))].filter(alive).map(t=>t.id);
 const pool=foes(g,a);if(e.target==='all_enemies')return pool.map(t=>t.id);return [chosen?.id||pool[0]?.id].filter(Boolean);
}
function intent(g,a,skill,extra={}) {
 const hostile=foes(g,a),direct=skill.effects.some(e=>kind(e)==='damage'&&e.target==='enemy'),target=(direct?hostile.find(t=>has(g,t,'taunt')):null)||hostile[0];
 const entries=skill.effects.map(e=>({effect:structuredClone(e),targetIds:targetIds(g,a,e,target)}));
 const estimate=skill.effects.filter(e=>kind(e)==='damage').reduce((n,e)=>n+raw(g,a,e),0);
 const result={skillId:skill.id,skillName:skill.name,skill:structuredClone(skill),effectTargets:entries,targetId:skill.target==='self'?a.id:skill.target==='ally'?bossOf(g,a).id:target?.id,round:g.round,isMajor:!!skill.isMajor,conditional:skill.preResolve||skill.fallback,damageEstimate:[estimate,estimate*(skill.effects.some(e=>e.crit)?1+stat(g,a,'critDamage')/100:1)],scale:1,...extra};
 a.intent=result;log(g,'boss_intent',{actor:a.id,skillId:skill.id,skillName:skill.name,targetIds:entries.flatMap(e=>e.targetIds),conditional:result.conditional,mechanic:structuredClone(a.flags.boss||a.flags.bossHelper),damageEstimate:result.damageEstimate});return result;
}
function waitSkill(){return {id:'wait',name:'观察待机',priority:0,cooldown:0,target:'self',effects:[],fallback:'等待，不额外攻击'};}
function ready(g,a,skill){return (a.cooldowns[skill.id]||0)<=g.round;}
function bossCondition(g,a,id) {
 const s=data(a),p=g.player,h=helpers(g,a),prev=s.last;
 const playerHits=last(g,'hitsByTarget')[a.id]||0;
 switch(s.family){
 case'golem':return {punch:true,mistake:last(g,'damageCards')>=4&&!last(g,'healing')&&!last(g,'shieldGained')&&g.round!==s.nextExamRound,rail:pct(a)<.6&&playerHits>=3&&a.shield<=0,exam:g.round>=s.nextExamRound,restart:g.round<s.nextExamRound&&[2,4].some(n=>s.examPasses>=n&&!s.calibrated.includes(n))}[id];
 case'grave':return {scythe:true,whisper:!last(g,'cleanse')&&!has(g,p,'corrosion'),soil:pct(a)<.45&&a.shield<=0&&s.R<2,reckoning:s.R>=2,lantern:s.R<=-2&&!helper(g,a,'grave_lantern')&&(s.spawnCounts.grave_lantern||0)<2&&h.length<2,guard:pct(a)<.55&&!uses(a,'guard')&&h.length<2}[id];
 case'saint':return {gaze:true,prayer:s.mode==='collect'&&pct(a)<.6&&a.shield<=0,verdict:s.mode==='collect'&&g.round>=s.collectRound+2,decree:prev.addedBuffs>=2,crack:s.mode==='complete'}[id];
 case'tide':return {aria:true,charm:s.phase===3&&last(g,'healing')>=p.maxHp*.1,crown:s.phase===0&&a.shield<a.maxHp*.1&&!helper(g,a,'tide_pearl'),high:s.phase===1,reflux:s.phase===3&&pct(a)<.5&&uses(a,'reflux')<2&&g.healBudgetRemaining(a,a)>0,ebb:s.phase===2}[id];
 case'stag':return {antler:true,pollen:last(g,'drawn')>=3&&!has(g,p,'speed_down'),regen:pct(a)<.6&&s.M<=1&&uses(a,'regen')<2&&g.healBudgetRemaining(a,a)>0,trample:s.M>=4,bloom:(s.M===2||s.M===3)&&playerHits>=4}[id];
 case'mirror':return {stab:true,step:prev.offenseAP>=6&&s.C<2,refract:prev.maxHit>=a.maxHp*.12&&s.C<2,scrutiny:prev.defenseAP>=4&&s.C<2,copy:s.C===2,servant:pct(a)<.5&&!uses(a,'servant')&&h.length<2}[id];
 case'forge':return {flame:true,shell:s.Q<40&&pct(a)<.7&&a.shield<=0,steam:s.Q<80&&last(g,'endShield')>=p.maxHp*.2,overload:s.Q>=80,vent:s.ventPending}[id];
 case'leviathan':return {bite:true,blackwater:last(g,'shieldGained')>=p.maxHp*.2&&!has(g,p,'corrosion'),roar:last(g,'damageCards')>=5&&!has(g,p,'weak'),regrow:pct(a)<.45&&!uses(a,'regrow')&&s.deadParts.some(x=>!alive(g.enemies.find(t=>t.id===x.actorId)))&&h.length<2,devour:!h.length&&!last(g,'defenseCards')&&!last(g,'healCards')&&!s.charged,devour_hit:s.charged==='devour_hit'}[id];
 default:throw Error('Unsupported Boss '+a.id);
 }
}
function helperCondition(g,a,id) {
 const b=bossOf(g,a);if(!alive(b))return false;
 switch(id){
 case'soul_heal':return pct(b)<.9&&uses(a,id)<2&&g.healBudgetRemaining(a,b)>0;
 case'guard_taunt':return !!helper(g,b,'grave_lantern')&&tauntReady(g,a);
 case'guard_hit':case'mirror_chip':case'tentacle_hit':case'tail_idle':return true;
 case'pearl_guard':return a.shield<=0;
 case'mirror_taunt':return tauntReady(g,a);
 case'tentacle_taunt':return pct(b)>=.35&&tauntReady(g,a);
 case'tentacle_heal':return pct(b)<.35&&uses(a,id)<2&&g.healBudgetRemaining(a,b)>0;
 case'tail_prepare':return !a.flags.charged&&(a.cooldowns.tail_sweep||0)<=g.round;
 case'tail_sweep':return a.flags.charged==='tail_sweep';
 default:throw Error('Unsupported helper skill '+id);
 }
}
function setExam(g,a) {
 const s=data(a),sample=s.examSample;let exam=sample.defense===0?'guard':sample.ap/Math.max(1,sample.rounds)<1?'restraint':'attack';
 const order=['guard','restraint','attack'];if(exam===s.examType)exam=order[(order.indexOf(exam)+1)%3];s.examType=exam;s.examHistory.push(exam);s.examSample={defense:0,ap:0,rounds:0};
 return {exam,guardThreshold:90*scalar(a),healThreshold:75*scalar(a),offenseAP:3,remainingAP:2};
}
function startBossRound(g,a) {
 const s=ensure(g,a);if(s.round===g.round)return;s.last=s.turn;s.turn=progress();s.round=g.round;
 if(s.family==='saint'){
  if(s.mode==='exposed'&&g.round>s.exposureEnd){s.mode='collect';s.evidence={weapon:false,guard:false,art:false};s.collectRound=g.round;s.proofWindow++;s.proofActions={};stripState(a,'saint_exposure');ownState(g,a,'saint_protection','direct_damage_reduction',35,999999);}
  if(s.mode==='exposed'&&g.round>=s.exposureStart)expose(g,a,'saint_exposure',25,1);
 }
 if(s.family==='tide'){stripState(a,'ebb');if(s.phase===2)expose(g,a,'ebb',25,1);}
 if(s.family==='stag'){stripState(a,'shallow_dream');if(s.M===2||s.M===3)expose(g,a,'shallow_dream',20,1);}
 if(s.family==='forge')s.naturalHeat=pct(a)<.45?18:12;
 if(s.family==='leviathan'&&s.tailExposeRound===g.round)expose(g,a,'tail_break',20,1);
 if(s.family==='mirror')s.recordFamily=dominant(s.last)||s.recordFamily;
 for(const h of helpers(g,a))if(h.flags.bossHelper.expiresRound!==null&&g.round>h.flags.bossHelper.expiresRound){h.hp=0;h.flags.expired=true;log(g,'boss_helper_expired',{actor:h.id});}
}
export function planBoss(g,a) {
 if(!alive(a))return null;
 if(a.flags?.bossHelper){const b=bossOf(g,a);if(!alive(b)){a.hp=0;return null;}startBossRound(g,b);if(a.flags.bossHelper.spawnRound>=g.round)return null;const choices=a.definition.skills.filter(s=>ready(g,a,s)&&helperCondition(g,a,s.id)).sort((x,y)=>y.priority-x.priority||x.id.localeCompare(y.id));return intent(g,a,choices[0]||waitSkill());}
 startBossRound(g,a);const s=data(a);
 if(s.delayedIntent){const locked=structuredClone(s.delayedIntent);locked.round=g.round;locked.delayed=true;a.intent=locked;log(g,'boss_delayed_intent',{actor:a.id,skillId:locked.skillId,conditional:locked.conditional});return locked;}
 const choices=def(g,a).skills.filter(k=>ready(g,a,k)&&bossCondition(g,a,k.id)).sort((x,y)=>y.priority-x.priority||x.id.localeCompare(y.id));const skill=choices[0]||baseline(g,a);const extra={};
 if(s.family==='golem'&&skill.id==='exam'){extra.exam=setExam(g,a);s.examInterval=pct(a)<.4?2:3;extra.conditional={...skill.preResolve,exam:extra.exam};}
 if(s.family==='grave'&&skill.id==='scythe')extra.scale=Math.abs(s.R)<=1?.85:1;
 if(s.family==='leviathan'&&skill.id==='regrow')extra.regrowTarget=s.deadParts.find(x=>!alive(g.enemies.find(t=>t.id===x.actorId)))?.actorId;
 if(s.family==='mirror')extra.recordFamily=s.recordFamily;
 return intent(g,a,skill,extra);
}
function dominant(t) {
 const names=['offense','defense','schedule'];const max=Math.max(...names.map(k=>t[k+'AP']||0));if(max<=0)return null;
 const tied=names.filter(k=>t[k+'AP']===max);return tied.includes(t.lastFamily)?t.lastFamily:tied[0];
}
export function recordBossPlayerCard(g,card,ctx={}) {
 const es=flatten(card.effects),tot=ctx.totals||{},paid=Math.max(0,ctx.paidAP||0);
 const offense=es.some(e=>['damage','dot','chant'].includes(kind(e))),defense=(tot.heal||0)+(tot.shield||0)+(tot.cleanses||tot.cleanse||0)>0;
 // Mixed cards count once for mirror; declared family wins, then offense, defense, scheduling.
 const fam=card.behaviorFamily||ctx.behaviorFamily||(offense?'offense':defense||es.some(e=>['shield','heal','cleanse'].includes(kind(e)))?'defense':'schedule');
 for(const a of g.enemies.filter(x=>alive(x)&&x.definition?.tier==='boss')){
  startBossRound(g,a);const s=data(a),t=s.turn;t.cards++;t[fam+'AP']=(t[fam+'AP']||0)+paid;if(paid>0)t.lastFamily=fam;
  if(offense)t.damageCards++;if(es.some(e=>kind(e)==='damage'))t.directCards++;if(defense)t.defenseCards++;
  if(s.family==='grave'){
   if(offense&&t.offenseR<2){s.R=clamp(s.R+1,-3,3);t.offenseR++;}
   if((tot.heal||0)+(tot.shield||0)>0&&t.defenseR<2){s.R=clamp(s.R-1,-3,3);t.defenseR++;}
  }
  if(s.family==='saint'&&s.mode==='collect'){
   // Exactly one newly acquired proof per resolved card, using actual results.
   if((tot.damage||0)>0&&!s.evidence.weapon)markProof(g,a,'weapon');
   else if(((tot.heal||0)+(tot.shield||0))>0&&!s.evidence.guard)markProof(g,a,'guard');
   else if(((tot.debuffs||tot.debuff||0)+(tot.dot||0)+(tot.dispels||tot.dispel||0))>0&&!s.evidence.art)markProof(g,a,'art');
  }
  if(s.family==='forge'&&es.some(e=>kind(e)==='damage')&&t.directCards<=4)s.Q=clamp(s.Q+6,0,100);
 }
 log(g,'boss_player_card',{card:card.id,paidAP:paid,family:fam});
}
function performContext(g,a,name) {
 const s=data(a),t=s.turn;
 if(name==='标准防御'){g.shield(g.player,g.player,{kind:'shield',flat:25,def:.6},{star:1});t.standardGuard=true;}
 else if(name==='安魂')s.R=clamp(s.R-1,-3,3);
 else if(name==='举盾作证'){g.shield(g.player,g.player,{kind:'shield',flat:20,def:.5},{star:1});markProof(g,a,'guard');s.proofActions[name]=true;}
 else if(name==='辨明伪典'){markProof(g,a,'art');s.proofActions[name]=true;}
 else if(name==='靠岸')t.ashore=true;
 else if(name==='清醒')s.M=clamp(s.M-2,0,5);
 else if(name==='抹去镜痕'){s.C=clamp(s.C-1,0,2);t.erased=true;}
 else if(name==='泄压阀')s.Q=clamp(s.Q-15,0,100);
 else if(name==='锚定')t.anchored=true;
 else throw Error('Unsupported Boss context action '+name);
 t.actions[name]=(t.actions[name]||0)+1;
}
export function contextActions(g) {
 const out=[];if(g.phase!=='player'||!alive(g.player))return out;
 for(const a of g.enemies.filter(x=>alive(x)&&x.definition?.tier==='boss')){
  startBossRound(g,a);const s=data(a),t=s.turn;
  for(const c of def(g,a).contextActions){let reason='';const max=/最多2次/.test(c.limit)?2:1,used=t.actions[c.name]||0;
   if(used>=max)reason='本轮次数已用尽';
   if(['举盾作证','辨明伪典'].includes(c.name)&&(s.mode!=='collect'||s.proofActions[c.name]))reason='本收证窗口不可再用';
   if(c.name==='靠岸'&&a.intent?.skillId!=='high')reason='仅高潮窗口可用';
   if(c.name==='锚定'&&(a.intent?.skillId!=='devour_hit'||t.anchored))reason='仅吞潮终噬预告窗口可用';
   if((g.player.ap||0)<c.ap)reason='AP不足';out.push({...c,id:a.id+':context:'+c.name,bossId:a.id,enabled:!reason,reason,remaining:Math.max(0,max-used)});
  }
 }
 return out;
}
export function contextAction(g,id,targetId) {
 const c=contextActions(g).find(x=>x.id===id||(x.name===id&&(!targetId||x.bossId===targetId)));
 if(!c||!c.enabled)throw Error(c?.reason||'场景动作不可用');const a=g.enemies.find(x=>x.id===c.bossId);
 // Context actions do not generate class resources, card draws, or card-family AP.
 g.endAction?.();g.player.ap-=c.ap;g.player.thisTurn.apSpent=(g.player.thisTurn.apSpent||0)+c.ap;
 performContext(g,a,c.name);log(g,'boss_context_action',{actor:g.player.id,boss:a.id,name:c.name,ap:c.ap});return c;
}
function lowDamage(g,a,id,factor){const s=structuredClone(skillBy(g,a,id));s.effects=s.effects.filter(e=>kind(e)==='damage').map(e=>({...e,crit:false}));return {skill:s,scale:factor};}
function preResolve(g,a,locked) {
 const s=data(a),t=s.turn;let skill=structuredClone(locked.skill),scale=locked.scale??1,after=()=>{};
 if(s.family==='golem'&&skill.id==='exam'){
  const ex=locked.exam;const pass=ex.exam==='attack'?t.offenseAP>=3:ex.exam==='restraint'?g.player.ap>=2:t.standardGuard||g.player.thisTurn.shieldGained>=ex.guardThreshold||g.player.thisTurn.healing>=ex.healThreshold;
  scale*=pass?.5:1;after=()=>{if(pass){s.examPasses++;expose(g,a,'exam_pass',20,1);}s.nextExamRound=g.round+s.examInterval;};log(g,'boss_exam_result',{actor:a.id,pass,exam:ex.exam});
 }
 if(s.family==='golem'&&skill.id==='restart')after=()=>{const n=[2,4].find(x=>s.examPasses>=x&&!s.calibrated.includes(x));if(n)s.calibrated.push(n);a.shield=0;expose(g,a,'calibration',20,1);};
 if(s.family==='grave'&&skill.id==='reckoning'){if(s.R<=1){({skill,scale}=lowDamage(g,a,'scythe',.7));}after=()=>{s.R=0;};}
 if(s.family==='grave'&&skill.id==='lantern')after=()=>{s.R=0;};
 if(s.family==='saint'){
  if(s.mode==='complete'){skill=structuredClone(skillBy(g,a,'crack'));after=()=>openExposure(g,a);}
  else if(skill.id==='verdict')after=()=>{s.collectRound=g.round+1;};
 }
 if(s.family==='tide'){
  if(skill.id==='crown'){const can=helpers(g,a).length<2&&!helper(g,a,'tide_pearl')&&(s.spawnCounts.tide_pearl||0)<2;skill.effects=structuredClone(skill.effects[0].branches[can?0:1].effects);}
  if(skill.id==='high'){scale*=s.pearlBroken?.55:t.ashore?.60:1;after=()=>{s.pearlBroken=false;};}
  if(skill.id==='ebb')scale*=.8;
 }
 if(s.family==='stag'&&skill.id==='trample'){if(s.M<=3)({skill,scale}=lowDamage(g,a,'antler',.5));after=()=>{s.M=1;s.phaseEndMeterReset={M:1};};}
 if(s.family==='mirror'&&skill.id==='copy'){const repeated=!t.erased&&(t[(locked.recordFamily||'offense')+'AP']||0)>=4;scale*=repeated?1:.5;after=()=>{s.C=0;s.copyResolvedRound=g.round;};}
 if(s.family==='forge'){
  if(skill.id==='overload'){if(s.Q<80){({skill,scale}=lowDamage(g,a,'steam',.5));}else after=()=>{s.Q=20;s.phaseEndMeterReset={Q:20};s.ventPending=true;expose(g,a,'overload_exposure',30,2);ownState(g,a,'overload_armor','armor_break',20,2);};}
  if(skill.id==='vent')after=()=>{s.ventPending=false;};
 }
 if(s.family==='leviathan'&&skill.id==='devour_hit'){
  if(t.anchored||(t.hpDamageByTarget[a.id]||0)>=a.maxHp*.08)({skill,scale}=lowDamage(g,a,'bite',.5));after=()=>{s.charged=null;};
 }
 return {skill,scale,after};
}
function damageShare(e,n) {
 if(n<=1)return 1;let share=Math.min(1,2/n);
 if(e.multiplayerPerTarget!==undefined)share=Math.min(share,e.multiplayerPerTarget);
 if(e.totalBudgetMultiplier!==undefined)share=Math.min(share,e.totalBudgetMultiplier/n);
 if(e.totalCap){const f=e.flat>0?e.totalCap.flat/e.flat:Infinity,k=e.atk>0?e.totalCap.atk/e.atk:Infinity;share=Math.min(share,Math.min(f,k)/n);}
 return share;
}
function helperBudgetScale(g,a,skill) {
 const boss=bossOf(g,a),s=data(boss);if(s.helperBudgetRound!==g.round){s.helperBudgetRound=g.round;s.helperDamageUsed=0;}
 const basic=baseline(g,boss),budget=basic.effects.filter(e=>kind(e)==='damage').reduce((n,e)=>n+raw(g,boss,e),0)*.25;
 const required=skill.effects.filter(e=>kind(e)==='damage').reduce((n,e)=>{const count=e.target==='all_enemies'?foes(g,a).length:1;return n+raw(g,a,e)*count*damageShare(e,count);},0);
 const amount=Math.max(0,Math.min(required,budget-s.helperDamageUsed));s.helperDamageUsed+=amount;
 return required>0?amount/required:1;
}
function dispelBoss(g,t,n) {
 const rank=e=>statusKey(e)==='direct_damage_reduction'?3:statusKey(e)==='attack_up'?2:statusKey(e)==='speed_up'?1:0;
 const pool=t.buffs.filter(e=>e.dispellable!==false).sort((a,b)=>rank(b)-rank(a)||(a.addedRound||0)-(b.addedRound||0)||statusKey(a).localeCompare(statusKey(b)));
 for(const e of pool.slice(0,n))t.buffs.splice(t.buffs.indexOf(e),1);return Math.min(n,pool.length);
}
function runEffects(g,a,resolved,locked) {
 const out={},isHelper=!!a.flags.bossHelper,owner=bossOf(g,a),entries=resolved.skill.effects;
 let groupScale=isHelper?helperBudgetScale(g,a,resolved.skill):helpers(g,a).some(h=>h.definition.skills.some(s=>s.effects.some(e=>kind(e)==='damage')))?.85:1;
 const target=all(g).find(t=>t.id===locked.targetId),fallbackTarget=foes(g,a)[0];
 for(const e0 of entries){const e={...e0},type=kind(e);if(['utility','mechanic_state'].includes(type))continue;
  if(type==='summon'){
   if(e.summonId==='first_destroyed_part'){const h=g.enemies.find(x=>x.id===locked.regrowTarget);if(h&&!alive(h))spawn(g,owner,h.definition.id,{reuseId:h.id,hpRatio:.5});}
   else spawn(g,owner,e.summonId,{duration:e.duration});continue;
  }
  if(type==='charge'){if(isHelper)a.flags.charged=e.next;else data(a).charged=e.next;continue;}
  const originalRow=locked.effectTargets.find(x=>JSON.stringify(x.effect)===JSON.stringify(e0));
  let ts=originalRow?originalRow.targetIds.map(id=>all(g).find(t=>t.id===id)).filter(alive):targetIds(g,a,e,alive(target)?target:fallbackTarget).map(id=>all(g).find(t=>t.id===id)).filter(alive);
  const direct=entries.some(x=>kind(x)==='damage'&&x.target==='enemy');
  if(direct&&e.target==='enemy'&&['damage','debuff','dot'].includes(type)){const taunt=foes(g,a).find(t=>has(g,t,'taunt'));if(taunt)ts=[taunt];}
  if(!ts.length&&e.target==='enemy'&&fallbackTarget)ts=[fallbackTarget];
  const share=damageShare(e,ts.length);
  for(const t of ts){if(!alive(a)||!alive(t))continue;
   if(type==='shield_strip'){const n=Math.min(t.shield*e.ratio,(e.flatCap||0)*scalar(a)+(e.atkCap||0)*stat(g,a,'attack'));t.shield-=n;sumResult(out,{shieldDamage:n});continue;}
   if(type==='dispel'){sumResult(out,{dispel:dispelBoss(g,t,e.amount||1)});continue;}
   if(!primitive.has(type))throw Error('Unsupported Boss primitive '+type);
   if(type==='heal'&&e.maxUses&&uses(a,locked.skillId)>e.maxUses)continue;
   const factor=share*(type==='damage'?(resolved.scale??1)*groupScale:1);
   if(isHelper&&a.definition.id==='leviathan_tentacle'&&type==='buff'&&statusKey(e)==='direct_damage_reduction'){ownState(g,owner,'leviathan_guard','direct_damage_reduction',15,999999,true);continue;}
   sumResult(out,g.applyEffects([e],a,t,{forceTarget:true,scale:factor,star:1,skillId:locked.skillId}));
  }
 }
 return out;
}
function finishMechanic(g,a) {
 const s=data(a),t=s.turn;
 if(s.family==='golem'){s.examSample.defense+=g.player.thisTurn.healing+g.player.thisTurn.shieldGained;s.examSample.ap+=g.player.ap;s.examSample.rounds++;}
 if(s.family==='grave'){
  s.balanceRounds=s.balancedAtResolution?(s.balanceRounds||0)+1:0;if(s.balanceRounds>=2){expose(g,a,'balance',20,1);s.balanceRounds=0;}
 }
 if(s.family==='tide')s.phase=(s.phase+1)%4;
 if(s.family==='stag')s.M=clamp(s.M+1+(t.cards>=5?1:0),0,5);
 if(s.family==='mirror'&&s.copyResolvedRound!==g.round){const repeated=!t.erased&&s.recordFamily&&(t[s.recordFamily+'AP']||0)>=4;if(repeated)s.C=clamp(s.C+1,0,2);else if(!t.erased&&dominant(t)&&dominant(t)!==s.recordFamily)s.C=clamp(s.C-1,0,2);}
 if(s.family==='forge')s.Q=clamp(s.Q+s.naturalHeat,0,100);
 if(s.phaseEndMeterReset){Object.assign(s,s.phaseEndMeterReset);delete s.phaseEndMeterReset;}
 log(g,'boss_mechanic',{actor:a.id,family:s.family,R:s.R,M:s.M,Q:s.Q,C:s.C,phase:s.phase,evidence:s.evidence});
}
export function actBoss(g,a) {
 if(!alive(a))return {skipped:true};if(a.flags?.bossHelper&&a.flags.bossHelper.spawnRound>=g.round)return {skipped:true};
 if(!a.intent||a.intent.round!==g.round)throw Error('Boss/helper has no locked intent '+a.id);
 const locked=structuredClone(a.intent),isHelper=!!a.flags.bossHelper,s=isHelper?null:data(a);
 const previousControlWeak=new Set(a.debuffs);a.flags.bossControlled=false;
 const allowed=g.beginEnemyAction(a);
 try{
  if(!allowed||!alive(a)){if(isHelper&&a.flags.charged){a.flags.charged=null;log(g,'boss_helper_charge_cancelled',{actor:a.id});}return {skipped:true};}
  if(!isHelper&&a.flags.bossControlled){
   // Physics adds a generic weak for Boss control. Replace it with a locked,
   // single damage modifier so it does not stack twice or expire during delay.
   a.debuffs=a.debuffs.filter(e=>previousControlWeak.has(e)||statusKey(e)!=='weak');
   s.controlDamagePending=true;
   if(locked.isMajor&&!locked.delayed){s.delayedIntent={...locked,delayed:true,controlDamageScale:.8};log(g,'boss_major_delayed',{actor:a.id,skillId:locked.skillId});return {delayed:true};}
  }
  if(!isHelper&&s.family==='grave')s.balancedAtResolution=Math.abs(s.R)<=1;
  const resolved=isHelper?{skill:structuredClone(locked.skill),scale:1,after:()=>{}}:preResolve(g,a,locked);
  if(!isHelper&&s.controlDamagePending&&resolved.skill.effects.some(e=>kind(e)==='damage')){resolved.scale*=.8;s.controlDamagePending=false;}
  a.cooldowns[locked.skillId]=g.round+(locked.skill.cooldown||0);a.flags.bossSkillUses[locked.skillId]=uses(a,locked.skillId)+1;
  g.beforeEnemyAction?.(a,resolved.skill);if(!alive(a))return {skipped:true};
  const out=runEffects(g,a,resolved,locked);resolved.after();
  if(isHelper&&locked.skillId==='tail_sweep')a.flags.charged=null;
  if(!isHelper){delete s.delayedIntent;finishMechanic(g,a,locked);}
  log(g,'boss_action',{actor:a.id,announced:locked.skillId,executed:resolved.skill.id,result:out});return out;
 }finally{g.endEnemyAction(a);a.flags.bossControlled=false;}
}
export function initBosses(g) {
 if(!g.catalog?.bosses)throw Error('Boss runtime requires g.catalog.bosses');
 const bodies=g.enemies.filter(a=>a.definition?.tier==='boss');for(const a of bodies){const fresh=!a.flags?.boss;ensure(g,a);if(fresh&&data(a).family==='saint')ownState(g,a,'saint_protection','direct_damage_reduction',35,999999);if(fresh&&data(a).family==='leviathan'){spawn(g,a,'leviathan_tentacle',{initial:true});spawn(g,a,'leviathan_tail',{initial:true});ownState(g,a,'leviathan_guard','direct_damage_reduction',15,999999,true);}}
 if(installedGames.has(g))return;installedGames.add(g);
 const oldHealBudget=g.healBudgetRemaining;g.healBudgetRemaining=(source,target,e={})=>{if(source.flags?.bossHelper&&target===bossOf(g,source)){return Math.max(0,Math.min(target.maxHp-target.hp,target.maxHp*.08-(source.healingGiven||0),target.maxHp*.15-(target.healingReceived||0)));}return oldHealBudget(source,target,e);};
 const oldRaw=g.rawHit;g.rawHit=(source,target,amount,opts={})=>{const wasAlive=alive(target),out=oldRaw(source,target,amount,opts);if(source.side!=='enemy')for(const a of g.enemies.filter(x=>alive(x)&&x.definition?.tier==='boss')){const s=ensure(g,a),t=s.turn;t.hpDamageByTarget[target.id]=(t.hpDamageByTarget[target.id]||0)+(out.hpDamage||0);t.damageByTarget[target.id]=(t.damageByTarget[target.id]||0)+(out.damage||0);if(!opts.dot){t.maxHit=Math.max(t.maxHit,out.maxHit??out.damage??0);t.hitsByTarget[target.id]=(t.hitsByTarget[target.id]||0)+1;}if(opts.dot&&data(a).family==='saint'&&(out.damage||0)>0)markProof(g,a,'weapon');}if(wasAlive&&!alive(target)){recordDeath(g,target,source);if(target.definition?.tier==='boss'){for(const h of helpers(g,target)){h.hp=0;h.flags.ownerDefeated=true;}log(g,'boss_defeated',{actor:target.id});}}return out;};
 const oldStatus=g.addStatus;g.addStatus=(source,target,e,opts={})=>{const existed=target.buffs.some(b=>statusKey(b)===statusKey(e)&&b.sourceId===source.id);const out=oldStatus(source,target,e,opts);if(out&&source.side!=='enemy')for(const a of g.enemies.filter(x=>alive(x)&&x.definition?.tier==='boss')){const s=ensure(g,a);if(kind(e)==='buff'&&target.side!=='enemy'&&e.dispellable!==false&&!existed)s.turn.addedBuffs++;if(s.family==='forge'&&target===a&&['wet','freeze'].includes(statusKey(e))&&!s.turn.wetCooling){s.Q=clamp(s.Q-12,0,100);s.turn.wetCooling=true;}}return out;};
}
export const bossRuntimeCoverage={bodies:8,bodySkills:44,helperSkills:12,helpers:6,contextActions:9,effectKinds:['damage','heal','shield','buff','debuff','dot','dispel','utility','mechanic_state','summon','charge','shield_strip','branch']};
