/* global structuredClone */
import {createPlayerController} from './common-player.mjs';
export const MAGE_IDS=['elementalist','fire_mage','water_mage','wind_mage','thunder_mage','wood_mage','light_mage','dark_mage','arcane_mage','summoner'];
const RESOURCE={elementalist:['元素共鸣',6],fire_mage:['余烬',6],water_mage:['潮汐',4],wind_mage:['风痕',6],thunder_mage:['充能',6],wood_mage:['生长',6],light_mage:['光辉',4],dark_mage:['深渊回声',6],arcane_mage:['奥术印记',4],summoner:['契约',4]};
const clone=x=>structuredClone(x), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const walk=(v,fn)=>{if(!v||typeof v!=='object')return;fn(v);for(const x of Object.values(v))if(x&&typeof x==='object'){if(Array.isArray(x))x.forEach(y=>walk(y,fn));else walk(x,fn);}};
const effectsOf=c=>c.effects??c.definition?.effects??[];
const cardId=c=>c.id??c.definition?.id;
const kindCount=(c,kind)=>{let n=0;walk(effectsOf(c),e=>{if(e.kind===kind)n++});return n;};
const norm=x=>String(x?.canonicalStatus??x?.status??x?.name??x?.id??x??'').toLowerCase();
const STATUS={灼烧:['burn','灼烧'],中毒:['poison','中毒'],湿润:['wet','湿润'],冻结:['freeze','frozen','冻结'],缠绕:['entangle','缠绕'],虚弱:['weak','虚弱'],速度降低:['speed_down','slow','速度降低'],嘲讽:['taunt','嘲讽']};
function statusIs(x,key){const names=typeof x==='object'&&x?[x.canonicalStatus,x.status,x.name,x.id].filter(Boolean).map(v=>String(v).toLowerCase()):[norm(x)];return(STATUS[key]??[key]).some(y=>names.some(n=>n===y||n.includes(y)));}
function has(g,a,key){if(!a)return false;try{if(g.hasStatus?.(a,key))return true;}catch{/* Optional status helper: fall back to the stored status list. */}return [...(a.buffs??[]),...(a.debuffs??[]),...(a.dots??[])].some(s=>statusIs(s,key));}
function dots(a,key){return(a?.dots??[]).filter(d=>statusIs(d,key));}
const livingSummons=ctx=>(ctx.g.livingAllies?.()??ctx.g.allies??[]).filter(a=>a.hp>0&&a.id!==ctx.p.id&&(a.isSummon||a.ownerId===ctx.p.id||a.kind==='summon'));
const resource=(p,name)=>Number(p.resources?.[name]??0);
const total=(ctx,...keys)=>keys.reduce((n,k)=>n+Number(ctx.totals?.[k]??0),0);
function addTotal(ctx,key,n){ctx.totals??={};ctx.totals[key]=(ctx.totals[key]??0)+n;}
function state(p){p.flags??={};p.flags.mage??={};return p.flags.mage;}
function perRound(ctx){const s=state(ctx.p);if(s.round!==ctx.g.round){s.round=ctx.g.round;s.gained=0;s.events={};s.cardNameUsed={};s.elementDamageUsed=false;s.naturalChantReward=false;}return s;}
function gain(ctx,name,n){if(n<=0)return 0;const old=resource(ctx.p,name);ctx.resource(name,n);const actual=resource(ctx.p,name)-old;if(name==='深渊回声'&&actual>0){const s=state(ctx.p);s.echoBatches??=[];s.echoBatches.push({amount:actual,expiresAfterRound:ctx.g.round+1});}return actual;}
function passive(ctx,name,event){const s=perRound(ctx);if(s.gained>=2||s.events[event])return false;gain(ctx,name,1);s.gained++;s.events[event]=true;return true;}
function log(g,event){if(typeof g.log==='function')g.log(event.type,event);}
function targetFor(ctx,id){const es=ctx.g.livingEnemies?.()??(ctx.g.enemies??[]).filter(e=>e.hp>0);const old=es.find(e=>e.id===id);if(old)return old;const taunts=es.filter(e=>has(ctx.g,e,'嘲讽'));return (taunts.length?taunts:es).slice().sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||String(a.id).localeCompare(String(b.id)))[0];}
function damageWeight(es){let x=0;walk(es,e=>{if(e.kind==='damage')x+=(e.flat??0)+(e.atk??0)*150;});return x;}
function selectableChants(p,round){return(p.chants??[]).filter(c=>c.advancedRound!==round).sort((a,b)=>a.remaining-b.remaining||damageWeight(b.effects)-damageWeight(a.effects)||a.id.localeCompare(b.id));}
function runWithOptions(ctx,options,fn){const old=ctx.options;ctx.options={...(old??{}),...options};try{return fn();}finally{ctx.options=old;}}
function completeChant(ctx,chant,{natural=false,scale=1,force=false}={}){
 const p=ctx.p; p.chants=(p.chants??[]).filter(c=>c.id!==chant.id);
 let effects=clone(chant.effects);
 if(force)effects=effects.filter(e=>['damage','heal','shield'].includes(e.kind));
 const target=targetFor(ctx,chant.targetId);if(!target&&effects.some(e=>['damage','dot','debuff'].includes(e.kind)))return;
 const previousAction=ctx.g.action;ctx.g.beginAction?.(p,{id:chant.cardId,effects});try{runWithOptions(ctx,{star:chant.star,scale:(ctx.options?.scale??1)*chant.scalar*scale,sourceSnapshot:chant.snapshot,fromChant:true},()=>{for(const e of effects)ctx.resolve(e,target??p,p);});}finally{ctx.g.action=previousAction;}
 const s=perRound(ctx);if(natural&&!chant.copy&&!force&&!s.naturalChantReward){gain(ctx,'奥术印记',1);s.naturalChantReward=true;}
 log(ctx.g,{type:'chant_complete',card:chant.cardId,copy:chant.copy,natural,forced:force,round:ctx.g.round});
}
function enqueue(ctx,e){const p=ctx.p;p.chants??=[];if(p.chants.length>=3)throw new Error('MAGE_CHANT_QUEUE_FULL '+cardId(ctx.card));const s=state(p);s.chantSeq=(s.chantSeq??0)+1;p.chants.push({id:`chant:${p.id}:${s.chantSeq}`,cardId:cardId(ctx.card),remaining:e.turns,bornRound:ctx.g.round,advancedRound:null,targetId:ctx.target?.id,effects:clone(e.effects),snapshot:{attack:ctx.g.stat(p,'attack'),crit:ctx.g.stat(p,'crit'),critDamage:ctx.g.stat(p,'critDamage')},star:ctx.card.star??ctx.options?.star??p.star??1,scalar:1,copy:false});addTotal(ctx,'chants',1);log(ctx.g,{type:'chant_enqueue',card:cardId(ctx.card),remaining:e.turns,round:ctx.g.round});}
function strongIntent(ctx,target=ctx.target){const i=target?.intent??target?.flags?.intent??target?.lockedIntent;return !!(i?.isMajor||i?.skill?.isMajor||i?.charging||i?.skill?.effects?.some(e=>e.kind==='charge')||target?.flags?.charging);}
function condition(text,ctx){
 const {p,g,target}=ctx,s=state(p),t=ctx.totals??{},pet=ctx.summon??ctx.source;const lowest=Math.min(...(g.livingAllies?.()??g.allies??[p]).filter(a=>a.hp>0).map(a=>a.hp/a.maxHp));
 const res=text.match(/^拥有至少(\d+)(共鸣|余烬|潮汐|风痕|充能|光辉|回声|奥术印记)$/);if(res)return resource(p,({共鸣:'元素共鸣',回声:'深渊回声'})[res[2]]??res[2])>=Number(res[1]);
 switch(text){
 case'默认':case'否则':return true;
 case'我方最低生命比例角色低于75%':case'最低生命比例角色低于75%':return lowest<.75;
 case'最低生命比例友方低于70%':return lowest<.70;
 case'每次召唤仅首次行动且主人手牌不超过3':return (pet?.flags?.mageActionCount??0)===0&&p.hand.length<=3;
 case'主人充能不超过3且本次召唤尚未储电':return resource(p,'充能')<=3&&!pet?.flags?.mageCharged;
 case'否则，目标无速度降低':return !has(g,target,'速度降低');
 case'主人生命低于50%且自身无嘲讽':return p.hp/p.maxHp<.5&&!has(g,pet,'嘲讽');
 case'目标正预告强攻且无虚弱':case'目标正在蓄力且无虚弱':case'敌人预告强攻且无虚弱':return strongIntent(ctx)&&!has(g,target,'虚弱');
 case'目标无易伤':return !has(g,target,'易伤');
 case'自身无嘲讽，且（主人生命低于75%或有敌方强攻预告）':return !has(g,pet,'嘲讽')&&(p.hp/p.maxHp<.75||(g.livingEnemies?.()??g.enemies).some(a=>strongIntent(ctx,a)));
 case'本次召唤第一次行动且主人契约不超过2':return (pet?.flags?.mageActionCount??0)===0&&resource(p,'契约')<=2;
 case'目标灼烧低于2层':return dots(target,'灼烧').reduce((n,d)=>n+(d.layers??d.stacks??1),0)<2;
 case'上一张手动卡是有AP消耗的元素牌':return !!s.lastManualElementCard;
 case'选定敌人有灼烧':return has(g,target,'灼烧');
 case'选定敌人已有3层灼烧且本回合未使用本卡名折扣':return dots(target,'灼烧').reduce((n,d)=>n+(d.layers??d.stacks??1),0)>=3&&!perRound(ctx).cardNameUsed[`${cardId(ctx.card)}:discount`];
 case'结算前目标已湿润':return ctx.mageBefore?.wet??has(g,target,'湿润');
 case'目标已有湿润':return has(g,target,'湿润');
 case'目标护盾为0':return(target?.shield??0)===0;
 case'本卡确实驱散至少1个Buff':return(t.dispels??t.dispel??0)>0;
 case'目标拥有冻结/缠绕/虚弱任一':return['冻结','缠绕','虚弱'].some(x=>has(g,target,x));
 case'目标为不死或深渊标签':return(target?.tags??[]).some(x=>/undead|abyss|不死|深渊/.test(String(x)));
 case'本卡确实净化至少1状态':return(t.cleanses??t.cleanse??0)>0;
 case'自身无负面状态':return !(p.debuffs?.length||p.dots?.length);
 case'目标有任一减益':return !!(target?.debuffs?.length||target?.dots?.length);
 case'本卡击杀至少1目标':return(t.kills??0)>0;
 case'本场确有召唤被敌方击杀且场上有空槽；消耗1个未使用的死亡记录，每场最多1次':return (s.enemyKilledSummons??0)>0&&!s.rebirthUsed&&livingSummons(ctx).length<2;
 case'已有吟诵队列':return(p.chants?.length??0)>0;
 case'拥有至少1奥术印记且有未在本回合提前过的吟诵':return resource(p,'奥术印记')>=1&&selectableChants(p,g.round).length>0;
 case'场上至少1只己方召唤':return livingSummons(ctx).length>0;
 case'场上恰有2只己方召唤':return livingSummons(ctx).length===2;
 default:return undefined;
 }
}
function addDamage(ctx,e,n){n=clamp(n,0,e.maxPoints??e.maxTypes??e.maxBuffs??e.maxSummons??Infinity);const v=e.perPoint??e.perType??e.perBuff??e.perSummon;ctx.damageAdd??={flat:0,atk:0};ctx.damageAdd.flat+=(v?.flat??0)*n;ctx.damageAdd.atk+=(v?.atk??0)*n;return true;}
function consumeEchoBatches(ctx,n){const s=state(ctx.p);s.echoBatches??=[];for(const b of s.echoBatches){const used=Math.min(b.amount,n);b.amount-=used;n-=used;if(n<=0)break;}s.echoBatches=s.echoBatches.filter(x=>x.amount>0);}
function modifiers(e,ctx){const a=e.action;
 if(a==='按不同减益种类增伤'||a==='按不同减益种类增加本卡总直接伤害'){return addDamage(ctx,e,new Set([...(ctx.target?.debuffs??[]),...(ctx.target?.dots??[])].map(norm)).size);}
 if(a==='按消费共鸣增加本卡总伤害')return addDamage(ctx,e,ctx.spent?.['元素共鸣']??0);
 if(a==='每消费风痕增加本卡总伤害')return addDamage(ctx,e,ctx.spent?.['风痕']??0);
 if(a==='每消费充能增加本卡总伤害')return addDamage(ctx,e,ctx.spent?.['充能']??0);
 if(a==='每消费回声增加本卡总伤害')return addDamage(ctx,e,ctx.spent?.['深渊回声']??0);
 if(a==='按己方召唤数量增加本卡总直接伤害')return addDamage(ctx,e,livingSummons(ctx).length);
 if(a==='按本卡实际献祭数增加总直接伤害'||a==='按本卡实际献祭数增加每目标总直接伤害')return addDamage(ctx,e,total(ctx,'removedSummons'));
 if(a==='按目标可驱散Buff数增加本卡总直接伤害')return addDamage(ctx,e,(ctx.target?.buffs??[]).filter(b=>b.dispellable!==false&&b.dispellable!==false).length);
 if(a==='每成功驱散1个Buff追加本卡总伤害'){
  if(!ctx.magePreDispel){let amount=0;walk(ctx.effects,e=>{if(e.action==='dispel')amount+=Number(e.amount??0)});if(amount){const n=ctx.g.dispel(ctx.target,amount);addTotal(ctx,'dispels',n);ctx.magePreDispel=amount;}}
  return addDamage(ctx,e,total(ctx,'dispels'));
 }
 if(a==='按持有充能提高本卡护盾'){const n=Math.min(e.maxPoints,resource(ctx.p,'充能'));for(const fx of ctx.effects)if(fx.kind==='shield'){fx.flat+=(e.perPoint.flat??0)*n;fx.def+=(e.perPoint.def??0)*n;}return true;}
 return false;
}
function utility(e,ctx){
 if(modifiers(e,ctx))return true;
 const {p,g}=ctx,s=perRound(ctx);
 switch(e.action){
 case'记录元素':s.lastElement=e.element;return true;
 case'重置元素记录':s.lastElement=null;return true;
 case'消耗灼烧兑现攻击伤害':{
  const ds=dots(ctx.target,'灼烧').slice().sort((a,b)=>(a.remaining??a.turns??2)-(b.remaining??b.turns??2));let n=0;
  for(const d of ds){if(n>=e.consumeMax)break;const layers=d.layers??d.stacks??1,take=Math.min(layers,e.consumeMax-n);n+=take;if(take===layers)ctx.target.dots=ctx.target.dots.filter(x=>x!==d);else if(d.layers!==undefined)d.layers-=take;else d.stacks-=take;}
  if(n)runWithOptions(ctx,{forceHit:true,dotConversion:true,ignoreDirectBonuses:true},()=>ctx.damage({kind:'damage',flat:0,atk:e.atkPerLayer*n,hits:1,crit:false,target:'enemy',dotConversion:true,ignoreDirectBonuses:true},ctx.target));return true;
 }
 case'破盾附加伤害':{const amount=Math.min((ctx.target?.shield??0)*e.enemyShieldRatio,g.stat(p,'attack')*e.capAtk);if(ctx.target&&amount>0){ctx.target.shield-=amount;addTotal(ctx,'shieldDamage',amount);log(g,{type:'shield_only',source:p.id,target:ctx.target.id,amount});}return true;}
 case'推进吟诵':{const cs=selectableChants(p,g.round),chosen=e.select?.includes('全部')?cs:cs.slice(0,1);for(const c of chosen){c.advancedRound=g.round;c.remaining=Math.max(0,c.remaining-e.amount);if(c.remaining===0)completeChant(ctx,c);}return true;}
 case'复制吟诵':{if((p.chants?.length??0)>=3)throw new Error('MAGE_COPY_QUEUE_FULL');const c=(p.chants??[]).filter(c=>!c.copy&&c.effects.some(x=>['damage','heal','shield'].includes(x.kind))).sort((a,b)=>damageWeight(b.effects)-damageWeight(a.effects))[0];if(!c)throw new Error('MAGE_COPY_NO_ORIGINAL');s.chantSeq=(s.chantSeq??0)+1;p.chants.push({...clone(c),id:`chant:${p.id}:${s.chantSeq}`,effects:clone(c.effects.filter(x=>['damage','heal','shield'].includes(x.kind))),scalar:c.scalar*.5,copy:true,bornRound:g.round,advancedRound:null});return true;}
 case'立即结算全部吟诵':{for(const c of [...(p.chants??[])])completeChant(ctx,c,{scale:e.scalar,force:true});return true;}
 case'指令攻击':case'指令守护':{const pet=livingSummons(ctx).sort((a,b)=>(a.lastActionRound===g.round)-(b.lastActionRound===g.round)||String(a.id).localeCompare(String(b.id)))[0];if(pet){pet.flags??={};const usable=pet.lastActionRound===g.round?g.round+1:g.round;pet.flags.mageCommand={round:usable,expires:usable,effects:e.action==='指令攻击'?[{kind:'damage',flat:e.damage.flat,atk:e.damage.atk,hits:1,crit:false,target:'enemy'}]:[{kind:'shield',flat:e.shield.flat,def:e.shield.def,target:'ally',selector:'召唤者'}]};}return true;}
 case'双位召唤阵':{for(const summon of e.arrangement.slice(0,2))ctx.summon(summon);return true;}
 case'手动弹射':if(!ctx.mageBounceResolved)throw new Error('MAGE_BOUNCE_EFFECT_NOT_RESOLVED');return true;
 case'抽牌筛选':return true;
 case'本卡AP减免':return true; // actual adjustment happens before canPlay/payment through adjustCost.
 case'献祭召唤':case'召回召唤':{const n=e.amount==='all'?livingSummons(ctx).length:e.amount??1;ctx.removeSummons(n,e.filter);return true;}
 case'替代旧毒翻倍':return true; // explicit explanatory marker; preceding dot effects do the bounded application.
 case'需求与消耗':{if(cardId(ctx.card)!=='wood_seed_rebirth')return undefined;if(s.rebirthUsed||!(s.enemyKilledSummons??0))throw new Error('MAGE_REBIRTH_WITHOUT_DEATH');s.enemyKilledSummons--;s.rebirthUsed=true;return true;}
 case'需求':if(cardId(ctx.card)==='summoner_high_1'){if(!livingSummons(ctx).length)throw new Error('MAGE_THRONE_NEEDS_SUMMON');return true;}return undefined;
 case'限制':{
  if(e.require==='本回合已打出至少2张不同元素有AP消耗卡'){if((s.elementsThisRound?.size??0)<2)throw new Error('MAGE_BREATH_NEEDS_ELEMENTS');return true;}
  if(e.require==='本回合已手动施加灼烧成功'){if(!s.burnApplied)throw new Error('MAGE_SEED_NEEDS_BURN');return true;}
  if(!e.require&&e.maxUsesPerCardNamePerTurn)return true;
  return undefined;
 }
 default:return undefined;
 }
}
function beforePlay(ctx,profession){const s=perRound(ctx),{g,p}=ctx;ctx.mageBefore={wet:has(g,ctx.target,'湿润'),element:s.lastElement,resource:resource(p,RESOURCE[profession][0]),summonIds:livingSummons(ctx).map(x=>x.id),draw:total(ctx,'draw'),eventsIndex:g.events?.length??0,enemyStatuses:(g.enemies??[]).map(x=>({id:x.id,dots:new Set(x.dots??[]),debuffs:new Set(x.debuffs??[])}))};
 let element;walk(ctx.effects,e=>{if(e.action==='记录元素')element=e.element;});ctx.mageElement=element;
 if(profession==='elementalist'&&element&&ctx.printedAP>0&&s.lastElement&&s.lastElement!==element&&!s.elementDamageUsed&&kindCount(ctx.card,'damage')){ctx.directBonus=(ctx.directBonus??0)+.10;s.elementDamageUsed=true;}
 const healingBuffs=(p.buffs??[]).filter(b=>b.charges!==0&&/下一张.*治疗|下一张水牌治疗/.test(b.status||'')&&(!/水牌/.test(b.status)||profession==='water_mage'));if(kindCount(ctx.card,'heal')||kindCount(ctx.card,'shield')){const b=healingBuffs.sort((a,b)=>b.value-a.value)[0];if(b){ctx.mageHealShieldBonus=(b.valueUnit==='percent'?b.value/100:b.value);b.charges=(b.charges??1)-1;}}
 if(profession==='dark_mage'){const spent=ctx.spent?.['深渊回声']??0;if(spent)consumeEchoBatches(ctx,spent);}
}
function afterPlay(ctx,profession){
 const {p,g}=ctx,s=perRound(ctx),t=ctx.totals??{},id=cardId(ctx.card);const before=ctx.mageBefore??{};s.playSerial=(s.playSerial??0)+1;
 const entries=ctx.results??[];const successfulDot=total(ctx,'dot','dots')+entries.reduce((n,x)=>n+Number(x.dot??0),0)>0;
 const newBurn=(g.enemies??[]).some(a=>dots(a,'灼烧').some(d=>!before.enemyStatuses?.find(x=>x.id===a.id)?.dots.has(d)));
 if((successfulDot||newBurn)&&effectsOf(ctx.card).some(e=>e.kind==='dot'&&statusIs(e,'灼烧')))s.burnApplied=true;
 if(profession==='elementalist'){
  if(ctx.mageElement&&ctx.printedAP>0){s.elementsThisRound??=new Set();s.elementsThisRound.add(ctx.mageElement);if(before.element&&before.element!==ctx.mageElement)passive(ctx,'元素共鸣',`element:${id}:${s.playSerial}`);}
  s.lastManualElementCard=!!ctx.mageElement&&ctx.printedAP>0;
 }
 if(profession==='fire_mage'&&(successfulDot||newBurn)&&effectsOf(ctx.card).some(e=>e.kind==='dot'&&statusIs(e,'灼烧')))passive(ctx,'余烬',`burn:${id}:${s.playSerial}`);
 if(profession==='water_mage'&&!(ctx.spent?.['潮汐']>0)){
  const wetApplied=entries.some(r=>r.effect?.kind==='debuff'&&statusIs(r.effect,'湿润')&&Number(r.debuffs??r.debuff??0)>0);
  if(wetApplied&&!s.events.wet)passive(ctx,'潮汐','wet');else if((t.heal??0)>0&&!s.events.heal)passive(ctx,'潮汐','heal');
 }
 if(profession==='wind_mage'){
  if((t.draw??0)>0&&!s.events.draw)passive(ctx,'风痕','draw');else if(effectsOf(ctx.card).some(e=>e.kind==='buff'&&/速度/.test(e.status)&&e.value>0)&&!s.events.speed)passive(ctx,'风痕','speed');
 }
 if(profession==='thunder_mage'&&ctx.printedAP>0&&kindCount(ctx.card,'damage')&&!(ctx.spent?.['充能']>0))passive(ctx,'充能',`thunder:${id}:${s.playSerial}`);
 if(profession==='wood_mage'){
  if((t.heal??0)>0&&!s.events.heal)passive(ctx,'生长','heal');else if((t.summoned??0)>0&&!s.events.summon)passive(ctx,'生长','summon');
 }
 if(profession==='light_mage'&&((t.cleanses??0)>0||(t.dispels??0)>0||(t.heal??0)>=.05*(ctx.target?.side==='player'?ctx.target.maxHp:p.maxHp)))passive(ctx,'光辉',`light:${id}:${s.playSerial}`);
 if(profession==='dark_mage'){
  const selfDamage=t.selfDamage??Math.max(0,(ctx.before?.hp??p.hp)-p.hp-(t.hpDamage??0)+(t.heal??0));
  if(selfDamage>0&&effectsOf(ctx.card).some(e=>e.action==='自损生命'))passive(ctx,'深渊回声',`blood:${id}:${s.playSerial}`);
  const known=(s.echoBatches??[]).reduce((n,b)=>n+b.amount,0),actual=resource(p,'深渊回声');if(actual>known)(s.echoBatches??=[]).push({amount:actual-known,expiresAfterRound:g.round+1});if(known>actual)consumeEchoBatches(ctx,known-actual);
 }
 if(profession==='summoner'){
  if((t.summoned??0)>0&&!s.events.summon)passive(ctx,'契约','summon');else if((t.removedSummons??0)>0&&!s.events.remove)passive(ctx,'契约','remove');
 }
 s.cardNameUsed[id]=(s.cardNameUsed[id]??0)+1;
}
function canPlay(card,ctx){
 const id=cardId(card),s=perRound(ctx),p=ctx.p,cs=p.chants??[],sum=livingSummons(ctx);const count=kindCount(card,'chant');
 if(count&&cs.length+count>3)return false;
 if(id==='ar_spell_copy'&&(cs.length>=3||!cs.some(c=>!c.copy&&c.effects.some(e=>['damage','heal','shield'].includes(e.kind)))))return false;
 if(['ar_chant','ar_quick_chant','ar_grand_chant'].includes(id)&&!selectableChants(p,ctx.g.round).length)return false;
 if(id==='arcane_mage_high_1'&&!cs.length)return false;
 if(id==='em_mana_breath'&&(s.elementsThisRound?.size??0)<2)return false;
 if(id==='fm_fire_seed'&&!s.burnApplied)return false;
 if(id==='wood_seed_rebirth'&&(s.rebirthUsed||!(s.enemyKilledSummons??0)||sum.length>=2))return false;
 if(['su_sacrifice','su_recall','su_spirit_bomb','su_final_contract','summoner_high_1','summoner_high_2'].includes(id)&&!sum.length)return false;
 let namedLimit=false;walk(effectsOf(card),e=>{if(e.maxUsesPerCardNamePerTurn===1)namedLimit=true});if(namedLimit&&s.cardNameUsed[id])return false;
 return undefined;
}
function scoreCard(card,ctx,base){
 const id=cardId(card),p=ctx.p,s=state(p);let score=base;
 if(kindCount(card,'chant'))score*=.72;
 if(id==='ar_spell_copy')score+=Math.min(200,Math.max(0,...(p.chants??[]).filter(c=>!c.copy).map(c=>damageWeight(c.effects)*.5)));
 if(id==='arcane_mage_high_1')score+=(p.chants??[]).reduce((n,c)=>n+damageWeight(c.effects)*.35,0);
 if(id==='ar_quick_chant'||id==='ar_chant'||id==='ar_grand_chant')score+=(p.chants??[]).filter(c=>c.remaining===1&&c.advancedRound!==ctx.g.round).reduce((n,c)=>n+damageWeight(c.effects)*.4,0);
 if(id==='fm_burnout')score+=dots(ctx.target,'灼烧').length*ctx.g.stat(p,'attack')*.18;
 if(id==='wm_ice_wave'&&has(ctx.g,ctx.target,'湿润'))score+=35;
 if(id==='fm_kindling'&&dots(ctx.target,'灼烧').length>=3)score*=.25;
 if(id==='em_element_reset'&&resource(p,'元素共鸣')<3)score*=.4;
 if(id==='su_recall'||id==='su_sacrifice')score*=livingSummons(ctx).some(x=>x.hp/x.maxHp<.3||x.expiresRound<=ctx.g.round+1)?1:.25;
 if(id==='su_grand_summon'&&livingSummons(ctx).length===2)score*=.3;
 if(s.lastElement&&card.profession==='elementalist'&&!effectsOf(card).some(e=>e.action==='记录元素'&&e.element===s.lastElement))score+=8;
 return score;
}
export function createMageHooks(profession){
 if(!MAGE_IDS.includes(profession))throw new Error('Unknown mage '+profession);
 return {
  onInit(ctx){const p=ctx.p,[name,cap]=RESOURCE[profession];p.resourceCaps??={};p.resourceCaps[name]=cap;p.resources??={};p.resources[name]??=0;p.chants??=[];state(p).profession=profession;},
  onStartTurn(ctx){const s=perRound(ctx);s.elementsThisRound=new Set();s.burnApplied=false;if(profession==='arcane_mage')for(const c of [...(ctx.p.chants??[])])if(c.bornRound<ctx.g.round){c.remaining--;if(c.remaining<=0)completeChant(ctx,c,{natural:true});}
   const now=livingSummons(ctx);const previous=s.lastSummons??[];for(const pet of previous)if(!now.some(a=>a.id===pet.id)&&pet.hp<=0&&!pet.flags?.manuallyRemoved&&!pet.removedByPlayer&&!pet.expired)s.enemyKilledSummons=(s.enemyKilledSummons??0)+1;s.lastSummons=now;
  },
  onBeforePlay(ctx){beforePlay(ctx,profession);},onAfterPlay(ctx){afterPlay(ctx,profession);},
  onEndTurn(ctx){const s=state(ctx.p);if(profession==='wind_mage'||profession==='thunder_mage'){const name=RESOURCE[profession][0];if(resource(ctx.p,name)>4)ctx.resource(name,4-resource(ctx.p,name));}if(profession==='dark_mage'){let expired=0;for(const b of s.echoBatches??[])if(b.expiresAfterRound<=ctx.g.round)expired+=b.amount;s.echoBatches=(s.echoBatches??[]).filter(b=>b.expiresAfterRound>ctx.g.round);if(expired)ctx.resource('深渊回声',-Math.min(expired,resource(ctx.p,'深渊回声')));}s.lastSummons=livingSummons(ctx);},
  condition,utility,canPlay,scoreCard,
  adjustCost(card,ctx,ap,commit){if(cardId(card)!=='fm_pyroclasm')return ap;const s=perRound(ctx),pc=ctx.p.flags.pc;if(dots(ctx.target,'灼烧').length<3||s.cardNameUsed['fm_pyroclasm:discount']||(pc.extraAP??0)>=3||ap<=2)return ap;if(commit){pc.extraAP++;s.cardNameUsed['fm_pyroclasm:discount']=1;}return ap-1;},
  selectSummonSkill(ctx,pet){const sc={...ctx,source:pet,summon:pet};const skill=(pet.skills??[]).find(k=>{const hit=condition(k.condition,sc);if(hit===undefined)throw new Error('UNSUPPORTED_MAGE_SUMMON_CONDITION '+k.condition);return hit;});if(!skill)throw new Error('MAGE_NO_LEGAL_SUMMON_SKILL '+pet.name);const boosted=clone(skill);const amplify=(pet.buffs??[]).filter(b=>/下一次常规行动/.test(b.status||'')&&(b.chargesPerSummon??1)>0).sort((a,b)=>b.value-a.value)[0];if(amplify){walk(boosted.effects,e=>{if(['damage','heal','shield'].includes(e.kind)){for(const k of ['flat','atk','def'])if(e[k]!==undefined)e[k]*=1+amplify.value/100;}});amplify.chargesPerSummon=0;}pet.flags??={};if(skill.name==='储电')pet.flags.mageCharged=true;pet.flags.mageActionCount=(pet.flags.mageActionCount??0)+1;return boosted;},
  effect(e,ctx){
   if(e.kind==='damage'&&cardId(ctx.card)==='th_ball_lightning'&&!ctx.mageResolvingBounce){
    ctx.mageResolvingBounce=true;const hitIds=new Set();const first=ctx.target;const count=e.hits??3;
    try{for(let i=0;i<count;i++){let es=ctx.g.livingEnemies();if(!es.length)break;const taunts=es.filter(a=>has(ctx.g,a,'嘲讽'));let target=i===0&&first?.hp>0?first:es.slice().sort((a,b)=>Number(hitIds.has(a.id))-Number(hitIds.has(b.id))||a.hp/a.maxHp-b.hp/b.maxHp||String(a.id).localeCompare(String(b.id)))[0];if(taunts.length)target=taunts.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)))[0];const r=ctx.resolve({...e,flat:e.flat/count,atk:e.atk/count,hits:1},target,ctx.p);if(r?.hit)hitIds.add(target.id);}
     ctx.mageBounceResolved=true;
    }finally{ctx.mageResolvingBounce=false;}return true;
   }
   if(e.kind==='buff'&&e.phase==='preResolve'&&e.status.startsWith('本卡')){ctx.directBonus+=(e.valueUnit==='percent'?e.value/100:e.value);return true;}
   if(e.kind==='buff'&&/下一张.*减1AP/.test(e.status||'')){ctx.p.flags.pc.discounts.push({value:1,charges:1,minAp:e.minAp??1,filter:/召唤/.test(e.status)?'summon':'wind_direct',expires:ctx.g.round});return true;}
   if(e.kind==='draw'&&cardId(ctx.card)==='wood_seed_cache'){const i=ctx.p.deck.findIndex(c=>c.profession==='wood_mage');if(i>0)ctx.p.deck.unshift(ctx.p.deck.splice(i,1)[0]);ctx.draw(e.amount);return true;}
   if((e.kind==='heal'||e.kind==='shield')&&ctx.mageHealShieldBonus){for(const k of ['flat','atk','def'])if(e[k]!==undefined)e[k]*=1+ctx.mageHealShieldBonus;}
   if(e.kind==='chant'){enqueue(ctx,e);return true;}if(e.action==='dispel'&&ctx.magePreDispel){ctx.magePreDispel=Math.max(0,ctx.magePreDispel-(e.amount??1));return true;}return undefined;}
 };
}
export function createMageController(profession){return createPlayerController(createMageHooks(profession));}
export const mageSupport={professions:MAGE_IDS,conditionCount:43,chant:{snapshot:true,queueCap:3,copyCap:.5,advanceOncePerRound:true},scope:'真实职业机制，基础数值交给公共执行器和物理层；未知机制不在本模块静默降级'};
