import {canonical, ratio} from './physics.mjs';

const alive = a => a?.hp > 0;
const key = e => canonical(e.canonicalStatus ?? e.status ?? '');
const hard = new Set(['hard_control', 'freeze', 'sleep', 'stun', 'petrify']);
const power = e => ['strength', 'fortitude'].includes(key(e)) ? Number(e.value ?? 1) : ratio(e);
const remaining = (a, e) => e.expireAtPhase === undefined ? (e.turns ?? 1) : e.expireAtPhase - a.phaseCount;

// Pure estimates from public actors and announced intents; never consume combat RNG.
export function publicThreat(g, target) {
  return g.foeTeam(target).reduce((sum, foe) => {
    if (hard.has(key(foe.debuffs?.find(e => hard.has(key(e))) ?? {}))) return sum;
    const rows = foe.intent?.effectTargets;
    if (rows?.length) return sum + rows.reduce((n, row) => {
      const e = row.effect;
      if ((e.kind ?? e.type) !== 'damage' || !row.targetIds.includes(target.id)) return n;
      const K = 100 + 5 * foe.level;
      return n + g.calcBase(foe, target, e, {scale: foe.intent.scale ?? 1}) * K / (K + g.stat(target, 'defense'));
    }, 0);
    return sum + g.stat(foe, 'attack') * 1.4 / Math.max(1, g.friendTeam(target).length);
  }, 0);
}

export function statusGain(g, source, target, effect) {
  if (!alive(target)) return 0;
  const k = key(effect), negative = (effect.kind ?? effect.type) === 'debuff';
  if (hard.has(k)) {
    if (target.phaseCount + 1 <= (target.flags.controlImmuneUntil ?? -1) || target.debuffs.some(e => hard.has(key(e)))) return 0;
    return target.definition?.tier === 'boss' ? .3 : 1;
  }
  if (k === 'taunt') return (g.teamTauntUntil[target.side] ?? 0) > g.round || g.friendTeam(target).some(a => g.hasStatus(a, 'taunt')) ? 0 : 1;
  if (k === 'swift') {
    const count = g.status(target, 'swift');
    const fastest = Math.max(1, ...g.foeTeam(target).map(a => g.stat(a, 'speed')));
    return count >= 2 && g.stat(target, 'speed') >= fastest * 1.5 ? 0 : 1 / (1 + count);
  }
  const wanted = Math.max(.0001, power(effect));
  const existing = (negative ? target.debuffs : target.buffs).filter(e => key(e) === k && remaining(target, e) > 0 && e.charges !== 0);
  const current = Math.max(0, ...existing.map(power));
  if (current < wanted) return (wanted - current) / wanted;
  // Refresh only when the useful duration is actually extended.
  const turns = Math.max(1, effect.turns ?? 1);
  return existing.some(e => power(e) >= wanted && remaining(target, e) >= turns) ? 0 : .2;
}

