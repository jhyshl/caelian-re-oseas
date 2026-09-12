import { formatNumber } from '@/ui/format-number';
import rawCatalog from '@/battle/rework/catalog.json';
import type { CardDefinition, CardEffect } from '@/content/types';

export interface ReworkEffect {
  kind: string;
  [key: string]: unknown;
}

export interface ReworkCard {
  id: string;
  name: string;
  profession: string;
  ap: number;
  mp: number;
  type: string;
  target: string;
  summary: string;
  effects: ReworkEffect[];
  limits?: string | string[];
  source?: unknown;
  [key: string]: unknown;
}

export interface ReworkProfession {
  id: string;
  name: string;
  role: string;
  talent: string;
  resource: unknown;
  baseStatsProposal: {
    hp: string;
    attack: string;
    defense: string;
    speed: number;
    crit: number;
    critDamage: number;
    ehr: number;
    res: number;
  };
  [key: string]: unknown;
}

const source = rawCatalog as unknown as {
  cards: ReworkCard[];
  professions: ReworkProfession[];
};

/** Absolute assignments also work when the input JSON already contains v3 values. */
function reviewedCard(raw: ReworkCard): ReworkCard {
  const card = structuredClone(raw);
  const first = card.effects[0];
  switch (card.id) {
    case 'ap_bitter_toxin':
      if (first) Object.assign(first, { flat: 20, atk: 0.4 });
      card.summary = card.summary.replace('10＋20%攻击力', '20＋40%攻击力');
      break;
    case 'ap_needle_injection':
      if (first) Object.assign(first, { flat: 25, atk: 0.75 });
      card.summary = card.summary.replace('20＋55%攻击力', '25＋75%攻击力');
      break;
    case 'pr_smite':
      if (first) Object.assign(first, { flat: 30, atk: 0.9 });
      card.summary = card.summary.replace('25＋70%攻击力', '30＋90%攻击力');
      break;
    case 'pr_judgement':
      if (first) Object.assign(first, { flat: 55, atk: 1.65 });
      card.summary = card.summary.replace('45＋135%攻击力', '55＋165%攻击力');
      break;
    case 'mg_smoke_and_mirrors':
      if (card.effects[1]) Object.assign(card.effects[1], { flat: 20, def: 0.65 });
      card.summary = card.summary.replace('15＋45%防御', '20＋65%防御');
      break;
    case 'pr_sacred_ground':
      if (first) first.ticks = 2;
      card.summary = card.summary.replace('未来3次', '未来2次');
      break;
  }
  card.summary = card.summary.replace('最多undefined份', '最多5份');
  return card;
}

const cards = new Map(source.cards.map((card) => [card.id, reviewedCard(card)]));
const professions = new Map(source.professions.map((profession) => [profession.id, profession]));

/** Callers receive a copy so card costs/effects cannot mutate the shared catalog. */
export function reworkCard(id: string): ReworkCard | undefined {
  const card = cards.get(id);
  return card ? structuredClone(card) : undefined;
}

