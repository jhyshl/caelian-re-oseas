// Pure Chinese display formatting over persisted/public Boss fields.
// No RNG, target retargeting, mechanic mutation, or skill re-planning.
const phases=['涨潮','高潮','退潮','静潮'];
const families={offense:'进攻',defense:'防守',schedule:'调度'};
const exams={attack:'进攻题',guard:'守势题',restraint:'节制题'};
const number=n=>Number.isFinite(Number(n))?String(Math.round(Number(n)*10)/10):'未记录';
const amount=n=>String(Math.ceil(Math.max(0,Number(n)||0)));
const alive=a=>a&&a.hp>0;
const actorBy=(g,id)=>[g.player,...(g.allies||[]),...(g.playerAllies||[]),...g.enemies].find(a=>a.id===id);
const name=(g,id)=>{const a=actorBy(g,id);return a?.name||a?.definition?.name||(id==='player'?'玩家':id||'未锁定目标');};
const skillName=(a,id)=>a?.definition?.skills?.find(s=>s.id===id)?.name||id||'机制行动';
const fields=o=>o&&typeof o==='object'?Object.values(o).filter(v=>typeof v==='string'||typeof v==='number').map(String):typeof o==='string'?[o]:[];
const helperCount=(g,a,id)=>g.enemies.filter(h=>h.flags?.bossHelper?.ownerId===a.id&&(!id||h.definition?.id===id)&&alive(h)).length;
const head=(g,a)=>a.flags?.bossHelper?actorBy(g,a.flags.bossHelper.ownerId):a;
const proofs=e=>['武证','守证','术证'].map((label,i)=>label+':'+(e?.[['weapon','guard','art'][i]]?'已取得':'缺失')).join('，');

export function describeBossState(g,a){
 if(!a)return '';
 if(a.flags?.bossHelper){const m=a.flags.bossHelper,b=head(g,a),left=m.expiresRound===null?'持续至击破':'剩余'+Math.max(0,m.expiresRound-Math.max(g.round,m.spawnRound+1)+1)+'轮';return [name(g,a.id)+'：'+left,m.spawnRound>=g.round?'本轮新召唤，下轮才能行动':'每轮1次附属行动',b?'保护对象：'+name(g,b.id):'',a.flags.charged?'已蓄势：'+skillName(a,a.flags.charged):''].filter(Boolean).join('；');}
 const s=a.flags?.boss;if(!s)return '';
 switch(s.family){
 case'golem':return ['考试通过'+number(s.examPasses)+'次','下一考试第'+number(s.nextExamRound)+'轮','考试间隔'+number(s.examInterval)+'轮',s.examType?'最近题目：'+exams[s.examType]:'',s.calibrated?.length?'已完成校准：通过第'+s.calibrated.join('、')+'次':''].filter(Boolean).join('；');
 case'grave':return ['怨念R '+number(s.R)+'（-3～3）',Math.abs(s.R)<=1?'当前处于平衡区间':'偏离平衡区间','连续平衡'+number(s.balanceRounds||0)+'轮','魂灯 '+helperCount(g,a,'grave_lantern')+'个，已召'+number(s.spawnCounts?.grave_lantern||0)+'/2次','墓骨侍卫已召'+number(s.spawnCounts?.grave_guard||0)+'/1次'].join('；');
 case'saint':{
  const mode=s.mode==='collect'?'收证中':s.mode==='complete'?'证据齐备，保护已解除':'术式暴露';
  const window=s.mode==='exposed'?(g.round<s.exposureStart?'暴露从第'+s.exposureStart+'轮开始':'暴露含本轮还剩'+Math.max(0,s.exposureEnd-g.round+1)+'个完整玩家阶段'):s.mode==='collect'?'下一裁光检查第'+number(s.collectRound+2)+'轮':'本次主要行动将崩解';
  return [mode,proofs(s.evidence),window,'收证窗口 '+number(s.proofWindow)].join('；');
 }
 case'tide':return ['当前潮相：'+(phases[s.phase]||'未记录'),'下一潮相：'+(phases[(s.phase+1)%4]||'未记录'),s.pearlBroken?'已储存破珠印记：下次高潮伤害降低45%':'没有破珠印记','鸣潮珠已召'+number(s.spawnCounts?.tide_pearl||0)+'/2次'].join('；');
 case'stag':return ['梦境深度M '+number(s.M)+'/5',a.buffs.some(e=>e.bossStateKey==='shallow_dream')?'本轮浅梦：受到直接伤害提高20%':s.M>=4?'高深度：下次计划可预告梦踏':'浅层梦境','林间再生已用'+number(a.flags.bossSkillUses?.regen||0)+'/2次'].join('；');
 case'mirror':return ['镜面充能C '+number(s.C)+'/2','镜面记录：'+(families[s.recordFamily]||'尚无'),s.turn?.erased?'本轮镜痕已抹去':'本轮同族实付AP '+number(s.turn?.[(s.recordFamily||'offense')+'AP']||0)+'/4','侍镜已召'+number(s.spawnCounts?.mirror_servant||0)+'/1次'].join('；');
 case'forge':return ['热量Q '+number(s.Q)+'/100','本轮阶段结束自然升温'+number(s.naturalHeat),s.turn?.wetCooling?'本轮湿润/冻结降温已触发':'本轮首次成功湿润/冻结可降温12',s.ventPending?'完整过载后的冷却空转待执行':''].filter(Boolean).join('；');
 case'leviathan':{
  const part=id=>{const h=g.enemies.find(x=>x.flags?.bossHelper?.ownerId===a.id&&x.definition?.id===id&&alive(x));return h?name(g,h.id)+' '+amount(h.hp)+'/'+amount(h.maxHp):id==='leviathan_tail'?'尾鳍已击破':'触须已击破';};
  return [part('leviathan_tentacle'),part('leviathan_tail'),'再生已用'+number(a.flags.bossSkillUses?.regrow||0)+'/1次',s.charged?'吞潮蓄势已完成':'未在吞潮蓄势',s.turn?.anchored?'本轮已锚定':''].filter(Boolean).join('；');
 }
 default:return '';
 }
}

