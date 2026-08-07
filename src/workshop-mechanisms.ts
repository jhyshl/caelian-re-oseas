import type { LocalBattleState } from '@/domain/types';

export const WORKSHOP_MECHANISM_FORMAT = 'caelian_workshop_mechanism';
export const WORKSHOP_MECHANISM_STORAGE_KEY =
  'caelian_custom_workshop_mechanisms_v1';

export type WorkshopMechanismTrigger =
  | 'battle_start'
  | 'turn_start'
  | 'turn_end'
  | 'before_card'
  | 'after_card'
  | 'before_enemy_turn'
  | 'after_enemy_turn'
  | 'player_damaged'
  | 'enemy_damaged'
  | 'summon_created'
  | 'summon_removed'
  | 'battle_victory'
  | 'battle_defeat';

export type WorkshopFormula =
  | number
  | {
      op:
        | 'stat'
        | 'resource'
        | 'event'
        | 'add'
        | 'sub'
        | 'mul'
        | 'div'
        | 'min'
        | 'max'
        | 'floor'
        | 'ceil'
        | 'clamp';
      path?: string;
      id?: string;
      key?: string;
      args?: WorkshopFormula[];
      value?: WorkshopFormula;
      min?: WorkshopFormula;
      max?: WorkshopFormula;
    };

export interface WorkshopMechanismCondition {
  type:
    | 'compare'
    | 'all'
    | 'any'
    | 'not'
    | 'chance'
    | 'card_type'
    | 'has_buff'
    | 'has_debuff';
  left?: WorkshopFormula;
  operator?: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
  right?: WorkshopFormula;
  conditions?: WorkshopMechanismCondition[];
  condition?: WorkshopMechanismCondition;
  value?: string | number;
  target?: 'player' | 'selected_enemy';
}

export interface WorkshopMechanismAction {
  type:
    | 'resource_add'
    | 'resource_set'
    | 'damage'
    | 'heal'
    | 'shield'
    | 'draw'
    | 'gain_ap'
    | 'gain_mp'
    | 'apply_buff'
    | 'apply_debuff'
    | 'cleanse'
    | 'discard_random'
    | 'recover_discard'
    | 'log';
  resource?: string;
  target?: 'player' | 'selected_enemy' | 'all_enemies';
  value?: WorkshopFormula;
  turns?: WorkshopFormula;
  status?: string;
  message?: string;
}

export interface WorkshopMechanismResource {
  id: string;
  label: string;
  description: string;
  min: number;
  max: number;
  initial: number;
  visible: boolean;
}

export interface WorkshopMechanismRule {
  id: string;
  trigger: WorkshopMechanismTrigger;
  priority: number;
  once: 'never' | 'battle' | 'turn';
  condition?: WorkshopMechanismCondition;
  actions: WorkshopMechanismAction[];
}

export interface WorkshopMechanismManifest {
  format: typeof WORKSHOP_MECHANISM_FORMAT;
  version: 1;
  id: string;
  name: string;
  author: string;
  description: string;
  resources: WorkshopMechanismResource[];
  rules: WorkshopMechanismRule[];
}

export interface WorkshopMechanismRuntimeContext {
  state: LocalBattleState;
  resources: Record<string, number>;
  event: Record<string, unknown>;
  random: () => number;
}

type UnknownRecord = Record<string, unknown>;

const TRIGGERS = new Set<WorkshopMechanismTrigger>([
  'battle_start',
  'turn_start',
  'turn_end',
  'before_card',
  'after_card',
  'before_enemy_turn',
  'after_enemy_turn',
  'player_damaged',
  'enemy_damaged',
  'summon_created',
  'summon_removed',
  'battle_victory',
  'battle_defeat',
]);
const ACTIONS = new Set<WorkshopMechanismAction['type']>([
  'resource_add',
  'resource_set',
  'damage',
  'heal',
  'shield',
  'draw',
  'gain_ap',
  'gain_mp',
  'apply_buff',
  'apply_debuff',
  'cleanse',
  'discard_random',
  'recover_discard',
  'log',
]);
const SAFE_STATS = new Set([
  'player.hp',
  'player.hpMax',
  'player.mp',
  'player.mpMax',
  'player.shield',
  'player.attack',
  'player.defense',
  'player.speed',
  'player.ap',
  'player.apMax',
  'battle.turn',
  'enemy.hp',
  'enemy.hpMax',
  'enemy.shield',
  'enemy.attack',
  'enemy.defense',
  'enemies.alive',
  'summons.count',
  'hand.count',
  'discard.count',
]);

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function limitedText(value: unknown, maximum: number): string {
  return String(value ?? '').trim().slice(0, maximum);
}

