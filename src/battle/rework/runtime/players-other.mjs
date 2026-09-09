import {bestSkillTarget} from './tactical-ai.mjs';
import {createPlayerController,stat,has,badTypes} from './common-player.mjs';
export const OTHER_PROFESSIONS=['holy_knight','shadow_knight','dragon_knight','alchemist','apothecary','blacksmith','mechanic','priest','nun','vampire_hunter','weapon_master','astrologer','dark_priest','merchant','magician'];
const safeDiscovery=['hk_oath_guard','hk_lumen_slash','hk_shield_prayer','hk_bless_weapon','hk_pure_light','hk_judgement_edge','hk_holy_heal','hk_reflect_shield','hk_chain_light','hk_immaculate','sk_shadow_cut','sk_bleed_stab','sk_shadow_bind','sk_life_rend','sk_panic_blade','dk_dragon_claw','dk_scale_guard','dk_flame_breath','dk_roar','dk_wing_guard','dk_skyfall','al_acid_vial','al_toxic_mix','al_glass_bomb','ap_healing_touch','ap_cleansing_mist','ap_sleeping_spores','ap_restorative_rain','ap_paralysis_powder','pr_cleanse','pr_light_chain','vh_silver_dagger','vh_silver_net','wmst_cross_cut','wmst_blunt_hit','wmst_counter_guard'];
const resourceSpecs={holy_knight:['圣印',6,0,4],dragon_knight:['龙魂',3,0,2],alchemist:['试剂',6,2,3],apothecary:['药性',3,0,2],blacksmith:['炉温',6,0,3],mechanic:['零件',6,1,4],nun:['苦修',3,0,2],astrologer:['星辉',6,3,Infinity],dark_priest:['理智',100,100,Infinity]};
const isAttack=ctx=>ctx.effects.some(e=>e.kind==='damage');
const gain=(ctx,key,n)=>n>0?ctx.resource(key,n):0;
function passiveStatus(ctx,status,value,turns=1,more={}){return ctx.g.applyEffects([{kind:'buff',status,value,valueUnit:'ratio',turns,target:'self',...more}],ctx.p,ctx.p,{star:1});}
export function createOtherHooks(profession){if(!OTHER_PROFESSIONS.includes(profession))throw Error('Unknown other profession '+profession);
 return {
 onInit(ctx){const {p}=ctx;p.flags.other={};const s=p.flags.pc;p.resourceCaps??={};if(resourceSpecs[profession]){const [name,cap,start,roundCap]=resourceSpecs[profession];p.resources[name]=start;p.resourceCaps[name]=cap;s.resourceCaps[name]=cap;s.resourceRoundCaps[name]=roundCap;}if(profession==='magician')p.handLimit=15;if(profession==='astrologer'){s.discoveryPool=safeDiscovery.map(id=>s.catalog.get(id)).filter(Boolean);if(s.discoveryPool.length<20)throw Error('Full card catalog required for astrology discovery');}if(profession==='merchant')p.gold=p.gold??0;},
 onStartTurn(ctx){const {p,g}=ctx;p.flags.other={firstDefense:false,markedBurst:false,dualDOT:false,firstHeal:false,selfCostProc:false,forgeGains:0,partsGains:0,overflowUsed:0,turnSame:{}};if(profession==='astrologer')gain(ctx,'星辉',1);if(profession==='magician')ctx.draw(1);if(profession==='vampire_hunter'&&g.round===5)passiveStatus(ctx,'血月猎杀',1,2,{valueUnit:'count',text:'直接增伤20%'});syncSanity(ctx);},
 onBeforePlay(ctx){const {p,card}=ctx,f=p.flags.other;const attack=isAttack(ctx);
 if(profession==='holy_knight'&&card.type==='defense'&&!f.firstDefense){gain(ctx,'圣印',1);f.firstDefense=true;}
 if(profession==='shadow_knight'&&attack&&badTypes(ctx.target)>=2&&!f.markedBurst){ctx.directBonus+=.15;f.markedBurst=true;}
 if(profession==='dragon_knight'&&attack&&(p.resources['龙魂']||0)>=3){ctx.resource('龙魂',-3);ctx.directBonus+=.2;}
 if(profession==='blacksmith'){if(['defense','skill'].includes(card.type)&&f.forgeGains<2){gain(ctx,'炉温',1);f.forgeGains++;}if(attack&&card.id!=='blacksmith_high_2'){const n=Math.min(3,p.resources['炉温']||0);if(n){ctx.resource('炉温',-n);ctx.damageAdd.flat+=4*n;ctx.damageAdd.atk+=.1*n;}}}
 if(profession==='nun'&&ctx.totals.selfDamage>0&&!f.selfCostProc){gain(ctx,'苦修',1);f.selfCostProc=true;}
 
 if(profession==='weapon_master'&&attack&&!ctx.disableCombo&&!(p.flags.pc.nextAttackFlat?.charges>0)){let count=(p.flags.pc.nameUses[card.id]||1);let bonus=count>=3?.2:count===2?.1:0;const next=p.buffs.find(b=>/下张攻击按同名|变招：/.test(b.status||'')&&(b.charges??1)>0);if(next){bonus=Math.max(bonus,/第三档/.test(next.status)?.2:.1);next.charges=0;}if(p.buffs.some(b=>/本回合攻击均按同名/.test(b.status)))bonus=Math.max(bonus,.2);if(bonus&&p.buffs.some(b=>/同名连击伤害档位增加/.test(b.status)))bonus+=.05;ctx.directBonus+=bonus;}
 if(profession==='dark_priest'&&attack){syncSanity(ctx);ctx.directBonus+=Math.min(.2,Math.floor((100-(p.resources['理智']||0))/20)*.04);const sacrifice=(p.buffs||[]).find(b=>b.status==='理智献祭直接增伤');if(sacrifice)ctx.directBonus+=sacrifice.value;}
 },
 effect(e,ctx){if(ctx.source?.id!==ctx.p.id||ctx.isSummonAction||ctx.triggered)return false;const p=ctx.p;
 
 if(profession==='apothecary'&&e.kind==='dot'&&/中毒|poison/.test(e.status)&&!ctx.apothecaryPoisonUsed&&(p.resources['药性']||0)>0){ctx.resource('药性',-1);e.atk+=.1;ctx.apothecaryPoisonUsed=true;}
 if(profession==='priest'&&e.kind==='heal'&&!e.ticks&&!ctx.scheduled){const star=(ctx.card.star||p.star||1),mul=star===3?1.2:star===2?1.1:1;const targets=e.target==='all_allies'?ctx.g.allies.filter(a=>a.hp>0):[e.target==='ally'?ctx.g.allies.filter(a=>a.hp>0).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0]:p];const scale=targets.length>2?2/targets.length:1;const base=((e.flat||0)+(e.atk||0)*stat(ctx.g,p,'attack'))*mul*scale+(e.maxHp||0)*p.maxHp;ctx.priestPotentialOverflow=(ctx.priestPotentialOverflow||0)+targets.reduce((n,t)=>n+Math.max(0,base-(t.maxHp-t.hp)),0);}
 return false;},
 onAfterPlay(ctx){const {g,p,card}=ctx,f=p.flags.other;const successfulDots=ctx.results.filter(r=>r.effect?.kind==='dot'&&(r.dot||r.debuff||r.debuffs));
 if(profession==='dragon_knight'&&successfulDots.some(r=>/灼烧|burn/.test(r.effect.status)))gain(ctx,'龙魂',1);
 if(profession==='alchemist'&&!f.dualDOT&&successfulDots.length&&g.enemies.some(t=>t.hp>0&&has(t,'poison')&&has(t,'burn'))){gain(ctx,'试剂',1);f.dualDOT=true;}
 if(profession==='apothecary'&&!f.firstHeal&&(ctx.totals.heal>0||ctx.totals.cleanses>0)){gain(ctx,'药性',1);f.firstHeal=true;}
 if(profession==='mechanic'&&['skill','summon'].includes(card.type)&&f.partsGains<2){gain(ctx,'零件',1);f.partsGains++;}
 if(profession==='priest'&&ctx.totals.overheal>0&&g.enemies.some(t=>t.hp>0)){const max=30+.8*stat(g,p,'attack'),value=Math.min(max-f.overflowUsed,ctx.totals.overheal*.5);if(value>0){const target=g.enemies.find(e=>e.hp>0&&has(e,'taunt'))||g.enemies.find(e=>e.hp>0);const r=g.damage(p,target,{kind:'damage',flat:value,atk:0,hits:1,crit:false,target:'enemy'},{star:1,directBonus:0,ignoreDirectBonuses:true,secondary:true});ctx.totals.damage+=r.damage||0;ctx.totals.hpDamage+=r.hpDamage||0;ctx.results.push({kind:'priest_overheal',...r});f.overflowUsed+=value;}}
 if(profession==='nun'&&ctx.totals.cleanses>0&&!f.purified){passiveStatus(ctx,'净化回响：直接增伤',.1,1,{canonicalStatus:'direct_damage_up'});f.purified=true;}
 if(profession==='dark_priest')syncSanity(ctx);
 if(profession==='merchant'&&card.id==='me_bribe')p.gold-=Math.ceil((g.encounterGoldReward||100)*1.5);
 },
 canPlay(card,ctx){if(profession==='dark_priest'){const total=card.effects.filter(e=>e.kind==='resource'&&e.resource==='理智'&&e.consume).reduce((n,e)=>n+e.value,0);if((ctx.p.resources['理智']||0)<total)return false;}
 if(card.id==='al_perfect_formula'&&!has(ctx.target,'poison')&&!has(ctx.target,'burn'))return false;
 if(card.id==='mg_truth_revealed'&&ctx.p.hand.filter(c=>c.id==='mg_blank_card').length<1)return false;
 if(card.id==='pr_purify_enemy'&&!(ctx.target.buffs||[]).length)return false;
 return undefined;},
 scoreCard(card,ctx,base){if(profession==='priest'&&!ctx.g.options?.patch?.smartPriest&&ctx.p.hp/ctx.p.maxHp>.9&&card.effects.some(e=>e.kind==='heal'))base+=stat(ctx.g,ctx.p,'attack')*.1;if(profession==='dark_priest'&&(ctx.p.resources['理智']||0)<30&&card.effects.some(e=>e.kind==='resource'&&e.resource==='理智'&&!e.consume))base*=2;if(profession==='magician'&&card.id==='mg_truth_revealed'&&ctx.p.hand.filter(c=>c.id==='mg_blank_card').length<3)base*=.35;return base;},
 selectSummonSkill(ctx,pet){const {p,g,target}=ctx,n=pet.name,act=pet.flags.actions||0,hp=p.hp/p.maxHp,ownHP=pet.hp/pet.maxHp,low=g.allies.filter(a=>a.hp>0).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0];let index;
 switch(n){case'日辉旗帜':index=act===1?1:0;break;case'影子替身':index=hp<.5&&!has(pet,'taunt')?0:!has(target,'weak')?2:1;break;
 case'幼龙':index=ownHP<.4&&!pet.shield?0:!has(target,'burn')?1:2;break;case'古龙':index=hp<.5&&!has(pet,'taunt')?0:g.enemies.filter(e=>e.hp>0).length>=2?1:2;break;
 case'炼成小人':index=!has(target,'poison')?0:!has(target,'burn')?1:2;break;case'自动锻锤':index=(p.resources['炉温']||0)<3?0:1;break;
 case'守护齿轮':index=hp<.5&&!has(pet,'taunt')?2:p.shield===0?0:1;break;
 case'轻型炮台':index=0;break;case'哨戒机':index=p.hand.length<=2&&!pet.flags.scouted?0:1;if(index===0)pet.flags.scouted=true;break;
 case'维修机械臂':index=low.hp/low.maxHp<.7?0:1;break;case'屏障发生器':index=0;break;case'迫击炮':index=0;break;
 case'战斗机器人':index=ownHP<.4&&pet.shield===0?0:1;break;case'无人机群':index=0;break;case'核心护卫':index=hp<.6?0:1;break;
 case'巨型机甲':index=low.hp/low.maxHp<.4?1:g.enemies.filter(e=>e.hp>0).length>=2?2:0;break;
 case'炽天使幻影':index=low.hp/low.maxHp<.75?0:1;break;case'香炉':index=low.hp/low.maxHp<.7?0:1;break;
 case'深渊仆从':index=(p.resources['理智']||0)<30&&(pet.flags.retraces||0)<2?1:0;if(index===1)pet.flags.retraces=(pet.flags.retraces||0)+1;break;
 default:throw Error('UNKNOWN_OTHER_SUMMON '+n);}
 const chosen=pet.skills[index];pet.flags.skillLastRound??={};const isTaunt=k=>k.effects.some(e=>e.kind==='buff'&&e.status==='嘲讽');const ready=k=>!k.cooldown||g.round-(pet.flags.skillLastRound[k.name]??-100)>=k.cooldown;
 const useful=k=>k.effects.some(e=>!['damage','heal','shield','buff','debuff','dot','cleanse','dispel'].includes(e.kind))||(bestSkillTarget(g,pet,k)?.value??0)>0;
 let skill=chosen;if(!ready(skill)||!useful(skill)||isTaunt(skill)&&g.allies.some(a=>a.hp>0&&has(a,'taunt')))skill=pet.skills.filter(k=>!isTaunt(k)&&ready(k)&&useful(k)).sort((a,b)=>(bestSkillTarget(g,pet,b)?.value??0)-(bestSkillTarget(g,pet,a)?.value??0))[0];if(!skill)return undefined;pet.flags.skillLastRound[skill.name]=g.round;return skill;
 }
 };
}
function syncSanity(ctx){if(ctx.p.profession!=='dark_priest')return;ctx.p.flags.sanityLow=(ctx.p.resources['理智']||0)<20;}
export function createOtherController(profession){return createPlayerController(createOtherHooks(profession));}
export function makeOtherDeck(cards,profession){const own=cards.filter(c=>c.profession===profession&&c.id!=='mg_blank_card');if(profession==='merchant')return own.concat(cards.filter(c=>c.profession==='common'&&['cm_practice_slash','cm_double_strike','cm_bandage','cm_makeshift_barrier','cm_sort_hand','cm_steady_stance','cm_distracting_dust'].includes(c.id)));return own;}