function conditionalText(g,a,i){
 const b=head(g,a),s=b?.flags?.boss||{},t=s.turn||{},id=i.skillId;
 if(a.flags?.bossHelper){
  if(id==='soul_heal'||id==='tentacle_heal')return '锁定治疗'+name(g,b?.id)+'最大生命4%；本附属物最多治疗2次，头领所有来源累计受疗上限15%；治疗占本次行动';
  if(id==='tail_prepare')return '本轮仅蓄势，下轮预告横扫；不会在本轮额外造成伤害';
  if(id==='tail_sweep')return '准备护盾被击破、成功强控或部位击破均可取消横扫，不补攻击；与其他附属物共用头领普通攻击25%的直接伤害总预算';
  if(id==='tentacle_taunt')return '本次只嘲讽并重授护首15%直接减伤；均可驱散，触须击破立即移除护首';
  if(id==='guard_taunt'||id==='mirror_taunt')return '复合防护随本次技能一同获得；嘲讽到下一玩家阶段结束，队伍仅1名有效嘲讽者，随后留出空窗';
 }
 if(id==='exam'){
  const e=i.exam;
  if(!e)return '考场电流按本次已公告题目核验，通过伤害50%，失败全额；本招不暴击';
  if(e.exam==='attack')return '进攻题：本轮直接伤害或DOT牌实付AP至少'+number(e.offenseAP)+'（当前'+number(t.offenseAP||0)+'）；通过后电流伤害50%，失败全额，不暴击';
  if(e.exam==='guard')return '守势题：本轮实际护盾累计至少'+amount(e.guardThreshold)+'（当前'+amount(g.player.thisTurn?.shieldGained)+'），或实际治疗至少'+amount(e.healThreshold)+'（当前'+amount(g.player.thisTurn?.healing)+'），或使用1AP「标准防御」；通过后电流伤害50%，失败全额，不暴击';
  return '节制题：结束时保留至少'+number(e.remainingAP)+'AP（当前'+number(g.player.ap)+'）；通过后电流伤害50%，失败全额，不暴击';
 }
 if(id==='restart')return '非考试回合才校准：净化1类状态并获得护盾；被控制跳过行动时不能先净化';
 if(id==='reckoning')return '当前怨念R='+number(s.R)+'；本轮结束降至R≤1，改为70%普通镰影；否则完整反噬。两种分支不暴击，结算后R=0；1AP「安魂」每轮最多2次';
 if(id==='lantern')return '消耗本体行动召唤魂灯并清零R；本轮魂灯不行动，持续3轮，每战最多召2次';
 if(id==='guard')return '消耗本体行动召唤墓骨侍卫；本轮侍卫不行动，持续3轮，每战只召1次';
 if(id==='verdict')return '本轮集齐三证则取消裁光并崩解，当前只解除保护；下一完整玩家阶段开始暴露25%。未集齐则完整裁光，不暴击，已有证据保留；'+proofs(s.evidence);
 if(id==='crack')return '本次崩解不攻击，移除普通护盾；下一完整玩家阶段起直接易伤25%，开启时HP<40%持续1阶段，否则2阶段；只处理一次完成事件';
 if(id==='crown')return '获得护盾与1层迅捷；'+((s.spawnCounts?.tide_pearl||0)<2&&!helperCount(g,b,'tide_pearl')&&helperCount(g,b)<2?'同时召出鸣潮珠，本轮珠不行动':'本轮不再召珠')+'；本战最多召珠2次';
 if(id==='high')return '先移除现有护盾35%，最多'+amount(100*(20+2*a.level)/60+0.8*(g.stat?g.stat(a,'attack'):a.stats.attack))+'；伤害有破珠印记×0.55，否则使用1AP「靠岸」×0.60，否则全额；两者不相乘，削盾量不打折。本招不暴击，结算后消费破珠印记';
 if(id==='ebb')return '当前完整玩家阶段已暴露25%；退潮回声使用较低倍率，不追加浪冠护盾';
 if(id==='reflux')return '消耗本次行动恢复自身最大生命5%；本战最多2次，累计受疗仍受15%上限';
 if(id==='trample')return '当前梦境M='+number(s.M)+'；本轮降至M≤3，改为鹿角星辉50%，否则完整梦踏；都不暴击。1AP「清醒」降低M2点，每轮最多2次';
 if(id==='copy')return '记录族：'+(families[i.recordFamily||s.recordFamily]||'尚无')+'；本轮同族实付AP少于4，或使用2AP「抹去镜痕」，复写伤害减半；否则全额。只用Boss自己的攻击数值，不暴击，结算后C=0';
 if(id==='servant')return '消耗本体行动召侍镜；本轮侍镜不行动，最多存在3轮，本战仅1次';
 if(id==='overload')return '当前热量Q='+number(s.Q)+'；本轮降到Q<80则改为蒸汽冲击50%，不削盾、不暴击、不附过载暴露；否则完整过载不暴击，重置Q并暴露2阶段（直接易伤30%、防御降低20%）。1AP「泄压阀」降低Q15点，每轮最多2次';
 if(id==='pressure')return '本次增加攻击、护盾与10点热量；不会在本次动作中追加过载，下个玩家阶段另行预告';
 if(id==='regrow')return '再生目标已锁定为'+name(g,i.regrowTarget)+'；仅恢复该部位原最大生命50%，下轮才能行动，不重置其使用次数或其他部位CD；本战仅再生1次';
 if(id==='devour')return '本轮获得准备护盾与攻击增益，下轮预告吞潮终噬；破掉准备护盾或使用2AP「锚定」可削弱终噬';
 if(id==='devour_hit')return '本轮破掉准备护盾或使用2AP「锚定」，则改为总伤害15F＋150%攻击；否则完整终噬，均不暴击。结束后消耗准备攻击增益';
 return fields(i.conditional).join('；');
}

