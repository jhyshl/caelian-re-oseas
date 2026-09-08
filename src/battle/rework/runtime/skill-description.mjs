const names={poison:'中毒',bleed:'流血',burn:'灼烧',corrosion:'腐蚀',curse:'蚀魂',swift:'迅捷',fortitude:'坚韧',attack_up:'攻击提高',armor_break:'破甲',speed_down:'减速',weak:'虚弱',vulnerable:'易伤',healing_down:'禁疗',sleep:'沉眠',stun:'眩晕',petrify:'石化',wet:'湿润',taunt:'嘲讽',direct_damage_reduction:'直接减伤'};
const requirements={solo:'单独存活',self_shield:'准备护盾仍在',shield_cost:'准备护盾足够支付10%生命上限',self_fortitude:'自身坚韧仍在',self_attack:'自身攻击增益仍在',swift1:'至少1层迅捷',swift2:'至少2层迅捷',ally_taunt:'队友存在嘲讽',no_shield:'目标无盾',dot2:'目标至少2层持续伤害',curse2:'目标至少2层蚀魂',slow:'目标有减速',unguarded:'玩家本阶段未支付1AP防御',dot_pressure:'自身有持续伤害',direct_pressure:'自身无持续伤害',head_snake:'蛇首',head_lion:'狮首',head_goat:'羊首'};
const n=x=>String(Math.round(x*100)/100);
const helpers={grave_lantern:'魂灯',grave_guard:'守墓卫兵',tide_pearl:'潮汐珍珠',mirror_servant:'镜仆',leviathan_tentacle:'利维坦触腕',leviathan_tail:'利维坦尾鳍',first_destroyed_part:'最先被破坏的部位'};
const formula=e=>[(e.flat? n(e.flat)+'F':''),(e.atk?n(e.atk*100)+'%攻击':''),(e.def?n(e.def*100)+'%防御':''),(e.maxHpRatio?n(e.maxHpRatio*100)+'%目标生命上限':'')].filter(Boolean).join('＋')||'0';
export function describeSkillEffects(skill){
 return skill.effects.map(e=>{
  const k=e.type||e.kind,target=e.allyHelper==='any'?'低血附属（无附属则自身）':e.allyHelper?helpers[e.allyHelper]:({self:'自身',ally:'队友',enemy:'敌方单体',all_enemies:'敌方全体',all_allies:'全体队友'})[e.target]||'';
  let line='';
  if(k==='damage')line='总伤害'+formula(e)+(e.hits>1?'，分'+e.hits+'段':'')+'，'+(e.crit===false?'不暴击':'逐目标逐段判定暴击');
  if(k==='heal'||k==='shield')line=(k==='heal'?'治疗':'护盾')+formula(e);
  if(k==='dot')line=(names[e.status]||e.status)+'每层每次'+n(e.atk*100)+'%施加时攻击，2次结算，不暴击，基础命中'+(e.baseChance??100)+'%';
  if(k==='buff'||k==='debuff')line=e.status==='swift'?n(e.stacks??1)+'层迅捷，每层＋20%基础速度，无层数上限':e.permanentDefenseRatio!==undefined?'坚韧＋'+n(e.permanentDefenseRatio*100)+'%自身基础防御':(names[e.status]||e.status)+(e.valueUnit==='ratio'?' '+n(e.value*100)+'%':'');
  if(k==='buff'||k==='debuff')line+='，'+(e.turns??1)+'回合'+(k==='debuff'&&!e.selfCost?'，基础命中'+(e.baseChance??100)+'%':'');
  if(k==='cleanse'||k==='dispel')line=(k==='cleanse'?'净化':'驱散')+(e.amount??1)+'类状态'+(e.allowed?'（减速或破甲）':'');
  if(k==='consume_buff')line='消耗'+(e.amount??'全部')+'层'+(names[e.status]||e.status);
  if(k==='shield_cost')line='消耗本次准备的剩余护盾'+(e.maxHpRate?'，最多'+n(e.maxHpRate*100)+'%生命上限':'');
  if(k==='hp_cost')line='支付'+n((e.currentHpRate??e.ownMaxHpRate)*100)+'%当前生命，最低保留1';
  if(k==='lifesteal')line='按实际生命伤害'+n(e.actualHpDamageRate*100)+'%治疗，受本战治疗额度限制';
  if(k==='damage_bonus')line='本招追加'+n(e.atk*100)+'%攻击（不额外增加固定值）';
  if(k==='shield_strip')line='移除现有护盾'+n(e.ratio*100)+'%，最多'+n(e.flatCap)+'F＋'+n(e.atkCap*100)+'%攻击';
  if(k==='summon')line='召唤'+(helpers[e.summonId]||e.summonId)+'，当轮不行动';
  if(k==='charge')line='蓄势，下轮预告后续攻击';
  if(k==='mechanic_state'||k==='utility')line=e.summary||'推进已公告机制';
  if(!line)throw Error('Missing skill description '+k);
  const cond=(e.requires||[]).map(x=>requirements[x]||'目标有'+(names[x]||x)).join('且');
  if(e.shieldDamageBonus)line+='，护盾部分额外提高'+n(e.shieldDamageBonus*100)+'%，额外部分不伤害生命';
  return (cond?'若'+cond+'：':'')+(e.requiresHit?'本招命中后':'')+(target?target+' ':'')+line;
 }).join('；');
}