export function effectValue(g, source, target, effect, options = {}) {
  if (!alive(target)) return 0;
  const e = effect, kind = e.kind ?? e.type, k = key(e), A = Math.max(10, g.stat(source, 'attack'));
  const n = Math.max(0, g.calcBase(source, target, e, options)), hp = target.hp / target.maxHp;
  const threat = () => publicThreat(g, target);
  if (kind === 'damage') {
    const K = 100 + 5 * source.level;
    const amount = n * K / (K + g.stat(target, 'defense')) * (1 + g.statusRatio(target, 'vulnerable')) *
      Math.max(0, 1 - Math.max(g.statusRatio(source, 'weak'), g.statusRatio(source, 'fear'))) *
      (1 - g.incomingReduction(target)) * (1 + g.directBonus(source, target)) *
      (e.crit === false ? 1 : 1 + g.stat(source, 'crit') * g.stat(source, 'critDamage') / 10000);
    return Math.min(amount, target.hp + target.shield) * (1 - g.evasion(source, target)) * (amount >= target.hp + target.shield ? 1.65 : 1);
  }
  if (kind === 'heal') {
    const reserve = options.reservations ? g.enemyAI?.reservedHealing?.[target.id] ?? 0 : 0;
    const budget = g.healBudgetRemaining(source, target, e);
    const gain = n * (1 + g.statusRatio(source, '治疗与护盾提高%')) * (1 - g.statusRatio(target, 'healing_down'));
    return Math.min(gain, budget, Math.max(0, target.maxHp - target.hp - reserve)) * (hp < .35 ? 3.5 : hp < .65 ? 2 : 1);
  }
  if (kind === 'shield') return Math.min(n, Math.max(0, target.maxHp * .6 - target.shield), Math.max(0, threat() * 1.2 - target.shield)) * (hp < .4 ? 2.3 : 1);
  if (kind === 'cleanse') return [...target.debuffs, ...target.dots].filter(x => x.cleanseable !== false && (!e.allowed || e.allowed.includes(key(x))))
    .map(x => A * (hard.has(key(x)) ? 1.8 : key(x) === 'healing_down' && hp < .7 ? 1.1 : .45))
    .sort((a,b) => b-a).slice(0, e.amount ?? e.count ?? 1).reduce((a,b) => a+b, 0);
  if (kind === 'dispel') return target.buffs.filter(x => x.dispellable !== false).map(x => A * (key(x) === 'taunt' ? .9 : .3 + Math.min(.5, Math.abs(ratio(x)))))
    .sort((a,b) => b-a).slice(0, e.amount ?? e.count ?? 1).reduce((a,b) => a+b, 0);
  if (kind === 'buff' || kind === 'debuff') {
    let gain = statusGain(g, source, target, e);
    const reserved = options.reservations && g.enemyAI?.[kind === 'buff' ? 'reservedBuffs' : 'reservedDebuffs']?.[target.id + ':' + k];
    if (reserved !== undefined && reserved >= power(e) && k !== 'swift') gain = 0;
    if (!gain) return 0;
    const chance = kind === 'debuff' ? g.effectChance(source, target, e) : 1;
    const turns = Math.min(3, Math.max(1, e.turns ?? 1));
    let value = A * .4;
    if (hard.has(k)) value = Math.max(A, g.stat(target, 'attack') * 1.8);
    if (['weak', 'fear', 'direct_damage_reduction', 'defense_up', 'fortitude'].includes(k)) value = (kind === 'debuff' ? g.stat(target, 'attack') * 2 : threat()) * Math.max(.15, Math.min(.6, Math.abs(ratio(e)))) * turns;
    if (['attack_up', 'strength', 'damage_up', 'direct_damage_up'].includes(k)) {
      const ready = target === g.player ? (g.phase === 'player' ? Math.min(3, Math.max(0, g.player.ap) / 2) : 1) : 1.5;
      value = (k === 'strength' ? power(e) : g.stat(target, 'attack') * Math.abs(ratio(e))) * 2 * turns * ready;
    }
    if (['armor_break', 'vulnerable'].includes(k)) value = g.friendTeam(source).reduce((s,a) => s + g.stat(a, 'attack'), 0) * Math.max(.1, Math.abs(ratio(e))) * turns * (target.hp < A ? .3 : 1);
    if (['swift', 'speed_down', 'speed_up'].includes(k)) value = A * .45 * turns;
    if (k === 'taunt') value = g.friendTeam(target).filter(a => a !== target).reduce((n,a) => n + publicThreat(g,a) * (a.hp / a.maxHp < .5 ? .9 : .25), 0) * (hp < .3 ? .1 : 1);
    if (k === 'healing_down') value = g.friendTeam(target).some(a => a.definition?.skills?.some(s => s.effects?.some(x => (x.kind ?? x.type) === 'heal'))) ? A : A * .1;
    return value * gain * chance;
  }
  if (kind === 'dot') {
    if(e.workshopDot){
      const existing=target.dots.filter(x=>x.workshopDot&&!x.ruleParent&&key(x)===k),amount=(e.atk??0)*A*(options.scale??1),max=e.maxStacks??3,turns=e.turns<0?2:e.turns??2;
      const weakest=existing.slice().sort((a,b)=>a.snapshotDamage-b.snapshotDamage||a.remaining-b.remaining)[0];
      const delta=!max||existing.length<max?amount*turns:amount>=(weakest?.snapshotDamage??0)?Math.max(0,amount*turns-(weakest?.snapshotDamage??0)*Math.min(turns,weakest?.remaining??0)):0;
      return delta*g.effectChance(source,target,e);
    }
    if ((source.flags.dotApplications?.[g.round + ':' + target.id] ?? 0) >= 2 || source.side === 'enemy' && (g.teamDotApplications[target.id + ':' + g.round] ?? 0) >= 3) return 0;
    const existing = target.dots.filter(x => key(x) === k && !x.workshopDot), amount = (e.atk ?? 0) * A * (options.scale ?? 1);
    const delta = existing.length < 3 ? amount : Math.max(0, amount - Math.min(...existing.map(x => x.snapshotDamage ?? 0)));
    return delta * 1.6 * g.effectChance(source, target, e);
  }
  if (kind === 'shield_damage') return Math.min(n, target.shield);
  return 0;
}

export function scoreEffects(g, source, effects, chosen, options = {}) {
  return effects.reduce((sum, e) => {
    const targets = g.targets(source, e, chosen);
    const scale = (options.scale ?? 1) * (e.target?.startsWith('all_') ? Math.min(1, 2 / Math.max(1, targets.length)) : 1);
    return sum + targets.reduce((n,t) => n + effectValue(g, source, t, e, {...options, scale}), 0);
  }, 0);
}

export function bestSkillTarget(g, source, skill, options = {}) {
  const effects = skill.effects ?? [];
  const friendly = effects.some(e => ['ally','lowest_hp_ally','ally_lowest_hp'].includes(e.target));
  const hostile = effects.some(e => e.target === 'enemy');
  const candidates = friendly ? g.friendTeam(source) : hostile || effects.some(e => e.target === 'all_enemies') ? g.foeTeam(source) : [source];
  return candidates.map(target => ({target, value: scoreEffects(g, source, skill.effects ?? [], target, options)}))
    .sort((a,b) => b.value - a.value || a.target.id.localeCompare(b.target.id))[0];
}