export function reworkProfession(id: string): ReworkProfession | undefined {
  const profession = professions.get(id);
  return profession ? structuredClone(profession) : undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function effects(value: unknown): ReworkEffect[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ReworkEffect =>
    Boolean(object(entry)) && typeof object(entry)?.kind === 'string');
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return numeric(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('、');
  return '';
}

function numeric(value: number): string {
  return Number.isFinite(value) ? formatNumber(value) : '无限';
}

export interface CardDisplayStats { attack: number; defense: number; hpMax: number; targetHpMax: number; allyHpMax?: number; ownerHpMax?: number; speed?: number; critRate?: number; critDamage?: number; effectHit?: number; effectResist?: number }

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function percent(value: unknown, scale = 1): string {
  return `${numeric(number(value) * 100 * scale)}%`;
}

function starScale(star: number): number {
  return 1 + 0.1 * (Math.max(1, Math.min(3, Math.floor(number(star, 1)))) - 1);
}

const targetNames: Record<string, string> = {
  self: '自身', enemy: '一名敌人', all_enemies: '全体敌人', ally: '一名友方',
  all_allies: '全体友方', owner: '召唤者', summon: '一只己方召唤物',
  all_summons: '己方全部召唤物', draw_pile: '抽牌堆', hand: '手牌',
  lowest_hp_ally: '生命比例最低的友方', all_other_allies: '其他全体友方',
};

function target(effect: ReworkEffect): string {
  const value = text(effect.target);
  return targetNames[value] ?? value;
}

/** Only fixed amounts and attack/defense coefficients receive the star factor. */
function formula(value: Record<string, unknown>, star: number, dot = false, stats?: CardDisplayStats): string {
  if(dot&&typeof value.dotFixedDamage==='number')return numeric(value.dotFixedDamage);
  const scale = starScale(star);
  if (stats) {
    const targetHp = value.target === 'self' || !value.target && ['heal', 'shield'].includes(String(value.kind)) ? stats.hpMax
      : value.target === 'owner' ? stats.ownerHpMax ?? stats.hpMax
      : ['ally', 'all_allies', 'lowest_hp_ally'].includes(String(value.target)) ? stats.allyHpMax ?? stats.hpMax : stats.targetHpMax;
    return numeric(((dot ? 0 : number(value.flat)) + number(value.atk) * stats.attack + (dot ? 0 : number(value.def) * stats.defense)) * scale + (dot ? 0 : number(value.maxHp ?? value.maxHpRatio ?? value.hpRatio) * targetHp));
  }
  const terms: string[] = [];
  if (!dot && typeof value.flat === 'number' && value.flat !== 0) {
    terms.push(numeric(value.flat * scale));
  }
  if (typeof value.atk === 'number' && value.atk !== 0) {
    terms.push(`${percent(value.atk, scale)}${dot ? '施加时攻击力' : '攻击力'}`);
  }
  if (!dot && typeof value.def === 'number' && value.def !== 0) {
    terms.push(`${percent(value.def, scale)}防御`);
  }
  const maxHp = value.maxHp ?? value.maxHpRatio ?? value.hpRatio;
  if (!dot && typeof maxHp === 'number' && maxHp !== 0) {
    terms.push(`${percent(maxHp)}目标生命上限`);
  }
  return terms.join('＋') || '0';
}

function statusValue(effect: ReworkEffect): string {
  if (effect.value === undefined) return '';
  const value = number(effect.value);
  if (effect.valueUnit === 'ratio') return percent(value);
  if (effect.valueUnit === 'percent') return `${numeric(value)}%`;
  if (effect.valueUnit === 'count') return `${numeric(value)}层`;
  return text(effect.value);
}

function extraMechanics(effect: ReworkEffect, star: number, stats?: CardDisplayStats): string[] {
  const result: string[] = [];
  const strings: Record<string, string> = {
    conditionBonus: '追加条件', selector: '目标选择', selection: '选择方式',
    trigger: '触发条件', expiry: '结束规则', stacking: '叠加规则',
    appliesTo: '生效范围', require: '使用要求', retarget: '目标失效时',
    bonusMultipliers: '伤害规则', distribution: '总量分配',
    policy: '行动条件', inheritance: '继承规则', firstAction: '首次行动',
  };
  for (const [key, label] of Object.entries(strings)) {
    if (text(effect[key])) result.push(`${label}：${text(effect[key])}`);
  }
  const counts: Record<string, string> = {
    maxUsesPerCardNamePerTurn: '每同名牌每回合最多使用', maxUsesPerBattle: '每战最多使用',
    maxTriggersPerRound: '每回合最多触发', maxTriggersPerTurn: '每回合最多触发',
    maxPoints: '最多计算资源点数', maxTypes: '最多计算种类', maxBuffs: '最多计算增益数',
    maxSummons: '最多计算召唤物数', consumeMax: '最多消耗层数', maxConsume: '最多消耗资源',
    min: '最少数量', max: '最多数量', requiredMin: '最低资源要求',
    charges: '可触发次数', cooldown: '冷却回合',
    maxStacks: '同类最多层数', applicationCapPerSourceTurn: '每来源每回合最多施加',
    sourceApplicationsPerTurn: '每来源每回合最多施加',
    maxActionsPerTurn: '每回合最多行动', actionsPerTurn: '每回合最多行动',
    teamLimit: '己方共享召唤上限', slotsForWholeTeam: '己方共享召唤上限',
  };
  for (const [key, label] of Object.entries(counts)) {
    if (typeof effect[key] === 'number') result.push(`${label} ${numeric(effect[key])}`);
  }
  for (const [key, label] of Object.entries({
    perPoint: '每消耗一点追加', perType: '每种类型追加',
    perBuff: '每个增益追加', perSummon: '每只召唤物追加', totalCap: '总量上限',
    damage: '伤害', shield: '护盾', heal: '治疗',
  })) {
    const value = object(effect[key]);
    if (value) result.push(`${label} ${formula(value, star, false, stats)}`);
  }
  if (typeof effect.atkPerLayer === 'number') {
    result.push(`每层 ${formula({ flat: effect.flatPerLayer, atk: effect.atkPerLayer }, star, false, stats)}伤害`);
  }
  if (typeof effect.atkPerTick === 'number') {
    result.push(`每次伤害上限 ${stats ? numeric(effect.atkPerTick * stats.attack * starScale(star)) : percent(effect.atkPerTick, starScale(star)) + '攻击力'}`);
  }
  if (typeof effect.flatCap === 'number' || typeof effect.atkCap === 'number') {
    result.push(`数值上限 ${formula({ flat: effect.flatCap, atk: effect.atkCap }, star, false, stats)}`);
  }
  if (typeof effect.perResource === 'number') result.push("每消耗" + numeric(effect.perResource) + "点资源结算一份" );
  if (typeof effect.maxValue === 'number') result.push("总值上限 " + statusValue({ ...effect, value: effect.maxValue }));
  if (effect.mergeWithFirst === true) result.push('并入本卡首个直击总量，不增加攻击段数');
  if (effect.preResolve === true || effect.phase === 'preResolve') result.push('出牌时先结算此项');
  if (effect.crit === false && effect.kind === 'utility') result.push('不可暴击');
  return result;
}

function describeEffect(effect: ReworkEffect, star: number, stats?: CardDisplayStats): string {
  const who = target(effect);
  const amount = text(effect.amount ?? effect.value);
  let line: string;
  switch (effect.kind) {
    case 'damage': {
      const hits = Math.max(1, Math.floor(number(effect.hits, 1)));
      line = `对${who || '一名敌人'}造成${formula(effect, star, false, stats)}总伤害`;
      if (stats) line += '（基础值，减伤前、未暴击）';
      if (hits > 1) line += `，均分为${hits}段`;
      if (effect.crit === false) line += '，不可暴击';
      break;
    }
    case 'dot':
      line = `基础命中${numeric(number(effect.baseChance, 100))}%对${who || '一名敌人'}施加${numeric(number(effect.stacks, 1))}层${text(effect.status)}，每层每跳${formula(effect, star, true, stats)}伤害，${effect.workshopDot ? `目标行动阶段结束结算，${number(effect.turns,2)<0?'持续整场战斗':`持续${numeric(number(effect.turns,2))}回合`}，${number(effect.maxStacks,3)===0?'叠加不设上限':`同类最多${numeric(number(effect.maxStacks,3))}层`}` : '目标接下来两次行动阶段结束结算'}`;
      break;
    case 'heal': {
      const ticks = number(effect.ticks ?? effect.overTime);
      line = ticks > 0
        ? `${who || '自身'}在未来${numeric(ticks)}次己方回合开始各回复${formula(effect, star, false, stats)}生命`
        : `${who || '自身'}回复${formula(effect, star, false, stats)}生命`;
      break;
    }
    case 'shield':
      line = `${who || '自身'}获得${formula(effect, star, false, stats)}护盾`;
      break;
    case 'buff':
    case 'debuff':
      line = `${effect.kind === 'debuff' ? `基础命中${numeric(number(effect.baseChance, 100))}%使` : ''}${who || '自身'}获得${text(effect.status)}${statusValue(effect) ? ` ${statusValue(effect)}` : ''}，持续${numeric(number(effect.turns, 1))}回合`;
      break;
    case 'conditional':
      line = `满足条件时：【${describeReworkEffects(effects(effect.effects), star, stats)}】`;
      break;
    case 'chant':
      line = `吟诵${numeric(number(effect.turns, 1))}回合后结算：【${describeReworkEffects(effects(effect.effects), star, stats)}】`;
      if (effect.targetLock === true) line += '；入队时锁定目标';
      if (effect.queueCap !== undefined) line += `；吟诵队列上限${text(effect.queueCap)}`;
      break;
    case 'summon': {
      line = `召唤「${text(effect.name)}」，存在${numeric(number(effect.turns, 3))}回合`;
      if (typeof effect.attackable === 'boolean') line += effect.attackable ? '，可被攻击' : '，不可被攻击';
      const inheritance = object(effect.inherit) ?? (effect.hpRatio !== undefined ? {
        hp: effect.hpRatio, atk: effect.atkRatio, def: effect.defRatio,
        speed: effect.speedRatio, crit: effect.critRatio, critDamage: effect.critDamageRatio,
        effectHit: effect.effectHitRatio, effectRes: effect.resistanceRatio,
      } : undefined);
      if (inheritance) {
        const names: Record<string, string> = { hp: '生命上限', atk: '攻击力', def: '防御', speed: '速度', crit: '暴击率', critDamage: '暴击伤害', effectHit: '效果命中', effectRes: '效果抵抗' };
        const values: Record<string, number> = stats ? {hp:stats.hpMax,atk:stats.attack,def:stats.defense,speed:stats.speed ?? 0} : {};
        line += `；${stats ? '属性' : '继承召唤者'}${Object.entries(inheritance).map(([key, value]) => `${stats && key in values ? numeric(number(value) * values[key]!) : percent(value)}${names[key] ?? key}`).join('、')}`;
      }
      const summonStats = stats ? {
        ...stats,
        attack: stats.attack * number(inheritance?.atk, 1),
        defense: stats.defense * number(inheritance?.def, .5),
        hpMax: Math.max(1, stats.hpMax * number(inheritance?.hp, .3)),
        ownerHpMax: stats.hpMax,
        speed: (stats.speed ?? 0) * number(inheritance?.speed, 1),
      } : undefined;
      if (effects(effect.entry).length) line += `；入场：【${describeReworkEffects(effects(effect.entry), star, summonStats)}】`;
      if (Array.isArray(effect.skills)) {
        line += `；技能：${effect.skills.map((value) => {
          const skill = object(value);
          if (!skill) return '';
          return `「${text(skill.name)}」${skill.condition ? `（${text(skill.condition)}）` : ''}${skill.cooldown !== undefined ? `，冷却${text(skill.cooldown)}回合` : ''}：【${describeReworkEffects(effects(skill.effects), star, summonStats)}】`;
        }).filter(Boolean).join('；')}`;
      }
      break;
    }
    case 'resource': {
      const resource = text(effect.resource).toLowerCase() === 'ap' ? 'AP' : text(effect.resource);
      const cost = effect.consume === true || number(effect.amount ?? effect.value) < 0;
      line = `${cost ? '消耗' : '获得'}${typeof (effect.amount ?? effect.value) === 'number' ? numeric(Math.abs(number(effect.amount ?? effect.value))) : amount}${resource}`;
      break;
    }
    case 'draw': line = `抽${amount}张牌`; break;
    case 'discard': line = `弃置${amount || text(effect.max)}张牌`; break;
    case 'cleanse': line = `净化${who || '自身'}${amount || '1'}个可净化负面状态`; break;
    case 'dispel': line = `驱散${who || '一名敌人'}${amount || '1'}个可驱散增益`; break;
    case 'hp_cost': line = `支付${stats ? numeric(stats.hpMax * number(effect.maxHp ?? effect.maxHpRatio ?? effect.hpRatio)) : '自身生命上限的' + percent(effect.maxHp ?? effect.maxHpRatio ?? effect.hpRatio)}生命，不能致死`; break;
    case 'exhaust': line = '使用后本场战斗移出牌组循环'; break;
    case 'retrieve': line = `从弃牌堆回收${amount || '1'}张牌${text(effect.filter) ? `（${text(effect.filter)}）` : ''}`; break;
    case 'scry_draw': line = `查看牌堆顶${text(effect.look)}张，选择${text(effect.draw)}张加入手牌`; break;
    case 'utility':
      line = text(effect.text ?? effect.summary ?? effect.action) || '特殊效果';
      if (effect.element !== undefined) line += `：${text(effect.element)}`;
      if (!effect.text && !effect.summary && (effect.flat !== undefined || effect.atk !== undefined || effect.def !== undefined)) line += `：${formula(effect, star, false, stats)}`;
      if (!effect.text && !effect.summary && amount) line += `：${amount}`;
      if (Array.isArray(effect.options)) line += `，选项：【${describeReworkEffects(effects(effect.options), star, stats)}】`;
      break;
    default:
      line = text(effect.text ?? effect.summary ?? effect.kind);
  }
  if (effect.kind !== 'conditional' && effect.kind !== 'chant' && effects(effect.effects).length) {
    line += `；后续：【${describeReworkEffects(effects(effect.effects), star, stats)}】`;
  }
  const details = extraMechanics(effect, star, stats);
  if (details.length) line += `；${details.join('；')}`;
  return `${effect.condition ? `若${text(effect.condition)}，` : ''}${line}`;
}

/** Uses current effect numbers; star changes never multiply AP/probabilities/durations. */
export function describeReworkEffects(effectList: readonly ReworkEffect[], star = 1, stats?: CardDisplayStats): string {
  const description = effectList.map((effect) => describeEffect(effect, star, stats)).join('；');
  if (!stats) return description;
  return description.replace(/(?:(\d+(?:\.\d+)?)\s*[+＋]\s*)?(\d+(?:\.\d+)?)%\s*(施加时攻击力|攻击力|防御力?|目标生命上限|生命上限)/g, (_match, base, rate, attribute: string) => {
    const value = attribute.includes('攻击') ? stats.attack : attribute.includes('防御') ? stats.defense : attribute.includes('目标') ? stats.targetHpMax : stats.hpMax;
    return numeric(Number(base ?? 0) + Number(rate) * value / 100);
  });
}

/** UI adapters retain kind alongside type; the rework interpreter remains authoritative. */
function compatibleEffect(effect: ReworkEffect): CardEffect {
  const copy: CardEffect = { ...structuredClone(effect), type: effect.kind };
  for (const key of ['effects', 'entry', 'options']) {
    if (Array.isArray(effect[key])) copy[key] = effects(effect[key]).map(compatibleEffect);
  }
  if (Array.isArray(effect.skills)) {
    copy.skills = effect.skills.map((value) => {
      const skill = object(value);
      return skill ? { ...structuredClone(skill), effects: effects(skill.effects).map(compatibleEffect) } : value;
    });
  }
  return copy;
}

/** Apply after all legacy built-in overlays, before adding installed Workshop packs. */
export function applyReworkCards(legacy: Record<string, CardDefinition>): Record<string, CardDefinition> {
  const result = { ...legacy };
  for (const card of cards.values()) {
    const old = legacy[card.id];
    const limits = text(card.limits);
    const details = describeReworkEffects(card.effects);
    result[card.id] = {
      ...old,
      id: card.id,
      name: card.name,
      type: card.type,
      cost: card.ap,
      mpCost: 0,
      rarity: old?.rarity ?? 'common',
      cat: old?.cat ?? (card.profession === 'common' ? 'common' : `sub_${card.profession}`),
      cls: old?.cls ?? card.profession,
      description: `AP ${card.ap}｜1星：${card.summary}\n逐项效果：${details}${limits ? `\n限制：${limits}` : ''}`,
      brief: `${card.summary}${limits ? `（${limits}）` : ''}`,
      effects: card.effects.map(compatibleEffect),
      ...(old?.source !== undefined ? { source: old.source } : {}),
      rework: true,
      reworkVersion: '2026-09-07-v3',
      reworkProfession: card.profession,
      reworkEffects: structuredClone(card.effects),
      reworkSource: structuredClone(card.source),
      target: card.target,
      summary: card.summary,
      maxStars: 3,
      unplayable: card.id === 'mg_blank_card' || old?.unplayable === true,
    };
  }
  return result;
}