export function describeBossIntent(g,a){
 const i=a?.intent;if(!i)return '';
 const s=i.skill||{},targets=[...new Set((i.effectTargets||[]).flatMap(r=>r.targetIds||[]))].map(id=>name(g,id));
 const segments=[i.skillName||s.name||'机制行动',targets.length?'锁定：'+targets.join('、'):'',s.summary,conditionalText(g,a,i)];
 if(i.delayed||a.flags?.boss?.delayedIntent)segments.push('强控已延后本次大招1次行动；保持本次原意图与条件，伤害额外降低20%，不重新选招');
 else if(i.isMajor)segments.push('可用强控延后1次行动并降低该次伤害20%；每3次本体行动阶段最多触发一次');
 if(i.guardThreshold!==undefined)segments.push('已公告护盾阈值 '+amount(i.guardThreshold)+'；达到时该次直接伤害降低30%，阈值不因嘲讽改目标而重算');
 if(Array.isArray(i.damageEstimate)&&i.damageEstimate.some(n=>n>0))segments.push('原始直接伤害预算 '+amount(i.damageEstimate[0])+'～'+amount(i.damageEstimate[1])+'；尚未扣目标防御与护盾，实际分支按以上条件结算');
 segments.push('冷却'+number(s.cooldown||0)+'；本次占1个主要行动');
 return segments.filter(Boolean).join('；');
}

