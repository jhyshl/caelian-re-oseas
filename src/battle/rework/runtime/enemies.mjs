// Deterministic execution of the reviewed 97-creature catalog. No hand access.
const HEAL_SUFFIX='；且施放者总治疗额度剩余>0、锁定受益者总受治疗额度剩余>0、受益者确有生命缺口';
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const alive=a=>a&&a.hp>0;
const role=a=>a.definition?.roleKey;
const tag=(a,...xs)=>xs.some(x=>(a.definition?.tags||[]).includes(x));
const hp=a=>a.hp/a.maxHp;
const slot=a=>Number.isFinite(a.slot)?a.slot:0;
const magnitude=e=>e.valueUnit==='percent'?Number(e.value||0)/100:Number(e.value||0);
const stable=(a,b)=>slot(a)-slot(b)||a.id.localeCompare(b.id);
const front=a=>['guardian','bruiser'].includes(role(a));
const aid=a=>['healer','support','controller'].includes(role(a));
const actors=g=>[...new Map([...(g.allies||[g.player]),...(g.playerAllies||[]),...g.enemies].map(a=>[a.id,a])).values()].filter(alive);
const team=(g,a,includeSelf=false)=>actors(g).filter(x=>x.side===a.side&&(includeSelf||x.id!==a.id));
const foes=(g,a)=>actors(g).filter(x=>x.side!==a.side&&x.attackable!==false);
const canonical=e=>e.canonicalStatus||e.status||e.name;
const HARD=['freeze','stun','sleep','petrify'];
const statusList=a=>[...(a.buffs||[]),...(a.debuffs||[])];
const has=(g,a,s)=>!!a&&(g.hasStatus?g.hasStatus(a,s==='healing_received_down'?'healing_down':s):statusList(a).some(e=>canonical(e)===s));
const val=(g,a,s)=>g.status?Number(g.status(a,s)||0):Math.max(0,...statusList(a).filter(e=>canonical(e)===s).map(e=>Number(e.value)||0));
const dot=(a,s)=>a?(a.dots||[]).filter(e=>(e.canonicalStatus||e.status||e.stackGroup)===s).reduce((n,e)=>n+(e.stacks||1),0):0;
const anyDot=a=>(a.dots||[]).length>0;
const noHard=(g,a)=>!has(g,a,'control_immunity')&&!has(g,a,'hard_control_immunity')&&!(a.flags?.hardControlImmunity>0)&&a.phaseCount+1>(a.flags?.controlImmuneUntil??-1);
const dispellable=a=>(a.buffs||[]).filter(e=>e.dispellable!==false&&!e.undispellable);
const cleanable=a=>(a.debuffs||[]).filter(e=>e.cleanseable!==false&&!e.uncleanseable).concat((a.dots||[]).filter(e=>e.cleanseable!==false&&!e.uncleanseable));
const cleanseScore=a=>Math.max(0,...cleanable(a).map(e=>HARD.includes(canonical(e))?100:canonical(e)==='healing_received_down'?80:['poison','burn','bleed','corrosion','curse','abyss'].includes(canonical(e))?20+dot(a,canonical(e)):10));
const log=(g,event,data)=>g.log?.(event,data);
const stat=(g,a,k)=>g.stat?g.stat(a,k):a.stats[k];
function last(g,key){const v=g.player.lastTurn?.[key];if(v===undefined){if(g.round<=1)return ['hitsByTarget','damageByTarget','hpDamageByTarget','shieldBrokenByTarget','dodgesByTarget'].includes(key)?{}:0;throw Error(`Enemy AI requires player.lastTurn.${key}`);}return v;}
const hits=(g,a)=>Number(last(g,'hitsByTarget')[a.id]||0);
const received=(g,a)=>Number(last(g,'damageByTarget')[a.id]||0);
const broke=(g,a)=>!!last(g,'shieldBrokenByTarget')[a.id];
const dodged=(g,a)=>Number(last(g,'dodgesByTarget')[a.id]||0)>0;
function budget(g,a,t,e){if(typeof g.healBudgetRemaining!=='function')throw Error('Enemy AI requires g.healBudgetRemaining');return g.healBudgetRemaining(a,t,e);}
function tauntReady(g,a){g.enemyAI??={};const next=g.enemyAI.tauntNextRound?.[a.side]||0;return g.round>=next&&g.round>=(g.teamTauntUntil?.[a.side]||0)&&!team(g,a,true).some(t=>has(g,t,'taunt'));}
function ctx(g,a,t,s){return {g,a,t:t||g.player,s,p:g.player,f:team(g,a),F:team(g,a,true),L:k=>last(g,k),H:(x,k)=>has(g,x||t,k)};}
const lowFriend=(c,n,pred=()=>true)=>c.f.some(a=>hp(a)<n&&pred(a));
const noGain=(c,status)=>!c.F.some(a=>has(c.g,a,status));
const canHealSelf=c=>budget(c.g,c.a,c.a,{type:'heal',maxHpRate:1})>0;
const prevGuard=c=>!!c.a.flags?.lastEnemyActionWasGuard;
const P=new Map();const put=(text,fn)=>{if(P.has(text))throw Error('Duplicate enemy predicate');P.set(text,fn);};
put('总是',()=>true);
put('目标当前有盾且腐蚀少于2层',c=>c.t.shield>0&&dot(c.t,'corrosion')<2);
put('玩家上一轮直接攻击卡≥3张且目标无虚弱',c=>c.L('damageCards')>=3&&!has(c.g,c.t,'weak'));
put('自身生命低于45%且当前护盾低于最大生命5%',c=>hp(c.a)<.45&&c.a.shield<c.a.maxHp*.05);
put('目标上一轮结束无盾',c=>c.L('endShield')<=0);
put('自身生命低于70%且无力量增益',c=>hp(c.a)<.7&&!has(c.g,c.a,'attack_up'));
put('玩家上一轮获得护盾≥最大生命10%',c=>c.L('shieldGained')>=c.p.maxHp*.1);
put('自身已有合法的待反击记录且未被驱散',c=>!!c.a.flags?.pendingCounter||!!c.a.flags?.counterPreparation);
put('目标中毒少于2层',c=>dot(c.t,'poison')<2);
put('有一名队友存活且目标上一轮结束无盾',c=>c.f.length>=1&&c.L('endShield')<=0);
put('至少两名队友存活且队伍没有力量增益',c=>c.f.length>=2&&noGain(c,'attack_up'));
put('队友上一轮被玩家单体攻击≥2次',c=>c.f.some(a=>hits(c.g,a)>=2));
put('目标流血少于2层',c=>dot(c.t,'bleed')<2);
put('目标上一轮结束无盾或本体上一轮采取防御/强化行动',c=>c.L('endShield')<=0||prevGuard(c));
put('玩家上一轮实际恢复生命>0',c=>c.L('healing')>0);
put('玩家上一轮使用治疗或增益牌且目标无怨念',c=>(c.L('healCards')>0||c.L('buffCards')>0)&&!dot(c.t,'curse'));
put('自身生命低于55%且治疗额度未耗尽',c=>hp(c.a)<.55&&canHealSelf(c));
put('有生命低于60%的非前排队友且本方可施加嘲讽',c=>lowFriend(c,.6,a=>!front(a))&&tauntReady(c.g,c.a));
put('至少一名队友存活且目标没有猎痕',c=>c.f.length>=1&&!has(c.g,c.t,'hunt_mark'));
put('玩家上一轮使用≥4张牌且目标无缠绕',c=>c.L('cardsPlayed')>=4&&!has(c.g,c.t,'speed_down'));
put('玩家上一轮使用≥4张牌且目标无缠绕且目标当前SPD高于自身',c=>c.L('cardsPlayed')>=4&&!has(c.g,c.t,'speed_down')&&stat(c.g,c.t,'speed')>stat(c.g,c.a,'speed'));
put('自身生命低于50%且治疗额度未耗尽',c=>hp(c.a)<.5&&canHealSelf(c));
put('玩家上一轮治疗或自身低于50%生命',c=>c.L('healCards')>0||hp(c.a)<.5);
put('有一名队友存活且目标无易伤',c=>c.f.length>=1&&!has(c.g,c.t,'vulnerable'));
put('目标当前护盾≥最大生命10%',c=>c.t.shield>=c.t.maxHp*.1);
put('自身生命低于45%且治疗额度未耗尽',c=>hp(c.a)<.45&&canHealSelf(c));
put('玩家上一轮直接攻击卡≥3张且目标无缠绕',c=>c.L('damageCards')>=3&&!has(c.g,c.t,'speed_down'));
put('目标当前至少有1个可驱散增益',c=>dispellable(c.t).length>0);
put('玩家上一轮直接攻击卡≥3张',c=>c.L('damageCards')>=3);
put('至少一名队友存活且目标无易伤',c=>c.f.length>=1&&!has(c.g,c.t,'vulnerable'));
put('自身生命低于30%且本战尚未使用',c=>hp(c.a)<.3&&!c.a.flags?.enemySkillUses?.[c.s.id]);
put('自身生命低于50%且没有血怒',c=>hp(c.a)<.5&&val(c.g,c.a,'attack_up')<.2);
put('目标当前有可驱散的力量或防御强化',c=>dispellable(c.t).some(e=>['attack_up','defense_up'].includes(canonical(e))));
put('自身上一轮承受直接伤害≥最大生命15%',c=>received(c.g,c.a)>=c.a.maxHp*.15);
put('目标护盾至少为最大生命10%',c=>c.t.shield>=c.t.maxHp*.1);
put('存活的治疗或辅助队友生命低于70%且本方可施加嘲讽',c=>lowFriend(c,.7,aid)&&tauntReady(c.g,c.a));
put('至少一名队友无盾且上一轮被攻击',c=>c.f.some(a=>a.shield<=0&&hits(c.g,a)>0));
put('玩家上一轮使用≥4张牌且目标无强控免疫',c=>c.L('cardsPlayed')>=4&&noHard(c.g,c.t));
put('目标没有深渊印记',c=>!dot(c.t,'abyss'));
put('自身上一轮受到直接伤害≥最大生命15%',c=>received(c.g,c.a)>=c.a.maxHp*.15);
put('玩家上一轮获得护盾或回复生命',c=>c.L('shieldGained')>0||c.L('healing')>0);
put('非前排队友生命低于60%且本方可施加嘲讽',c=>lowFriend(c,.6,a=>!front(a))&&tauntReady(c.g,c.a));
put('目标当前有盾且腐蚀少于3层',c=>c.t.shield>0&&dot(c.t,'corrosion')<3);
put('自身生命低于50%且目标有流血',c=>hp(c.a)<.5&&dot(c.t,'bleed')>0);
put('玩家上一轮直接攻击卡≥3张且目标无强控免疫',c=>c.L('damageCards')>=3&&noHard(c.g,c.t));
put('玩家上一轮结束时无盾且当前生命高于50%',c=>c.L('endShield')<=0&&hp(c.a)>.5);
put('上一轮目标既有护盾又有持续伤害',c=>c.L('endShield')>0&&c.L('dotsAtEnd')>0);
put('目标未被凝视标记且玩家上一轮使用≥4张牌',c=>!has(c.g,c.t,'gaze_mark')&&c.L('cardsPlayed')>=4);
put('玩家上一轮恢复生命>0且目标无禁疗',c=>c.L('healing')>0&&!has(c.g,c.t,'healing_received_down'));
put('自身盾为0且本方存在低于60%生命队友',c=>c.a.shield<=0&&lowFriend(c,.6));
put('目标没有潮湿',c=>!has(c.g,c.t,'wet'));
put('目标有潮湿且没有共享强控免疫',c=>has(c.g,c.t,'wet')&&noHard(c.g,c.t));
put('队友有水系技能且目标没有潮湿',c=>c.f.some(a=>tag(a,'water','aquatic'))&&!has(c.g,c.t,'wet'));
put('一名队友有可净化强控、禁疗或2层以上DOT',c=>c.f.some(a=>cleanseScore(a)>=22));
put('最低生命比例队友低于65%且治疗额度未耗尽',c=>hp(c.t)<.65&&budget(c.g,c.a,c.t,{type:'heal',maxHpRate:1})>0);
put('玩家上一轮实际造成伤害≥自身最大生命15%',c=>c.L('damage')>=c.a.maxHp*.15);
put('目标上一轮使用≥4张牌且没有缠绕',c=>c.L('cardsPlayed')>=4&&!has(c.g,c.t,'speed_down'));
put('自身高于40%生命且有低于60%生命队友',c=>hp(c.a)>.4&&lowFriend(c,.6));
put('目标上一轮使用治疗牌且没有怨念DOT',c=>c.L('healCards')>0&&!dot(c.t,'curse'));
put('有低于70%生命的亡灵或治疗队友',c=>lowFriend(c,.7,a=>tag(a,'undead')||role(a)==='healer'));
put('目标当前没有深渊DOT且玩家上一轮用了≥3张牌',c=>!dot(c.t,'abyss')&&c.L('cardsPlayed')>=3);
put('自身上一轮被直接攻击≥3次',c=>hits(c.g,c.a)>=3);
put('有植物队友低于60%生命',c=>lowFriend(c,.6,a=>tag(a,'plant')));
put('自身上一轮闪避成功或被直接攻击≥2次',c=>dodged(c.g,c.a)||hits(c.g,c.a)>=2);
put('目标当前护盾≥最大生命8%',c=>c.t.shield>=c.t.maxHp*.08);
put('自身或构装队友生命低于50%',c=>hp(c.t)<.5&&(c.t.id===c.a.id||tag(c.t,'construct','mechanical')));
put('玩家上一轮使用≥2张法术标签牌且目标未沉默',c=>c.L('spellCards')>=2&&!has(c.g,c.t,'silence'));
put('目标没有中毒或灼烧中的至少一种',c=>!dot(c.t,'poison')||!dot(c.t,'burn'));
put('自身当前有护盾且上一轮被攻击',c=>c.a.shield>0&&hits(c.g,c.a)>0);
put('自身护盾为0且上一轮被攻击',c=>c.a.shield<=0&&hits(c.g,c.a)>0);
put('构装或治疗队友低于65%生命且本方可施加嘲讽',c=>lowFriend(c,.65,a=>tag(a,'construct','mechanical')||role(a)==='healer')&&tauntReady(c.g,c.a));
put('至少两名队友无盾且上一轮受群体攻击',c=>c.f.filter(a=>a.shield<=0).length>=2&&c.L('aoeCards')>0);
put('玩家上一轮攻击该怪≥2次',c=>hits(c.g,c.a)>=2);
put('目标没有猎痕且有一名队友存活',c=>!has(c.g,c.t,'hunt_mark')&&c.f.length>=1);
put('目标已有流血且上一轮获得治疗',c=>dot(c.t,'bleed')>0&&c.L('healing')>0);
put('至少两名队友存活且队伍缺少力量',c=>c.f.length>=2&&noGain(c,'attack_up'));
put('一名无盾队友低于60%生命',c=>c.t.shield<=0&&hp(c.t)<.6);
put('目标中毒少于2层且目标当前SPD不高于自身',c=>dot(c.t,'poison')<2&&stat(c.g,c.t,'speed')<=stat(c.g,c.a,'speed'));
put('至少一名虫类或植物队友存活',c=>c.f.some(a=>tag(a,'insect','plant')));
put('至少一名植物或虫类队友存活且目标没有中毒',c=>c.f.some(a=>tag(a,'plant','insect'))&&!dot(c.t,'poison'));
put('本方有治疗者且没有有效嘲讽',c=>c.f.some(a=>role(a)==='healer')&&tauntReady(c.g,c.a));
put('玩家上一轮实际治疗≥最大生命8%',c=>c.L('healing')>=c.p.maxHp*.08);
put('一名队友有可净化强控或禁疗，或2层以上DOT',c=>c.f.some(a=>cleanseScore(a)>=22));
put('一名队友上一轮承受直接伤害≥最大生命20%',c=>c.f.some(a=>received(c.g,a)>=a.maxHp*.2));
put('队友生命低于60%且本方可施加嘲讽',c=>lowFriend(c,.6)&&tauntReady(c.g,c.a));
put('自身生命低于50%且目标存在任一DOT',c=>hp(c.a)<.5&&anyDot(c.t));
put('目标灼烧少于2层',c=>dot(c.t,'burn')<2);
put('自身上一轮被直接攻击≥2次',c=>hits(c.g,c.a)>=2);
put('目标灼烧少于2层且目标当前SPD高于自身',c=>dot(c.t,'burn')<2&&stat(c.g,c.t,'speed')>stat(c.g,c.a,'speed'));
put('有一名攻击型队友且自身高于40%生命',c=>c.f.some(a=>['fighter','striker','bruiser'].includes(role(a)))&&hp(c.a)>.4);
put('玩家上一轮直接攻击卡≥3张且当前有盾',c=>c.L('damageCards')>=3&&c.p.shield>0);
put('至少两名队友存活且没有同类增益',c=>c.f.length>=2&&noGain(c,'attack_up'));
put('最低生命比例水系队友低于60%',c=>hp(c.t)<.6&&tag(c.t,'water','aquatic'));
put('目标已经中毒且玩家上一轮获得治疗',c=>dot(c.t,'poison')>0&&c.L('healing')>0);
put('健康前排上一轮承受≥2次直接攻击',c=>front(c.t)&&hp(c.t)>=.5&&hits(c.g,c.t)>=2);
put('队友低于65%生命且本方可施加嘲讽',c=>lowFriend(c,.65)&&tauntReady(c.g,c.a));
put('自身生命低于45%且目标未被治疗压制',c=>hp(c.a)<.45&&!has(c.g,c.t,'healing_received_down'));
put('前排队友上一轮承受≥3次直接攻击',c=>front(c.t)&&hits(c.g,c.t)>=3);
put('存活的植物或治疗队友低于70%生命',c=>lowFriend(c,.7,a=>tag(a,'plant')||role(a)==='healer'));
put('目标上一轮结束仍有盾',c=>c.L('endShield')>0);
put('植物队友低于65%生命且治疗额度未耗尽',c=>tag(c.t,'plant')&&hp(c.t)<.65&&budget(c.g,c.a,c.t,{type:'heal',maxHpRate:1})>0);
put('目标中毒且没有缠绕',c=>dot(c.t,'poison')>0&&!has(c.g,c.t,'speed_down'));
put('目标上一轮结束时无盾',c=>c.L('endShield')<=0);
put('自身上一轮被直接攻击≥2次且目标无猎痕',c=>hits(c.g,c.a)>=2&&!has(c.g,c.t,'hunt_mark'));
put('虫类或辅助队友低于65%生命',c=>lowFriend(c,.65,a=>tag(a,'insect')||aid(a)));
put('一名队友上一轮承受≥2次直接攻击',c=>c.f.some(a=>hits(c.g,a)>=2));
put('自己或队友生命低于55%且目标有流血',c=>c.F.some(a=>hp(a)<.55)&&dot(c.t,'bleed')>0);
put('目标上一轮结束无盾且有虚弱',c=>c.L('endShield')<=0&&has(c.g,c.t,'weak'));
put('治疗者或控制者上一轮被攻击且当前无盾',c=>['healer','controller'].includes(role(c.t))&&hits(c.g,c.t)>0&&c.t.shield<=0);
put('玩家上一轮使用治疗或增益牌且目标无怨念DOT',c=>(c.L('healCards')>0||c.L('buffCards')>0)&&!dot(c.t,'curse'));
put('自身上一轮护盾被击破',c=>broke(c.g,c.a));
put('玩家上一轮使用≥4张牌且目标无凝视标记',c=>c.L('cardsPlayed')>=4&&!has(c.g,c.t,'gaze_mark'));
put('自身上一轮护盾被击破且目标无易伤',c=>broke(c.g,c.a)&&!has(c.g,c.t,'vulnerable'));
put('有脆弱队友低于70%生命且本方可施加嘲讽',c=>lowFriend(c,.7,a=>!front(a))&&tauntReady(c.g,c.a));
put('至少一名火系队友存活且未有力量',c=>c.f.some(a=>tag(a,'fire')&&!has(c.g,a,'attack_up')));
put('目标上一轮获得护盾≥最大生命8%',c=>c.L('shieldGained')>=c.p.maxHp*.08);
put('机械或支援队友低于65%生命且本方可施加嘲讽',c=>lowFriend(c,.65,a=>tag(a,'mechanical','construct')||aid(a))&&tauntReady(c.g,c.a));
put('目标有灼烧且上一轮结束无盾',c=>dot(c.t,'burn')>0&&c.L('endShield')<=0);
put('至少两名队友无盾且上一轮受到群攻',c=>c.f.filter(a=>a.shield<=0).length>=2&&c.L('aoeCards')>0);
put('自身生命高于40%且上一轮未升温',c=>hp(c.a)>.4&&c.a.flags?.lastEnemyActionName!=='过载升温');
put('自身上一轮已使用过载升温或力量仍在',c=>c.a.flags?.lastEnemyActionName==='过载升温'||has(c.g,c.a,'attack_up'));
put('目标当前护盾≥最大生命12%',c=>c.t.shield>=c.t.maxHp*.12);
put('目标灼烧且没有缠绕',c=>dot(c.t,'burn')>0&&!has(c.g,c.t,'speed_down'));
put('一名海渊支援低于60%生命且本方可施加嘲讽',c=>lowFriend(c,.6,a=>tag(a,'abyss')&&aid(a))&&tauntReady(c.g,c.a));
put('友方支援低于65%生命且本方可施加嘲讽',c=>lowFriend(c,.65,aid)&&tauntReady(c.g,c.a));
put('玩家上一轮直接攻击卡≥3张且目标无恐惧',c=>c.L('damageCards')>=3&&!has(c.g,c.t,'fear'));
put('至少一名海渊队友存活且目标没有黑潮标记',c=>c.f.some(a=>tag(a,'abyss'))&&!has(c.g,c.t,'black_tide_mark'));
put('有低于60%生命的海渊队友且本方可施加嘲讽',c=>lowFriend(c,.6,a=>tag(a,'abyss'))&&tauntReady(c.g,c.a));
put('玩家上一轮使用≥4张牌且目标无恐惧',c=>c.L('cardsPlayed')>=4&&!has(c.g,c.t,'fear'));
put('自身生命低于50%且目标有潮湿',c=>hp(c.a)<.5&&has(c.g,c.t,'wet'));
put('目标有流血且玩家上一轮恢复生命',c=>dot(c.t,'bleed')>0&&c.L('healing')>0);
put('自身生命低于50%且目标没有虚弱',c=>hp(c.a)<.5&&!has(c.g,c.t,'weak'));
put('自身生命低于40%且治疗额度未耗尽',c=>hp(c.a)<.4&&canHealSelf(c));
const SHIELD_COUNTER_CONDITIONS=new Map([
 // Only the old no-shield gate is removed. Original priority, cooldown,
 // target selection and non-shield prerequisites remain in planEnemy.
 ['目标上一轮结束无盾或本体上一轮采取防御/强化行动',()=>true],
 ['目标上一轮结束无盾',()=>true],
 ['目标上一轮结束时无盾',()=>true],
 ['玩家上一轮结束时无盾且当前生命高于50%',c=>hp(c.a)>.5],
 ['目标上一轮结束无盾且有虚弱',c=>has(c.g,c.t,'weak')],
 ['目标有灼烧且上一轮结束无盾',c=>dot(c.t,'burn')>0]
]);
export function isWeakSelfBuff(s){
 if(s.effects.length!==1)return false;const e=s.effects[0];
 return (e.kind||e.type)==='buff'&&e.status==='attack_up'&&e.target==='self'&&e.turns===2&&e.value===.15;
}
function condition(g,a,t,s){
 let text=s.condition;if(text.endsWith(HEAL_SUFFIX))text=text.slice(0,-HEAL_SUFFIX.length);
 let f=P.get(text);if(!f)throw Error('Unsupported enemy condition '+a.definition.id+'/'+s.id+': '+s.condition);
 if(s.condition.includes('；')&&!s.condition.endsWith(HEAL_SUFFIX))throw Error('Unknown condition suffix');
 if(g.options?.patch?.shieldCounter&&s.executeIf?.includes('无盾')){
  f=SHIELD_COUNTER_CONDITIONS.get(text);
  if(!f)throw Error('Unsupported candidate shield prerequisite: '+text);
 }
 return f(ctx(g,a,t,s));
}
const SELECTORS=[
'主动单体直伤及附带减益遵循对方有效嘲讽；否则上一轮对本怪造成生命伤害最高者，同值最低slot。',
'范围按相对施放者阵营选择，禁止命中相反阵营','仅施放者自身',
'纯debuff、DOT施加或单独驱散不被嘲讽强拉；上一轮对本怪造成生命伤害最高者，同值最低slot，不做速度检定；仍须各自效果成功判定。',
'准备时记录的最后一个触发者；目标无效则防御',
'只从上一轮被玩家单体攻击至少2次的合法队友中选；最低生命比例优先，同值slot',
'只选guardian/bruiser角色且生命至少50%的合法友方，生命比例最高者，再slot',
'从健康前排中选当前生命比例最高且可嘲讽者；禁止把保护性嘲讽给脆弱治疗者，同值最低slot',
'只从当前无盾且上一轮受到攻击的存活队友中选；治疗/支援优先，再最低生命比例，同值slot',
'只选确有可净化状态的存活友方；按强控、禁疗、最高层DOT的最高状态优先级排序，再最低生命比例，再slot',
'只选缺失生命且目标受治疗额度剩余>0的存活友方；最低生命比例，再slot',
'治疗取最低生命比例；护盾优先治疗/支援，再最低生命比例；力量/速度取最高ATK，同值最低slot',
'只从自己或带construct/mechanical标签的存活队友中选，要求生命低于50%且目标受治疗额度剩余>0；最低生命比例，同值slot',
'只从当前无护盾、生命低于60%、目标受治疗额度剩余>0的存活友方中选；最低生命比例，同值slot',
'存活植物/虫类队友中攻击力最高者，同值最低slot',
'只从上一轮承受直接伤害至少最大生命20%的存活队友中选；最低生命比例，同值slot',
'只从fighter/striker/bruiser角色存活队友中选；最高ATK，同值slot',
'只从water或aquatic标签、生命低于60%、目标受治疗额度剩余>0的存活队友中选；最低生命比例，同值slot',
'只从guardian/bruiser角色、生命至少50%、上一轮受到至少2次直接攻击的存活队友中选；最低生命比例，同值slot',
'只从guardian/bruiser角色、上一轮受到至少3次直接攻击的存活队友中选；最低生命比例，同值slot',
'只从plant标签、生命低于65%、目标受治疗额度剩余>0的存活队友中选；最低生命比例，同值slot',
'只从上一轮受到至少2次直接攻击的存活队友中选；最低生命比例，同值slot',
'自己与队友中最低生命比例者，同值最低slot',
'只从healer/controller角色、上一轮被攻击且当前无盾的存活队友中选；最低生命比例，同值slot',
'火系队友中攻击力最高者，同值最低slot'
];
const EXECUTORS=new Map([
['执行时目标仍无盾，或本体上一轮确实防御/强化；不满足则普通攻击',(g,a,t,s)=>t.shield<=0||prevGuard(ctx(g,a,t,s))],
['本方当前无有效嘲讽且阵营嘲讽空窗结束，保护对象仍存活；否则按公开回退防御',(g,a,t)=>alive(t)&&tauntReady(g,a)],
['执行时目标仍无盾，否则普通攻击',(g,a,t)=>t.shield<=0],
['执行时目标仍无盾且条件中指定的虚弱仍存在(若本技能未要求虚弱则不检查)；否则普通攻击',(g,a,t,s)=>t.shield<=0&&(!s.condition.includes('虚弱')||has(g,t,'weak'))],
['执行时目标仍灼烧且无盾，否则普通攻击',(g,a,t)=>dot(t,'burn')>0&&t.shield<=0],
['执行时自身力量仍在才释放，否则普通攻击',(g,a)=>has(g,a,'attack_up')],
['本方当前无有效嘲讽且阵营嘲讽空窗结束，否则防御',(g,a)=>tauntReady(g,a)],
['执行时目标仍有潮湿，否则普通攻击',(g,a,t)=>has(g,t,'wet')]
]);
const UTILITIES=new Set(['lifesteal','shield_damage','shield_steal','hp_cost','prepare_counter','recorded_counter','consume_buff','steal_buff','cleanse','dispel']);
const PRIMITIVES=new Set(['damage','heal','shield','dot','buff','debuff']);
export function validateEnemyCatalog(catalog){const missing=[];const rows=catalog.monsters||catalog;for(const m of rows)for(const s of m.skills){const base=s.condition.endsWith(HEAL_SUFFIX)?s.condition.slice(0,-HEAL_SUFFIX.length):s.condition;if(!P.has(base))missing.push({id:m.id,skill:s.id,kind:'condition',text:s.condition});for(const t of [s.targetSelection,...s.effects.map(e=>e.targetSelection)].filter(Boolean))if(!SELECTORS.includes(t))missing.push({id:m.id,skill:s.id,kind:'targetSelection',text:t});if(s.executeIf&&!EXECUTORS.has(s.executeIf))missing.push({id:m.id,skill:s.id,kind:'executeIf',text:s.executeIf});for(const e of s.effects)if(!PRIMITIVES.has(e.kind||e.type)&&!UTILITIES.has(e.kind||e.type))missing.push({id:m.id,skill:s.id,kind:'effect',text:e.kind||e.type});}if(missing.length)throw Error('Unsupported enemy catalog: '+JSON.stringify(missing));return {monsters:rows.length,skills:rows.reduce((n,m)=>n+m.skills.length,0),conditions:new Set(rows.flatMap(m=>m.skills.map(s=>s.condition))).size,targetSelectors:SELECTORS.length,unsupported:[]};}
function select(g,a,s,e,previous){const target=e.target||s.target||'enemy',selector=e.targetSelection||s.targetSelection;let pool;
 if(target==='self')return [a];
 if(target==='all_allies')pool=team(g,a,true);else if(target==='all_enemies')pool=foes(g,a);else if(target==='ally')pool=team(g,a,true);else if(target==='enemy')pool=foes(g,a);else throw Error('Unknown enemy target '+target);
 const kind=e.kind||e.type,index=SELECTORS.indexOf(selector);
 if(index<0)throw Error('Unknown enemy target selector '+selector);
 const low=(x,y)=>hp(x)-hp(y)||stable(x,y),high=(x,y)=>stat(g,y,'attack')-stat(g,x,'attack')||stable(x,y);
 const eligibleHeal=x=>budget(g,a,x,e)>0;
 switch(index){
 case 0:{const taunts=pool.filter(x=>has(g,x,'taunt'));if(taunts.length)pool=taunts;pool.sort((x,y)=>(y.lastTurn?.hpDamageByTarget?.[a.id]||0)-(x.lastTurn?.hpDamageByTarget?.[a.id]||0)||stable(x,y));break;}
 case 1:case 2:pool.sort(stable);break;
 case 3:pool.sort((x,y)=>(y.lastTurn?.hpDamageByTarget?.[a.id]||0)-(x.lastTurn?.hpDamageByTarget?.[a.id]||0)||stable(x,y));break;
 case 4:{const id=a.flags?.pendingCounter?.targetId;if(id)pool=pool.filter(x=>x.id===id);pool.sort(stable);break;}
 case 5:pool=pool.filter(x=>x!==a&&hits(g,x)>=2).sort(low);break;
 case 6:case 7:pool=pool.filter(x=>front(x)&&hp(x)>=.5).sort((x,y)=>hp(y)-hp(x)||stable(x,y));break;
 case 8:pool=pool.filter(x=>x!==a&&x.shield<=0&&hits(g,x)>0).sort((x,y)=>Number(aid(y))-Number(aid(x))||low(x,y));break;
 case 9:pool=pool.filter(x=>cleanable(x).length>0).sort((x,y)=>cleanseScore(y)-cleanseScore(x)||low(x,y));break;
 case 10:pool=pool.filter(eligibleHeal).sort(low);break;
 case 11:if(kind==='heal'||kind==='lifesteal')pool=pool.filter(eligibleHeal).sort(low);else if(kind==='shield'||kind==='prepare_counter')pool.sort((x,y)=>Number(aid(y))-Number(aid(x))||low(x,y));else pool.sort(high);break;
 case 12:pool=pool.filter(x=>(x===a||tag(x,'construct','mechanical'))&&hp(x)<.5&&eligibleHeal(x)).sort(low);break;
 case 13:pool=pool.filter(x=>x.shield<=0&&hp(x)<.6&&eligibleHeal(x)).sort(low);break;
 case 14:pool=pool.filter(x=>x!==a&&tag(x,'plant','insect')).sort(high);break;
 case 15:pool=pool.filter(x=>x!==a&&received(g,x)>=x.maxHp*.2).sort(low);break;
 case 16:pool=pool.filter(x=>x!==a&&['fighter','striker','bruiser'].includes(role(x))).sort(high);break;
 case 17:pool=pool.filter(x=>x!==a&&tag(x,'water','aquatic')&&hp(x)<.6&&eligibleHeal(x)).sort(low);break;
 case 18:pool=pool.filter(x=>x!==a&&front(x)&&hp(x)>=.5&&hits(g,x)>=2).sort(low);break;
 case 19:pool=pool.filter(x=>x!==a&&front(x)&&hits(g,x)>=3).sort(low);break;
 case 20:pool=pool.filter(x=>x!==a&&tag(x,'plant')&&hp(x)<.65&&eligibleHeal(x)).sort(low);break;
 case 21:pool=pool.filter(x=>x!==a&&hits(g,x)>=2).sort(low);break;
 case 22:pool.sort(low);break;
 case 23:pool=pool.filter(x=>x!==a&&['healer','controller'].includes(role(x))&&hits(g,x)>0&&x.shield<=0).sort(low);break;
 case 24:pool=pool.filter(x=>x!==a&&tag(x,'fire')).sort(high);break;
 default:throw Error('Missing selector implementation');
 }
 if(target==='all_allies'||target==='all_enemies'){
  if(e.budget?.includes('无盾'))pool=pool.filter(x=>x.shield<=0);
  if(e.targetCapSelection?.includes('伤害'))pool.sort((x,y)=>(y.lastTurn?.hpDamage||0)-(x.lastTurn?.hpDamage||0)||stable(x,y));
  if(e.maxTargets)pool=pool.slice(0,e.maxTargets);return pool;
 }
 if(kind==='prepare_counter'&&previous?.length)pool=previous;
 return pool.slice(0,1);
}
function scaleOf(g,a){const n=g.enemyAI.entranceCount;return a.enemyScale??a.damageScale??a.encounterScale??a.scale??g.options?.enemyScale??(n>=3?.48:n===2?.62:1);}
function positive(g,a,t,e){if(!alive(t))return false;const kind=e.kind||e.type;
 if(kind==='damage')return true;
 if(kind==='heal')return budget(g,a,t,e)>0&&(g.enemyAI.evaluatingExecution||(g.enemyAI.reservedHealing?.[t.id]||0)<t.maxHp-t.hp);
 if(kind==='shield')return t.shield<t.maxHp*(e.capTargetMaxHp??.6);
 if(kind==='debuff'){if(HARD.includes(canonical(e)))return noHard(g,t);const key=t.id+':'+canonical(e);if(!g.enemyAI.evaluatingExecution&&(g.enemyAI.reservedDebuffs?.[key]??-Infinity)>=magnitude(e))return false;return !(t.debuffs||[]).some(x=>canonical(x)===canonical(e)&&magnitude(x)>=magnitude(e)&&(x.expireAtPhase-t.phaseCount)>=(e.turns||1));}
 if(kind==='dot')return dot(t,e.status==='adaptive_potion'?(!dot(t,'poison')?'poison':'burn'):canonical(e))<3;
 if(kind==='buff'){
  if(e.status==='taunt')return tauntReady(g,a)&&(g.enemyAI.evaluatingExecution||!g.enemyAI.tauntPlanner?.[a.side]);
  const reservations=g.enemyAI.reservedBuffs||{},rk=t.id+':'+canonical(e);if(!g.enemyAI.evaluatingExecution&&(reservations[rk]??-Infinity)>=magnitude(e))return false;
  const current=(t.buffs||[]).filter(x=>canonical(x)===canonical(e));
  return !current.some(x=>magnitude(x)>=magnitude(e)&&(x.expireAtPhase-t.phaseCount)>=(e.turns||1));
 }
 if(kind==='lifesteal')return budget(g,a,t,e)>0;
 if(kind==='cleanse')return cleanable(t).length>0;
 if(kind==='dispel')return dispellable(t).length>0;
 if(kind==='steal_buff')return dispellable(t).some(x=>e.allowed.includes(canonical(x)));
 if(kind==='shield_damage'||kind==='shield_steal')return t.shield>0;
 if(kind==='prepare_counter')return !t.flags?.counterPreparation&&!t.flags?.pendingCounter;
 if(kind==='recorded_counter')return !!a.flags?.pendingCounter||!!a.flags?.counterPreparation;
 if(kind==='hp_cost')return hp(a)>e.ownMaxHpRate;
 if(kind==='consume_buff')return has(g,a,e.status);
 throw Error('Missing positive utility '+kind);
}
function normalizeEffect(e,target){const out={...e};if(out.maxHpRate!==undefined)out.maxHp=out.maxHpRate;
 if(out.status==='adaptive_potion'){out.status=dot(target,'poison')?'burn':'poison';out.canonicalStatus=out.status;out.stackGroup=out.status;}
 return out;
}
function planState(g){if(!g.enemyAI)g.enemyAI={entranceCount:g.enemies.length};if(g.enemyAI.planRound!==g.round){g.enemyAI.planRound=g.round;g.enemyAI.reservedHealing={};g.enemyAI.reservedBuffs={};g.enemyAI.reservedDebuffs={};g.enemyAI.tauntPlanner={};}return g.enemyAI;}
const fallbackSkill=(a,guard=false)=>({id:a.id+(guard?'__fallback_guard':'__fallback_attack'),name:guard?'公开回退防御':'普通攻击',target:guard?'self':'enemy',cooldown:0,cooldownGroup:'fallback',effects:[guard?{type:'shield',flat:20,flatFormula:'20*(2*L+20)/60',def:.5,target:'self'}:{type:'damage',flat:20,flatFormula:'20*(2*L+20)/60',atk:1.6,hits:1,crit:true,target:'enemy'}]});
export function planEnemy(g,a){planState(g);if(!alive(a))return null;if(a.definition?.tier==='boss')throw Error('Boss must use explicit boss planner, not generic enemy template');a.flags??={};a.cooldowns??={};a.flags.enemySkillLastUsed??={};a.flags.enemySkillUses??={};
 const candidates=[];
 for(const s of a.definition.skills){if(g.options?.patch?.skipWeakSelfBuff&&isWeakSelfBuff(s))continue;if((a.cooldowns[s.cooldownGroup]||0)>g.round)continue;if(s.maxUsesPerBattle&&(a.flags.enemySkillUses[s.id]||0)>=s.maxUsesPerBattle)continue;
  let previous=[],entries=[];
  for(const original of s.effects){const ts=select(g,a,s,original,previous);const e=normalizeEffect(original,ts[0]||g.player);if(g.options?.patch?.skipWeakSelfBuff&&s.id==='mon_heat_core__skill_2'&&e.type==='buff'&&e.status==='attack_up'&&e.value===.2&&e.turns===1)e.turns=2;entries.push({effect:e,targetIds:ts.map(t=>t.id)});if((e.kind||e.type)==='shield')previous=ts;}
  const first=entries.find(x=>x.effect.target===s.target&&x.targetIds.length)||entries.find(x=>x.targetIds.length),target=s.target==='self'?a:first?actors(g).find(t=>t.id===first.targetIds[0]):null;
  if(!target)continue;if(!condition(g,a,target,s))continue;
  if(!entries.some(row=>row.targetIds.some(id=>positive(g,a,actors(g).find(t=>t.id===id),row.effect,s))))continue;
  // Hostile+friendly skills require their advertised supportive recipient to exist.
  if(entries.some(row=>row.effect.target==='ally'&&!row.targetIds.length))continue;
  candidates.push({s,entries,target});
 }
 candidates.sort((x,y)=>y.s.priority-x.s.priority||x.s.id.localeCompare(y.s.id));
 let selected=candidates[0];if(!selected){const s=fallbackSkill(a,false),target=foes(g,a).sort(stable)[0];selected={s,target,entries:[{effect:s.effects[0],targetIds:target?[target.id]:[]}]};}
 const s=selected.s,isCounter=s.effects.some(e=>(e.kind||e.type)==='recorded_counter');
 const conditional=isCounter&&a.flags.counterPreparation?'本玩家阶段若受到主动直击则按已公开准备值反击，否则防御':s.executeIf||null;
 const raw=s.effects.filter(e=>(e.kind||e.type)==='damage').reduce((n,e)=>n+(e.flat||0)*(20+2*a.level)/60+(e.atk||0)*stat(g,a,'attack'),0)*scaleOf(g,a);
 a.intent={skillId:s.id,skillName:s.name,skill:s,isMajor:['heavy','desperation'].includes(s.cooldownGroup)||s.effects.some(e=>(e.atk||0)>=2.35),charging:/蓄力|升温/.test(s.name)||/升温/.test(s.condition||''),targetId:selected.target?.id,effectTargets:selected.entries,conditional,damageEstimate:[raw,raw*(1+stat(g,a,'critDamage')/100)],round:g.round,scale:scaleOf(g,a)};
 if(g.options?.patch?.shieldCounter&&s.executeIf?.includes('无盾')){const t=selected.target,K=100+5*a.level;const noncrit=raw*K/(K+stat(g,t,'defense'))*(a.offenseGroupFactor??1);a.intent.guardThreshold=Math.max(t.maxHp*.1,noncrit*.35);a.intent.conditional='盾量达到'+a.intent.guardThreshold.toFixed(2)+'时本次重击直伤减30%，其余状态条件仍需满足';}
 for(const row of selected.entries)for(const id of row.targetIds){const t=actors(g).find(x=>x.id===id),e=row.effect;if(e.type==='heal')g.enemyAI.reservedHealing[id]=(g.enemyAI.reservedHealing[id]||0)+Math.min(budget(g,a,t,e),t.maxHp*(e.maxHpRate||0)*a.intent.scale);if(e.type==='debuff'){g.enemyAI.reservedDebuffs[id+':'+canonical(e)]=Math.max(g.enemyAI.reservedDebuffs[id+':'+canonical(e)]||0,magnitude(e));}if(e.type==='buff'){g.enemyAI.reservedBuffs[id+':'+canonical(e)]=Math.max(g.enemyAI.reservedBuffs[id+':'+canonical(e)]||0,magnitude(e));if(e.status==='taunt')g.enemyAI.tauntPlanner[a.side]=a.id;}}
 log(g,'enemy_intent',{actor:a.id,skillId:s.id,name:s.name,targetIds:selected.entries.flatMap(x=>x.targetIds),conditional:a.intent.conditional,damageEstimate:a.intent.damageEstimate});return a.intent;
}
export function planEnemies(g){planState(g);for(const a of [...g.enemies].filter(alive).sort(stable))planEnemy(g,a);return g.enemies.map(a=>a.intent).filter(Boolean);}
function findActor(g,id){return [g.player,...(g.allies||[]),...(g.playerAllies||[]),...g.enemies].find(a=>a.id===id);}
function effectRoll(g,a,t,e){return g.effectRng()<clamp((e.baseChance??100)/100*(1+stat(g,a,'ehr')/100)*(1-stat(g,t,'res')/100));}
function removeSelectedStatus(a,listName,record){const at=a[listName].indexOf(record);if(at>=0)a[listName].splice(at,1);}
function utility(g,a,t,e,opts,actionResult){const type=e.kind||e.type;let n=0;
 if(type==='shield_damage'||type==='shield_steal'){
  n=Math.min(t.shield,(e.atk||0)*stat(g,a,'attack')*opts.scale);if(e.maxTargetShieldShare)n=Math.min(n,t.shield*e.maxTargetShieldShare);
  if(n>0){g.rawHit(a,t,n,{secondary:true,enemyUtility:true});if(type==='shield_steal')g.shield(a,a,n);}
  return {damage:n,shieldDamage:n};
 }
 if(type==='lifesteal'){
  const ownerCap=e.healCapOwnMaxHp?a.maxHp*e.healCapOwnMaxHp:t.maxHp*(e.healCapTargetMaxHp??.06),amount=Math.min(ownerCap,actionResult.hpDamage*(e.actualHpDamageRate??0));
  return {heal:g.heal(a,t,amount)};
 }
 if(type==='hp_cost'){a.hp=Math.max(1,a.hp-a.maxHp*e.ownMaxHpRate);return {};}
 if(type==='consume_buff'){a.buffs=a.buffs.filter(x=>canonical(x)!==e.status&&x.status!==e.status);return {};}
 if(type==='prepare_counter'){
  if(t.flags.pendingCounter||t.flags.counterPreparation)return {};
  const record={casterId:a.id,sourceAttack:stat(g,a,'attack'),sourceLevel:a.level,flat:e.flat||0,atk:e.atk||0,scale:opts.scale,createdRound:g.round,validPlayerRound:g.round+1,sourceSkill:opts.skillId};
  t.flags.counterPreparation=record;g.addStatus(a,t,{type:'buff',status:'counter_preparation',canonicalStatus:'counter_preparation',value:1,turns:1,dispellable:true},{skillId:opts.skillId});return {};
 }
 if(type==='recorded_counter'){
  const rec=a.flags.pendingCounter;if(!rec)return {};
  const target=findActor(g,rec.targetId);if(!alive(target))return {};
  const result=g.applyEffects([{type:'damage',flat:rec.flat,flatFormula:'level_scaled',atk:rec.atk,hits:1,crit:false,target:'enemy',secondary:true}],a,target,{...opts,scale:rec.scale,attackOverride:rec.sourceAttack,flatScale:(20+2*rec.sourceLevel)/60,forceTarget:true,secondary:true,attackHit:opts.attackHit});
  delete a.flags.pendingCounter;delete a.flags.counterPreparation;a.buffs=a.buffs.filter(x=>canonical(x)!=='counter_preparation');return result;
 }
 if(type==='cleanse'){
  const sorted=cleanable(t).sort((x,y)=>{const score=e=>HARD.includes(canonical(e))?100:['healing_down','healing_received_down'].includes(canonical(e))?80:20+dot(t,canonical(e));return score(y)-score(x)||canonical(x).localeCompare(canonical(y));});
  for(const rec of sorted.slice(0,e.count??1)){removeSelectedStatus(t,t.debuffs.includes(rec)?'debuffs':'dots',rec);n++;}a.thisTurn.cleanse+=n;return {cleanse:n};
 }
 if(type==='dispel'||type==='steal_buff'){
  if(!effectRoll(g,a,t,e))return {dispel:0};let pool=dispellable(t);if(type==='steal_buff')pool=pool.filter(x=>(e.allowed||[]).includes(canonical(x)));
  pool.sort((x,y)=>{const rank=e=>canonical(e)==='attack_up'?3:canonical(e)==='defense_up'?2:1;return rank(y)-rank(x)||(y.addedRound||0)-(x.addedRound||0)||canonical(x).localeCompare(canonical(y));});
  for(const rec of pool.slice(0,e.count??1)){removeSelectedStatus(t,'buffs',rec);n++;if(type==='steal_buff')g.addStatus(a,a,{type:'buff',status:canonical(rec),canonicalStatus:canonical(rec),value:Math.min(e.valueCap??.15,Number(rec.value)||0),valueUnit:'ratio',turns:e.turns||1,dispellable:true},{skillId:opts.skillId});}
  a.thisTurn.dispel+=n;return {dispel:n};
 }
 throw Error('Unimplemented enemy utility '+type);
}
const zeroResult=()=>({damage:0,hpDamage:0,shieldDamage:0,heal:0,shield:0,crits:0,dot:0,debuff:0,buff:0,cleanse:0,dispel:0});
function sumInto(out,row={}){for(const k of Object.keys(out))out[k]+=Number(row[k]||0);}
function currentTauntEntries(g,a,intent){
 const rows=intent.effectTargets,attackRows=rows.filter(row=>(row.effect.kind||row.effect.type)==='damage'&&row.effect.target==='enemy'&&!row.effect.secondary);
 if(!attackRows.length)return rows;
 const taunt=foes(g,a).filter(t=>has(g,t,'taunt')).sort(stable)[0];if(!taunt)return rows;
 const oldIds=new Set(attackRows.flatMap(row=>row.targetIds)),redirected=[...oldIds].filter(id=>id!==taunt.id);if(!redirected.length)return rows;
 const attached=new Set(['damage','debuff','dot','shield_damage','shield_steal']);
 const next=rows.map(row=>row.effect.target==='enemy'&&!row.effect.secondary&&attached.has(row.effect.kind||row.effect.type)&&row.targetIds.some(id=>oldIds.has(id))?{...row,targetIds:[taunt.id]}:row);
 log(g,'taunt_redirect',{actor:a.id,skillId:intent.skillId,from:redirected,to:taunt.id,rule:'公开嘲讽只改主动单体直击及其附带效果的目标，技能不变'});return next;
}
function applyLocked(g,a,intent){const result=zeroResult(),hitCache=new Map();const rawEntries=currentTauntEntries(g,a,intent);
 for(const row of rawEntries)if((row.effect.kind||row.effect.type)==='damage'||(row.effect.kind||row.effect.type)==='recorded_counter')for(const id of row.targetIds){const t=findActor(g,id);if(!alive(t)||t.side===a.side||hitCache.has(id))continue;const dodge=clamp(.05+.5*(stat(g,t,'speed')-stat(g,a,'speed'))/Math.max(1,stat(g,t,'speed')+stat(g,a,'speed')),0,.25);hitCache.set(id,g.hitRng()>=dodge);}
 for(const row of rawEntries){const base=row.effect,type=base.kind||base.type,targets=row.targetIds.map(id=>findActor(g,id)).filter(alive),divisor=Math.max(1,row.targetIds.length),share=base.totalMultiplierCap?Math.min(1,base.totalMultiplierCap/divisor):1;
  for(const t of targets){if(!alive(a)||!alive(t))continue;const e={...base};delete e.condition;
   // AOE accounting is handled here. forceTarget prevents another selection/expansion in physics.
   const opts={scale:intent.scale*share*(['damage','dot','recorded_counter'].includes(type)?(a.offenseGroupFactor??1):1)*(type==='damage'&&intent.guardThreshold!==undefined&&t.shield>=intent.guardThreshold?.7:1),skillId:intent.skillId,enemyIntent:true,forceTarget:true,attackHit:hitCache.get(t.id)};
   if(t.side!==a.side&&opts.attackHit===false&&type!=='damage'&&type!=='recorded_counter')continue;
   if(UTILITIES.has(type)){sumInto(result,utility(g,a,t,e,opts,result));continue;}
   if(type==='heal'&&!positive(g,a,t,e,intent.skill))continue;
   if(type==='buff'&&e.status==='taunt'&&!tauntReady(g,a))continue;
   sumInto(result,g.applyEffects([e],a,t,opts));if(type==='buff'&&t.buffs.some(x=>x.sourceId===a.id&&x.sourceSkill===intent.skillId&&canonical(x)===canonical(e)&&x.addedRound===g.round))result.buff++;
  }
 }
 return result;
}
export function notifyEnemyDamaged(g,target,source,result){if(result.dot||result.secondary||result.hit===false||source.side===target.side)return;const prep=target.flags?.counterPreparation;if(!prep||prep.validPlayerRound!==g.round||!has(g,target,'counter_preparation'))return;if(!target.flags.pendingCounter)target.flags.pendingCounter={...prep,targetId:source.id};}
function defenseIntent(g,a){const s=fallbackSkill(a,true);return {skillId:s.id,skillName:s.name,skill:s,effectTargets:[{effect:s.effects[0],targetIds:[a.id]}],scale:scaleOf(g,a),targetId:a.id};}
function attackIntent(g,a,t){const s=fallbackSkill(a,false);return {skillId:s.id,skillName:s.name,skill:s,effectTargets:[{effect:s.effects[0],targetIds:[t.id]}],scale:scaleOf(g,a),targetId:t.id};}
export function actEnemy(g,a){if(!a.intent||a.intent.round!==g.round)throw Error(`Enemy has no locked intent ${a.id}`);g.enemyAI.evaluatingExecution=true;const original=a.intent,preparedLive=has(g,a,'counter_preparation');a.flags.enemyActionRound=g.round;
 const allowed=g.beginEnemyAction(a);try{if(!allowed||!alive(a)){log(g,'enemy_skip',{actor:a.id,reason:alive(a)?'hard_control':'dead'});return {skipped:true};}let intent=original;const t=findActor(g,original.targetId),s=original.skill;
  const counter=s.effects.some(e=>(e.kind||e.type)==='recorded_counter');
  if(counter){if(!preparedLive||!a.flags.pendingCounter||!alive(findActor(g,a.flags.pendingCounter.targetId)))intent=defenseIntent(g,a);else{const id=a.flags.pendingCounter.targetId;intent={...original,targetId:id,effectTargets:[{effect:s.effects[0],targetIds:[id]}]};}}
  else if(!alive(t))intent=defenseIntent(g,a);
  else if(s.executeIf&&!EXECUTORS.get(s.executeIf)(g,a,g.options?.patch?.shieldCounter&&s.executeIf.includes('无盾')?{...t,shield:0}:t,s))intent=s.executeIf.includes('防御')&&!s.executeIf.includes('防御/强化')?defenseIntent(g,a):attackIntent(g,a,t.side===a.side?g.player:t);
  else if(!s.effects.some(e=>['damage','dot','shield_damage'].includes(e.kind||e.type))&&!original.effectTargets.some(row=>row.targetIds.some(id=>positive(g,a,findActor(g,id),row.effect,s))))intent=defenseIntent(g,a);
  // The announced attempt consumes the announced cooldown even if its public fallback is used.
  a.cooldowns[s.cooldownGroup]=g.round+(s.cooldown||0);a.flags.enemySkillLastUsed[s.id]=g.round;a.flags.enemySkillUses[s.id]=(a.flags.enemySkillUses[s.id]||0)+1;
  g.beforeEnemyAction?.(a,intent.skill);if(!alive(a))return {skipped:true};
  const out=applyLocked(g,a,intent);a.flags.lastEnemyActionGroup=intent.skill.cooldownGroup;a.flags.lastEnemyActionName=intent.skillName;a.flags.lastEnemyActionWasGuard=intent.skill.effects.some(e=>(e.kind||e.type)==='shield'||((e.kind||e.type)==='buff'&&['attack_up','defense_up','direct_damage_reduction'].includes(e.status)));
  if(counter){delete a.flags.pendingCounter;delete a.flags.counterPreparation;a.buffs=a.buffs.filter(x=>canonical(x)!=='counter_preparation');}
  log(g,'enemy_action',{actor:a.id,announced:s.id,executed:intent.skillId,fallback:intent.skillId!==s.id,result:out});return out;
 }finally{g.enemyAI.evaluatingExecution=false;g.endEnemyAction(a);if(a.flags.counterPreparation&&a.flags.counterPreparation.validPlayerRound<=g.round&&!a.flags.pendingCounter){delete a.flags.counterPreparation;}}
}
export function actEnemies(g){const out=[];for(const a of [...g.enemies].filter(alive).sort(stable)){if(g.player.hp<=0)break;out.push(actEnemy(g,a));}return out;}
export const enemyModelNotes={conditionCounterClarification:'R+1玩家开始即锁条件反击意图，当前玩家阶段触发则执行已公开反击，否则防御；不在回合中暗换未公布技能。',coverage:'97 ordinary/elite definitions only; Boss definitions require explicit bosses.mjs and are rejected here.',conditionalRules:P.size,targetSelectors:SELECTORS.length};