function safeId(value: unknown, fallback = ''): string {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._:-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || fallback
  );
}

function finite(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function normalizeFormula(value: unknown, depth = 0): WorkshopFormula {
  if (depth > 8) throw new Error('机制公式嵌套超过 8 层。');
  if (typeof value === 'number') return Math.max(-999_999, Math.min(999_999, value));
  const source = record(value);
  const op = String(source.op ?? '');
  if (![
    'stat', 'resource', 'event', 'add', 'sub', 'mul', 'div', 'min', 'max',
    'floor', 'ceil', 'clamp',
  ].includes(op)) throw new Error(`不支持的公式操作：${op || '空'}`);
  if (op === 'stat') {
    const path = String(source.path ?? '');
    if (!SAFE_STATS.has(path)) throw new Error(`公式不能读取状态：${path}`);
    return { op, path };
  }
  if (op === 'resource') return { op, id: safeId(source.id, 'resource') };
  if (op === 'event') {
    const key = safeId(source.key, 'value');
    return { op, key };
  }
  if (op === 'floor' || op === 'ceil') {
    return { op, value: normalizeFormula(source.value, depth + 1) };
  }
  if (op === 'clamp') {
    return {
      op,
      value: normalizeFormula(source.value, depth + 1),
      min: normalizeFormula(source.min ?? 0, depth + 1),
      max: normalizeFormula(source.max ?? 999_999, depth + 1),
    };
  }
  const args = (Array.isArray(source.args) ? source.args : [])
    .slice(0, 8)
    .map((entry) => normalizeFormula(entry, depth + 1));
  if (!args.length) throw new Error(`公式操作 ${op} 缺少参数。`);
  return {
    op: op as 'add' | 'sub' | 'mul' | 'div' | 'min' | 'max',
    args,
  };
}

function normalizeCondition(
  value: unknown,
  depth = 0,
): WorkshopMechanismCondition {
  if (depth > 6) throw new Error('机制条件嵌套超过 6 层。');
  const source = record(value);
  const type = String(source.type ?? '') as WorkshopMechanismCondition['type'];
  if (!['compare', 'all', 'any', 'not', 'chance', 'card_type', 'has_buff', 'has_debuff'].includes(type)) {
    throw new Error(`不支持的机制条件：${type || '空'}`);
  }
  if (type === 'compare') {
    const operator = String(source.operator ?? 'gte') as WorkshopMechanismCondition['operator'];
    if (!['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].includes(operator ?? '')) {
      throw new Error(`不支持的比较符：${operator}`);
    }
    return {
      type,
      operator,
      left: normalizeFormula(source.left ?? 0),
      right: normalizeFormula(source.right ?? 0),
    };
  }
  if (type === 'all' || type === 'any') {
    const conditions = (Array.isArray(source.conditions) ? source.conditions : [])
      .slice(0, 8)
      .map((entry) => normalizeCondition(entry, depth + 1));
    if (!conditions.length) throw new Error(`${type} 条件不能为空。`);
    return { type, conditions };
  }
  if (type === 'not') {
    return { type, condition: normalizeCondition(source.condition, depth + 1) };
  }
  if (type === 'chance') {
    return { type, value: Math.max(0, Math.min(1, finite(source.value, 0.5))) };
  }
  return {
    type,
    value: limitedText(source.value, 40),
    target: source.target === 'selected_enemy' ? 'selected_enemy' : 'player',
  };
}

function normalizeAction(value: unknown): WorkshopMechanismAction {
  const source = record(value);
  const type = String(source.type ?? '') as WorkshopMechanismAction['type'];
  if (!ACTIONS.has(type)) throw new Error(`不支持的机制动作：${type || '空'}`);
  const target = ['player', 'selected_enemy', 'all_enemies'].includes(
    String(source.target),
  )
    ? (source.target as WorkshopMechanismAction['target'])
    : 'player';
  const result: WorkshopMechanismAction = { type, target };
  if (source.value !== undefined) result.value = normalizeFormula(source.value);
  if (source.turns !== undefined) result.turns = normalizeFormula(source.turns);
  if (source.resource !== undefined) result.resource = safeId(source.resource);
  if (source.status !== undefined) result.status = safeId(source.status);
  if (source.message !== undefined) result.message = limitedText(source.message, 120);
  if (type === 'log' && !result.message) throw new Error('日志动作缺少 message。');
  if ((type === 'resource_add' || type === 'resource_set') && !result.resource) {
    throw new Error(`${type} 动作缺少 resource。`);
  }
  return result;
}

export function normalizeWorkshopMechanism(
  value: unknown,
): WorkshopMechanismManifest {
  const source = record(value);
  const name = limitedText(source.name, 40);
  if (!name) throw new Error('底层机制缺少名称。');
  const id = safeId(source.id, `mechanism-${Date.now().toString(36)}`);
  const resources = (Array.isArray(source.resources) ? source.resources : [])
    .slice(0, 12)
    .map((entry, index) => {
      const resource = record(entry);
      const min = Math.max(-999_999, finite(resource.min));
      const max = Math.min(999_999, Math.max(min, finite(resource.max, 100)));
      return {
        id: safeId(resource.id, `${id}.resource-${index + 1}`),
        label: limitedText(resource.label ?? resource.name, 30) || `资源${index + 1}`,
        description: limitedText(resource.description, 120),
        min,
        max,
        initial: Math.max(min, Math.min(max, finite(resource.initial))),
        visible: resource.visible !== false,
      };
    });
  if (new Set(resources.map((entry) => entry.id)).size !== resources.length) {
    throw new Error(`机制「${name}」包含重复的资源 ID。`);
  }
  const rules = (Array.isArray(source.rules) ? source.rules : [])
    .slice(0, 40)
    .map((entry, index) => {
      const rule = record(entry);
      const trigger = String(rule.trigger ?? '') as WorkshopMechanismTrigger;
      if (!TRIGGERS.has(trigger)) throw new Error(`规则 ${index + 1} 的触发器无效。`);
      const actions = (Array.isArray(rule.actions) ? rule.actions : [])
        .slice(0, 16)
        .map(normalizeAction);
      if (!actions.length) throw new Error(`规则 ${index + 1} 没有动作。`);
      return {
        id: safeId(rule.id, `${id}.rule-${index + 1}`),
        trigger,
        priority: Math.max(-100, Math.min(100, Math.trunc(finite(rule.priority)))),
        once: ['battle', 'turn'].includes(String(rule.once))
          ? (rule.once as 'battle' | 'turn')
          : ('never' as const),
        condition: rule.condition
          ? normalizeCondition(rule.condition)
          : undefined,
        actions,
      };
    });
  if (!rules.length) throw new Error(`机制「${name}」没有规则。`);
  if (new Set(rules.map((entry) => entry.id)).size !== rules.length) {
    throw new Error(`机制「${name}」包含重复的规则 ID。`);
  }
  return {
    format: WORKSHOP_MECHANISM_FORMAT,
    version: 1,
    id,
    name,
    author: limitedText(source.author ?? '匿名作者', 40),
    description: limitedText(source.description, 240),
    resources,
    rules,
  };
}

export function readWorkshopMechanisms(): WorkshopMechanismManifest[] {
  try {
    const values = JSON.parse(
      localStorage.getItem(WORKSHOP_MECHANISM_STORAGE_KEY) ?? '[]',
    ) as unknown;
    return Array.isArray(values)
      ? values.flatMap((entry) => {
          try {
            return [normalizeWorkshopMechanism(entry)];
          } catch {
            return [];
          }
        })
      : [];
  } catch {
    return [];
  }
}

export function saveWorkshopMechanism(value: unknown): WorkshopMechanismManifest {
  const normalized = normalizeWorkshopMechanism(value);
  const kept = readWorkshopMechanisms().filter(
    (entry) => entry.id !== normalized.id,
  );
  localStorage.setItem(
    WORKSHOP_MECHANISM_STORAGE_KEY,
    JSON.stringify([...kept, normalized].slice(0, 40)),
  );
  return normalized;
}

export function deleteWorkshopMechanism(id: string): boolean {
  const values = readWorkshopMechanisms();
  const next = values.filter((entry) => entry.id !== id);
  if (next.length === values.length) return false;
  localStorage.setItem(WORKSHOP_MECHANISM_STORAGE_KEY, JSON.stringify(next));
  return true;
}

function statValue(context: WorkshopMechanismRuntimeContext, path: string): number {
  const { state } = context;
  const enemy = state.enemies[state.selectedTarget] ?? state.enemies.find((entry) => entry.hp > 0);
  const values: Record<string, number> = {
    'player.hp': state.player.hp,
    'player.hpMax': state.player.hpMax,
    'player.mp': state.player.mp,
    'player.mpMax': state.player.mpMax,
    'player.shield': state.player.shield,
    'player.attack': state.player.attack,
    'player.defense': state.player.defense,
    'player.speed': state.player.speed,
    'player.ap': state.player.ap,
    'player.apMax': state.player.apMax,
    'battle.turn': state.turn,
    'enemy.hp': enemy?.hp ?? 0,
    'enemy.hpMax': enemy?.hpMax ?? 0,
    'enemy.shield': enemy?.shield ?? 0,
    'enemy.attack': enemy?.attack ?? 0,
    'enemy.defense': enemy?.defense ?? 0,
    'enemies.alive': state.enemies.filter((entry) => entry.hp > 0).length,
    'summons.count': state.player.summons.length,
    'hand.count': state.player.hand.length,
    'discard.count': state.player.discardPile.length,
  };
  return values[path] ?? 0;
}

export function evaluateWorkshopFormula(
  formula: WorkshopFormula | undefined,
  context: WorkshopMechanismRuntimeContext,
  depth = 0,
): number {
  if (depth > 10 || formula === undefined) return 0;
  if (typeof formula === 'number') return formula;
  if (formula.op === 'stat') return statValue(context, formula.path ?? '');
  if (formula.op === 'resource') return context.resources[formula.id ?? ''] ?? 0;
  if (formula.op === 'event') return finite(context.event[formula.key ?? '']);
  if (formula.op === 'floor' || formula.op === 'ceil') {
    const value = evaluateWorkshopFormula(formula.value, context, depth + 1);
    return formula.op === 'floor' ? Math.floor(value) : Math.ceil(value);
  }
  if (formula.op === 'clamp') {
    const value = evaluateWorkshopFormula(formula.value, context, depth + 1);
    const min = evaluateWorkshopFormula(formula.min, context, depth + 1);
    const max = evaluateWorkshopFormula(formula.max, context, depth + 1);
    return Math.max(min, Math.min(max, value));
  }
  const args = (formula.args ?? []).map((entry) =>
    evaluateWorkshopFormula(entry, context, depth + 1),
  );
  if (formula.op === 'add') return args.reduce((sum, value) => sum + value, 0);
  if (formula.op === 'sub') return args.slice(1).reduce((value, part) => value - part, args[0] ?? 0);
  if (formula.op === 'mul') return args.reduce((value, part) => value * part, 1);
  if (formula.op === 'div') return args.slice(1).reduce((value, part) => part === 0 ? value : value / part, args[0] ?? 0);
  if (formula.op === 'min') return Math.min(...args);
  if (formula.op === 'max') return Math.max(...args);
  return 0;
}

export function evaluateWorkshopCondition(
  condition: WorkshopMechanismCondition | undefined,
  context: WorkshopMechanismRuntimeContext,
  depth = 0,
): boolean {
  if (!condition) return true;
  if (depth > 8) return false;
  if (condition.type === 'all') return (condition.conditions ?? []).every((entry) => evaluateWorkshopCondition(entry, context, depth + 1));
  if (condition.type === 'any') return (condition.conditions ?? []).some((entry) => evaluateWorkshopCondition(entry, context, depth + 1));
  if (condition.type === 'not') return !evaluateWorkshopCondition(condition.condition, context, depth + 1);
  if (condition.type === 'chance') return context.random() < finite(condition.value);
  if (condition.type === 'card_type') return String(context.event.cardType ?? '') === String(condition.value ?? '');
  const enemy = context.state.enemies[context.state.selectedTarget];
  if (condition.type === 'has_buff') {
    const effects = condition.target === 'selected_enemy' ? enemy?.buffs : context.state.player.buffs;
    return Boolean(effects?.[String(condition.value ?? '')]);
  }
  if (condition.type === 'has_debuff') {
    const effects = condition.target === 'selected_enemy' ? enemy?.debuffs : context.state.player.debuffs;
    return Boolean(effects?.[String(condition.value ?? '')]);
  }
  const left = evaluateWorkshopFormula(condition.left, context);
  const right = evaluateWorkshopFormula(condition.right, context);
  if (condition.operator === 'eq') return left === right;
  if (condition.operator === 'ne') return left !== right;
  if (condition.operator === 'gt') return left > right;
  if (condition.operator === 'lt') return left < right;
  if (condition.operator === 'lte') return left <= right;
  return left >= right;
}
