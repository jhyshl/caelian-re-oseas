import {bestSkillTarget, scoreEffects} from './tactical-ai.mjs';
import {actor, makeGame} from './physics.mjs';
import {syncLegacyActors, projectLegacyTimed} from './legacy-bridge.mjs';

const damage = (flat, atk, target = 'enemy') => ({kind:'damage', flat, atk, target, crit:true});
export const CAELIAN_SKILLS = [
  {id:'radiant_lance', name:'辉光龙枪', apCost:3, description:'对单体造成 20＋180% 攻击力伤害。', effects:[damage(20,1.8)]},
  {id:'aegis_procession', name:'圣行壁垒', apCost:3, description:'为我方全体提供 16＋65% 攻击力护盾。', effects:[{kind:'shield',flat:16,atk:.65,target:'all_allies'}]},
  {id:'dawn_mend', name:'破晓疗愈', apCost:3, description:'治疗一名友方 24＋120% 攻击力生命。', effects:[{kind:'heal',flat:24,atk:1.2,target:'ally'}]},
  {id:'trelio_convergence', name:'特莱奥·圣龙合击', apCost:4, description:'凯利安造成 16＋120% 攻击力伤害，特莱奥追加 12＋100% 其攻击力伤害；特莱奥需可行动。', requiresTrelio:true, effects:[damage(16,1.2)], followup:[damage(12,1)]},
  {id:'purifying_standard', name:'净辉战旗', apCost:3, description:'净化我方全体各 1 种负面状态，防御提高 20%，持续 2 回合。', effects:[{kind:'cleanse',amount:1,target:'all_allies'},{kind:'buff',status:'defense_up',value:.2,turns:2,target:'all_allies'}]},
  {id:'sunlit_judgement', name:'曜光裁决', apCost:4, description:'对敌方全体造成 18＋140% 攻击力伤害。', effects:[damage(18,1.4,'all_enemies')]},
  {id:'dawn_covenant', name:'黎明誓约', apCost:4, description:'治疗我方全体 14＋55% 攻击力生命，攻击提高 20%，持续 2 回合。', effects:[{kind:'heal',flat:14,atk:.55,target:'all_allies'},{kind:'buff',status:'attack_up',value:.2,turns:2,target:'all_allies'}]},
  {id:'radiant_suppression', name:'圣辉镇压', apCost:4, description:'对敌方全体造成 12＋85% 攻击力伤害，施加 20% 虚弱和 20% 破甲，持续 2 回合。', effects:[damage(12,.85,'all_enemies'),{kind:'debuff',status:'weak',value:.2,turns:2,baseChance:100,target:'all_enemies'},{kind:'debuff',status:'armor_break',value:.2,turns:2,baseChance:100,target:'all_enemies'}]},
];
export const TRELIO_SKILLS = [
  {id:'holy_claw',name:'圣光爪击',apCost:1,description:'对单体造成 10＋100% 攻击力伤害。',effects:[damage(10,1)]},
  {id:'sheltering_wings',name:'圣翼庇护',apCost:2,description:'净化一名友方 1 种负面状态，提供 18＋90% 攻击力护盾。',effects:[{kind:'cleanse',amount:1,target:'ally'},{kind:'shield',flat:18,atk:.9,target:'ally'}]},
  {id:'dragon_roar',name:'震慑龙息',apCost:3,description:'对敌方全体造成 14＋110% 攻击力伤害，速度降低 25%，持续 2 回合。',effects:[damage(14,1.1,'all_enemies'),{kind:'debuff',status:'speed_down',value:.25,turns:2,baseChance:100,target:'all_enemies'}]},
];