export function describeBossEvent(g,e){
 if(!e||typeof e.type!=='string')return '';
 const a=actorBy(g,e.actor),actorName=name(g,e.actor);
 switch(e.type){
 case'boss_intent':return actorName+'预告「'+(e.skillName||skillName(a,e.skillId))+'」';
 case'boss_action':return actorName+'执行「'+skillName(a,e.executed)+'」'+(e.announced!==e.executed?'（由已预告「'+skillName(a,e.announced)+'」按公开条件转入此分支）':'');
 case'boss_exam_result':return actorName+'的'+(exams[e.exam]||'考试')+(e.pass?'通过：电流伤害减半，下个玩家阶段暴露20%':'未通过：结算完整电流');
 case'boss_proof':return '取得'+({weapon:'武证',guard:'守证',art:'术证'}[e.proof]||e.proof)+'；'+proofs(e.evidence);
 case'boss_protection_removed':return actorName+'三证齐备，35%保护立即解除';
 case'boss_exposure_scheduled':return actorName+'暴露窗口已确定：第'+number(e.start)+'～'+number(e.end)+'轮玩家阶段';
 case'boss_major_delayed':return actorName+'的「'+skillName(a,e.skillId)+'」被强控延后1次行动，该次伤害降低20%';
 case'boss_delayed_intent':return actorName+'继续原预告「'+skillName(a,e.skillId)+'」，保持原机制条件';
 case'boss_context_action':return name(g,e.actor)+'使用场景动作「'+e.name+'」，消耗'+number(e.ap)+'AP';
 case'boss_helper_spawn':return name(g,e.owner)+'召出'+actorName+'（HP '+amount(e.hp)+'），第'+number(e.canActFrom)+'轮起可行动';
 case'boss_helper_destroyed':return actorName+'被击破';
 case'boss_helper_expired':return actorName+'持续时间结束，离场';
 case'boss_helper_charge_cancelled':return actorName+'的蓄势被强控打断，本次横扫取消';
 case'boss_pearl_counter':return '鸣潮珠被击破：已储存下一次高潮伤害降低45%的印记';
 case'boss_defeated':return actorName+'被击败，其附属部位退出战斗';
 case'boss_mechanic':{
  const values={grave:'怨念R '+number(e.R),stag:'梦境M '+number(e.M),mirror:'镜面充能C '+number(e.C),forge:'热量Q '+number(e.Q),tide:'潮相推进至'+(phases[e.phase]||'未记录'),saint:proofs(e.evidence)};
  return values[e.family]?actorName+'：'+values[e.family]:'';
 }
 default:return '';
 }
}