// One shared AP budget. Each skill is used at most once per party phase.
export function partyTurn(g, {managePhases = true} = {}) {
  g.phase = 'companion';
  const party = g.allies.filter(a => (a.isCompanion || a.isCompanionSummon) && a.hp > 0 && a.flags.partyActionRound !== g.round);
  if (!party.length) return;
  g.log('turn',{phase:'companion',name:'剧情队友行动'});
  const allowed = new Set();
  for (const a of party) {
    a.flags.partyActionRound = g.round;
    const canAct = managePhases ? g.beginPhase(a) : !['hard_control','freeze','stun','sleep','petrify'].some(k=>g.hasStatus(a,k));
    if (canAct) allowed.add(a.id);
  }
  const used = new Set(), trelio = party.find(a => a.isCompanionSummon);
  for (let step=0; step < CAELIAN_SKILLS.length + TRELIO_SKILLS.length && g.player.hp > 0 && g.livingEnemies().length; step++) {
    const choices = [];
    for (const a of party) {
      if (a.hp <= 0 || !allowed.has(a.id)) continue;
      for (const skill of a.isCompanion ? CAELIAN_SKILLS : TRELIO_SKILLS) {
        if (used.has(skill.id) || skill.apCost > g.player.ap || skill.requiresTrelio && (!trelio || trelio.hp <= 0 || !allowed.has(trelio.id))) continue;
        const choice = bestSkillTarget(g,a,skill);
        if (!choice || choice.value <= 0) continue;
        if (skill.followup) choice.value += scoreEffects(g,trelio,skill.followup,choice.target);
        choices.push({...choice,actor:a,skill,score:choice.value / skill.apCost});
      }
    }
    choices.sort((a,b) => b.score-a.score || a.skill.apCost-b.skill.apCost || a.skill.id.localeCompare(b.skill.id));
    const best = choices[0];
    if (!best) break;
    const {actor, skill, target} = best;
    used.add(skill.id); g.player.ap -= skill.apCost;
    g.beginAction(actor,skill);
    Object.assign(g.trace?.at(-1) ?? {}, {apAfter:g.player.ap,target:target.id});
    g.log('party_action',{source:actor.id,target:target.id,name:skill.name,ap:skill.apCost,apAfter:g.player.ap});
    g.applyEffects(skill.effects,actor,target,{skillId:skill.id});
    g.endAction();
    if (skill.followup && trelio.hp > 0 && g.livingEnemies().length) {
      const next = target.hp > 0 ? target : g.livingEnemies()[0];
      g.beginAction(trelio,{id:skill.id + ':followup',name:'圣龙合击·吐息'});
      g.applyEffects(skill.followup,trelio,next,{skillId:skill.id}); g.endAction();
    }
  }
  if (managePhases) for (const a of party) g.endPhase(a);
}

export function legacyTacticalGame(state) {
  const stats = row => ({hp:row.hpMax,attack:row.attack??0,defense:row.defense??0,speed:row.speed??0,crit:row.critRate??0,critDamage:row.critDamage??50,ehr:row.effectHit??0,res:row.effectResist??0});
  const player = actor('player','player',state.companion?.level??1,stats(state.player));
  const enemies = state.enemies.map(row=>actor(row.id,'enemy',row.level??1,stats(row)));
  const g = makeGame(player,enemies,{trace:true,seed:state.turn*104729});
  g.round = state.turn; g.phase = state.phase;
  syncLegacyActors(g,state);
  return g;
}

export function legacyPartyTurn(state) {
  const g = legacyTacticalGame(state);
  partyTurn(g,{managePhases:false});
  const rows = [state.player,...state.enemies,...state.player.summons,state.companion,...(state.companion?.summons??[])].filter(Boolean);
  for (const row of rows) {
    const a = [...g.allies,...g.enemies].find(a=>a.id===(row===state.player?'player':row.id));
    if (!a) continue;
    row.hp=Math.max(0,Math.ceil(a.hp));row.shield=Math.max(0,Math.ceil(a.shield));
    row.buffs=projectLegacyTimed(a,a.buffs);row.debuffs=projectLegacyTimed(a,[...a.debuffs,...a.dots]);
  }
  state.player.ap = g.player.ap;
  return g;
}
